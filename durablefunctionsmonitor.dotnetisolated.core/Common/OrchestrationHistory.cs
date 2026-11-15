// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Globalization;
using Microsoft.DurableTask.Client;
using Azure.Data.Tables;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    static class OrchestrationHistory
    {
        /// <summary>
        /// Fetches orchestration instance history directly from XXXHistory table
        /// Tries to mimic the history aggregation algorithm in https://github.com/Azure/azure-functions-durable-extension/blob/main/src/WebJobs.Extensions.DurableTask/ContextImplementations/DurableClient.cs
        /// Intentionally returns IEnumerable, because the consuming code not always iterates through all of it.
        /// </summary>
        /// <remarks>
        /// What is read, and when, is shaped by two facts: an instance's history can be hundreds of thousands
        /// of rows, and most of what asks for it wants a page of it (the History tab asks for 200 events at a time).
        ///
        ///   - Only the rows that become events are asked for. More than half of a history is rows that are not
        ///     shown as such: the OrchestratorStarted/OrchestratorCompleted pair of every episode, and the
        ///     completion of every task, which is merged into the event that scheduled it. The filter names the
        ///     eleven event types that are shown, so the others never leave the storage account.
        ///   - Only the columns that are used are asked for (see <see cref="HistoryColumns"/>).
        ///   - The first page (up to 1000 events) is read before this returns, asynchronously, together with the
        ///     completions of the tasks scheduled in it and of nothing else: one more query, for that range of
        ///     task ids. A history of up to a page, which is nearly every history, and the first pages of the
        ///     History tab on any history, cost these two queries and block no thread.
        ///   - Whoever enumerates past the first page wants much of the rest. From there on the pages are
        ///     fetched as they are reached, and the completions of everything else are read alongside, in one go.
        ///
        /// It used to read every row and every column of the instance's partition, and every completion in it,
        /// for every page of the History tab.
        /// </remarks>
        public static async Task<IEnumerable<HistoryEvent>> GetHistoryDirectlyFromTable(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            var tableClient = TableClient.GetTableClient(connName);

            // Need to fetch executionId first

            var instanceEntity = await tableClient.GetEntityAsync($"{hubName}Instances", instanceId, string.Empty, ExecutionIdColumns);
            if (instanceEntity == null)
            {
                // No such instance (or it was purged). Nothing to correlate against, so nothing to return.
                return Enumerable.Empty<HistoryEvent>();
            }

            // Coalescing to string.Empty because the legacy SDK's GenerateFilterCondition did the
            // same for a null value; CreateQueryFilter would instead emit "eq null", which Table
            // Storage rejects.
            string executionId = instanceEntity.GetString("ExecutionId") ?? string.Empty;

            // CreateQueryFilter escapes the interpolated values, so instanceId cannot break out of the filter
            string executionFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and ExecutionId eq {executionId}");

            var reader = new HistoryReader(tableClient, $"{hubName}History", executionFilter);

            await reader.ReadFirstPageAsync();

            return reader.EnumerateEvents();
        }

        /// <summary>
        /// Reads the history of one execution of one instance, a page at a time, and turns its rows into events.
        /// </summary>
        private sealed class HistoryReader
        {
            public HistoryReader(ITableClient tableClient, string historyTable, string executionFilter)
            {
                this._tableClient = tableClient;
                this._historyTable = historyTable;
                this._executionFilter = executionFilter;
                this._eventsFilter = $"{executionFilter} and ({ShownEventTypesFilter})";
            }

            /// <summary>Reads the first page of events, and the completions of the tasks scheduled in it.</summary>
            public async Task ReadFirstPageAsync()
            {
                TablePage page;
                string continuationToken = null;

                // A page that comes back empty is not the end of the history, only one without a token is
                do
                {
                    page = await this.ReadEventsPageAsync(continuationToken);
                    continuationToken = page.ContinuationToken;
                }
                while (page.Rows.Count == 0 && continuationToken != null);

                this._firstPage = page.Rows.Select(HistoryEntity.From).ToList();
                this._firstPageContinuationToken = continuationToken;

                var scheduledIds = this._firstPage.Where(IsSchedulingEvent).Select(evt => evt.EventId).ToList();

                this._firstPageCompletions = scheduledIds.Count == 0
                    ? new Dictionary<int, HistoryEntity>()
                    // Every row with one of these ids, wherever in the history it is: a task can complete long
                    // after it was scheduled, and more than once (a rewind leaves the old outcome behind)
                    : ToCompletionsMap(await TableScan.ReadAllAsync(
                        this._tableClient,
                        this._historyTable,
                        string.Create(CultureInfo.InvariantCulture, $"{this._executionFilter} and TaskScheduledId ge {scheduledIds.Min()} and TaskScheduledId le {scheduledIds.Max()}"),
                        HistoryColumns,
                        CancellationToken.None));
            }

            /// <summary>
            /// The events, in the order of the history. Lazy: the pages after the first one are only read when
            /// the enumeration gets to them, which most of the time it does not.
            /// </summary>
            public IEnumerable<HistoryEvent> EnumerateEvents()
            {
                // Memorizing 'ExecutionStarted' event, to further correlate with 'ExecutionCompleted'
                HistoryEntity executionStartedEvent = null;

                foreach (var evt in this._firstPage)
                {
                    var historyEvent = ToHistoryEvent(evt, this._firstPageCompletions, ref executionStartedEvent);
                    if (historyEvent != null)
                    {
                        yield return historyEvent;
                    }
                }

                string continuationToken = this._firstPageContinuationToken;
                if (continuationToken == null)
                {
                    yield break;
                }

                // Going past the first page. The completions of what the next pages schedule are read
                // alongside those pages rather than page by page: this is on its way through the whole history.
                using (var cts = new CancellationTokenSource())
                {
                    var completionsTask = this.ReadAllCompletionsAsync(cts.Token);

                    try
                    {
                        while (continuationToken != null)
                        {
                            // Enumeration is synchronous, so this waits. It did before as well.
                            var page = this.ReadEventsPageAsync(continuationToken).GetAwaiter().GetResult();

                            continuationToken = page.ContinuationToken;

                            foreach (var row in page.Rows)
                            {
                                var evt = HistoryEntity.From(row);

                                // Only a row that schedules something needs the completions, and waits for them
                                var completions = IsSchedulingEvent(evt) ? completionsTask.GetAwaiter().GetResult() : null;

                                var historyEvent = ToHistoryEvent(evt, completions, ref executionStartedEvent);
                                if (historyEvent != null)
                                {
                                    yield return historyEvent;
                                }
                            }
                        }
                    }
                    finally
                    {
                        // Whoever stops enumerating half way does not need the rest of the completions either
                        cts.Cancel();

                        // And nobody is going to look at how that query ended
                        _ = completionsTask.ContinueWith(task => _ = task.Exception, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
                    }
                }
            }

            private Task<TablePage> ReadEventsPageAsync(string continuationToken)
            {
                return this._tableClient.QueryPageAsync(this._historyTable, this._eventsFilter, HistoryColumns, TableClient.MaxPageSize, continuationToken, CancellationToken.None);
            }

            private async Task<Dictionary<int, HistoryEntity>> ReadAllCompletionsAsync(CancellationToken ct)
            {
                // Not on the thread of whoever enumerates: that one is about to wait for a page
                await Task.Yield();

                return ToCompletionsMap(await TableScan.ReadAllAsync(this._tableClient, this._historyTable, $"{this._executionFilter} and TaskScheduledId ge 0", HistoryColumns, ct));
            }

            private static Dictionary<int, HistoryEntity> ToCompletionsMap(IEnumerable<TableEntity> rows)
            {
                // It turned out that there can be entities with duplicated TaskScheduleId (not sure why).
                // So creating this map manually (instead of using .ToDictionary()): the last one wins.
                var completions = new Dictionary<int, HistoryEntity>();

                foreach (var row in rows)
                {
                    var historyEntity = HistoryEntity.From(row);

                    if (historyEntity.TaskScheduledId.HasValue)
                    {
                        completions[historyEntity.TaskScheduledId.Value] = historyEntity;
                    }
                }

                return completions;
            }

            private readonly ITableClient _tableClient;
            private readonly string _historyTable;
            private readonly string _executionFilter;
            private readonly string _eventsFilter;

            private List<HistoryEntity> _firstPage = new List<HistoryEntity>();
            private string _firstPageContinuationToken;
            private Dictionary<int, HistoryEntity> _firstPageCompletions = new Dictionary<int, HistoryEntity>();
        }

        private static bool IsSchedulingEvent(HistoryEntity evt)
        {
            return evt.EventType == "TaskScheduled" || evt.EventType == "SubOrchestrationInstanceCreated";
        }

        /// <summary>
        /// Turns a history row into the event it is shown as, or into null when it is not shown. A row that
        /// schedules a task or a sub-orchestration is merged with the row that completed it, when there is one.
        /// </summary>
        private static HistoryEvent ToHistoryEvent(HistoryEntity evt, Dictionary<int, HistoryEntity> completions, ref HistoryEntity executionStartedEvent)
        {
            switch (evt.EventType)
            {
                case "TaskScheduled":
                case "SubOrchestrationInstanceCreated":

                    // Trying to match the completion event
                    HistoryEntity correlatedEvt = null;
                    completions?.TryGetValue(evt.EventId, out correlatedEvt);

                    if (correlatedEvt != null)
                    {
                        return correlatedEvt.ToHistoryEvent
                        (
                            evt._Timestamp,
                            evt.Name,
                            correlatedEvt.EventType == "GenericEvent" ? evt.EventType : null,
                            evt.InstanceId,
                            evt.Input,
                            // The merged event is addressed by the row that scheduled it
                            evt.SequenceNumber
                        );
                    }

                    return evt.ToHistoryEvent();

                case "ExecutionStarted":

                    executionStartedEvent = evt;

                    return evt.ToHistoryEvent(null, evt.Name);

                case "ExecutionCompleted":
                case "ExecutionFailed":
                case "ExecutionTerminated":

                    return evt.ToHistoryEvent(executionStartedEvent?._Timestamp);

                case "ContinueAsNew":
                case "TimerCreated":
                case "TimerFired":
                case "EventRaised":
                case "EventSent":

                    return evt.ToHistoryEvent();

                default:

                    // The query asks for the types above and for nothing else. Should a row of another type
                    // arrive all the same, it is not an event, exactly as it was not when every row was read.
                    return null;
            }
        }

        /// <summary>
        /// The event types that are shown as events, which is all the history query asks for. The rest - the
        /// markers of every episode, and the completions, which are merged into what they complete - is
        /// either not shown or read separately.
        /// </summary>
        internal static readonly string[] ShownEventTypes = new[]
        {
            "TaskScheduled", "SubOrchestrationInstanceCreated",
            "ExecutionStarted", "ExecutionCompleted", "ExecutionFailed", "ExecutionTerminated",
            "ContinueAsNew", "TimerCreated", "TimerFired", "EventRaised", "EventSent"
        };

        // The names are constants of this file with nothing in them to escape
        private static readonly string ShownEventTypesFilter = string.Join(" or ", ShownEventTypes.Select(eventType => $"EventType eq '{eventType}'"));

        /// <summary>
        /// The columns <see cref="HistoryEntity"/> is made of. A history row has a dozen more (the instance and
        /// its parent as JSON, the execution id, tags, the checkpoint bookkeeping), and none of them is shown.
        /// </summary>
        internal static readonly string[] HistoryColumns = new[]
        {
            "InstanceId", "EventType", "Name", "_Timestamp", "Input", "InputBlobName", "Result", "Details",
            "FailureDetails", "EventId", "TaskScheduledId", "TimerId", "FireAt"
        };

        // All the history reader takes from the XXXInstances row
        private static readonly string[] ExecutionIdColumns = new[] { "ExecutionId" };

        private static HistoryEvent ToHistoryEvent(this HistoryEntity evt,
            DateTimeOffset? scheduledTime = null,
            string functionName = null,
            string eventType = null,
            string subOrchestrationId = null,
            string input = null,
            long? sequenceNumber = null)
        {
            return new HistoryEvent
            {
                SequenceNumber = sequenceNumber ?? evt.SequenceNumber,
                Timestamp = evt._Timestamp.ToUniversalTime(),
                EventType = eventType ?? evt.EventType,
                EventId = evt.TaskScheduledId,
                Name = string.IsNullOrEmpty(evt.Name) ? functionName : evt.Name,
                Input = string.IsNullOrEmpty(evt.Input) ? input : evt.Input,
                Result = evt.Result,
                // Fallback to FailureDetails, see: https://github.com/microsoft/DurableFunctionsMonitor/issues/174
                Details = evt.Details ?? evt.FailureDetails,
                SubOrchestrationId = subOrchestrationId ?? evt.InstanceId,
                ScheduledTime = scheduledTime,
                DurationInMs = scheduledTime.HasValue ? (evt._Timestamp - scheduledTime.Value).TotalMilliseconds : 0,
                TimerId = evt.TimerId,
                FireAt = evt.FireAt
            };
        }

        internal static HistoryEvent ToHistoryEvent(JToken token)
        {
            dynamic dynamicToken = token;

            // Turned out that string.IsNullOrEmpty() can throw, if the passed dynamic value is not of a string type.
            // So need to explicitly convert to string first
            string name = dynamicToken.Name;
            if (string.IsNullOrEmpty(name))
            {
                name = dynamicToken.FunctionName;
            }

            return new HistoryEvent
            {
                SequenceNumber = dynamicToken.SequenceNumber,
                Timestamp = dynamicToken.Timestamp,
                EventType = dynamicToken.EventType,
                EventId = dynamicToken.EventId,
                Name = name,
                ScheduledTime = dynamicToken.ScheduledTime,
                Input = dynamicToken.Input?.ToString(),
                Result = dynamicToken.Result?.ToString(),
                // Fallback to FailureDetails, see: https://github.com/microsoft/DurableFunctionsMonitor/issues/174
                Details = dynamicToken.Details?.ToString() ?? dynamicToken.FailureDetails?.ToString(),
                DurationInMs = dynamicToken.DurationInMs,
                SubOrchestrationId = dynamicToken.SubOrchestrationId
            };
        }

        internal static IEnumerable<HistoryEvent> ApplyTimeFrom(this IEnumerable<HistoryEvent> events, DateTime? timeFrom)
        {
            if (timeFrom == null)
            {
                return events;
            }

            return events.Where(evt => evt.Timestamp >= timeFrom);
        }
    }

    /// <summary>
    /// Names of the history event types DfMon reasons about
    /// </summary>
    public static class HistoryEventTypes
    {
        /// <summary>The first event of an execution, carrying the orchestrator's input</summary>
        public const string ExecutionStarted = "ExecutionStarted";

        /// <summary>An external event, carrying its payload</summary>
        public const string EventRaised = "EventRaised";

        /// <summary>Marks the start of an episode (one replay of the orchestrator)</summary>
        public const string OrchestratorStarted = "OrchestratorStarted";

        /// <summary>Marks the end of an episode</summary>
        public const string OrchestratorCompleted = "OrchestratorCompleted";
    }

    /// <summary>
    /// Represents a record in orchestration's history
    /// </summary>
    public class HistoryEvent
    {
        /// <summary>
        /// Position of the event in the instance's history, as the storage provider numbers it.
        /// This is how the input-events endpoints address an event. Null if the provider does not report it.
        /// For a scheduled task or sub-orchestration merged with its completion, it is the position of the scheduling record.
        /// </summary>
        public long? SequenceNumber { get; set; }
        public DateTimeOffset Timestamp { get; set; }
        public string EventType { get; set; }
        public int? EventId { get; set; }
        public string Name { get; set; }
        public DateTimeOffset? ScheduledTime { get; set; }
        public string Input { get; set; }
        public string Result { get; set; }
        public string Details { get; set; }
        public double? DurationInMs { get; set; }
        public string SubOrchestrationId { get; set; }
        /// <summary>
        /// For a 'TimerFired' event, the EventId of the 'TimerCreated' event it fired for.
        /// Null if the storage provider does not report it (e.g. MSSQL).
        /// </summary>
        public int? TimerId { get; set; }
        /// <summary>
        /// The moment a timer is due to fire, as recorded on 'TimerCreated'/'TimerFired' rows.
        /// Null if the storage provider does not report it (e.g. MSSQL).
        /// </summary>
        public DateTimeOffset? FireAt { get; set; }
    }

    // Represents a record in the XXXHistory table.
    //
    // Mapped by hand rather than relying on Azure.Data.Tables' property binder, so that the exact
    // set of Storage columns DfMon depends on stays visible - including "_Timestamp", which the
    // Durable Task Framework writes alongside the system-managed "Timestamp".
    class HistoryEntity
    {
        // The row's sequence number, decoded from its RowKey (16 upper-case hex digits). Null for the 'sentinel' row.
        public long? SequenceNumber { get; set; }
        public string InstanceId { get; set; }
        public string EventType { get; set; }
        public string Name { get; set; }
        public DateTimeOffset _Timestamp { get; set; }
        public string Input { get; set; }
        // Set instead of Input when the Durable Task Framework offloaded a large input into the '{taskhub}-largemessages' container
        public string InputBlobName { get; set; }
        public string Result { get; set; }
        public string Details { get; set; }
        public string FailureDetails { get; set; }
        public int EventId { get; set; }
        public int? TaskScheduledId { get; set; }
        // Set on 'TimerFired' rows: the EventId of the 'TimerCreated' row it correlates to.
        public int? TimerId { get; set; }
        // Set on 'TimerCreated'/'TimerFired' rows: the moment the timer is (was) due to fire.
        public DateTimeOffset? FireAt { get; set; }

        public static HistoryEntity From(TableEntity entity)
        {
            return new HistoryEntity
            {
                SequenceNumber = TryParseSequenceNumber(entity.RowKey),
                InstanceId = entity.GetString("InstanceId"),
                EventType = entity.GetString("EventType"),
                Name = entity.GetString("Name"),
                _Timestamp = entity.GetDateTimeOffset("_Timestamp") ?? default,
                Input = entity.GetString("Input"),
                InputBlobName = entity.GetString("InputBlobName"),
                Result = entity.GetString("Result"),
                Details = entity.GetString("Details"),
                FailureDetails = entity.GetString("FailureDetails"),
                EventId = entity.GetInt32("EventId") ?? default,
                TaskScheduledId = entity.GetInt32("TaskScheduledId"),
                TimerId = entity.GetInt32("TimerId"),
                FireAt = entity.GetDateTimeOffset("FireAt")
            };
        }

        /// <summary>
        /// Decodes the sequence number the Durable Task Framework encodes into a history row's RowKey
        /// (sequenceNumber.ToString("X16")). Returns null for anything else, such as the 'sentinel' row.
        /// </summary>
        internal static long? TryParseSequenceNumber(string rowKey)
        {
            return long.TryParse(rowKey, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out long sequenceNumber) ? sequenceNumber : null;
        }
    }
}
