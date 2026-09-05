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
        public static async Task<IEnumerable<HistoryEvent>> GetHistoryDirectlyFromTable(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            var tableClient = TableClient.GetTableClient(connName);

            // Need to fetch executionId first

            var instanceEntity = await tableClient.GetEntityAsync($"{hubName}Instances", instanceId, string.Empty);
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
            string instanceIdFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and ExecutionId eq {executionId}");

            // Fetching _all_ correlated events with a separate parallel query. This seems to be the only option.
            string correlatedEventsFilter = $"{instanceIdFilter} and TaskScheduledId ge 0";

            var correlatedEventsTask = tableClient
                .GetAllAsync($"{hubName}History", correlatedEventsFilter)
                .ContinueWith(t => {

                    // It turned out that there can be entities with duplicated TaskScheduleId (not sure why).
                    // So creating this map manually (instead of using .ToDictionary())
                    var correlatedEventsMap = new Dictionary<int, HistoryEntity>();

                    foreach (var entity in t.Result)
                    {
                        var historyEntity = HistoryEntity.From(entity);
                        correlatedEventsMap[historyEntity.TaskScheduledId.Value] = historyEntity;
                    }

                    return correlatedEventsMap;
                });

            // Fetching the history.
            // Intentionally using the synchronous method, since not all results might be iterated
            var queryResults = tableClient.GetAll($"{hubName}History", instanceIdFilter).Select(HistoryEntity.From);

            return EnumerateEvents(queryResults, correlatedEventsTask);
        }

        private static IEnumerable<HistoryEvent> EnumerateEvents(IEnumerable<HistoryEntity> events, Task<Dictionary<int, HistoryEntity>> correlatedEventsTask)
        {
            // Memorizing 'ExecutionStarted' event, to further correlate with 'ExecutionCompleted'
            HistoryEntity executionStartedEvent = null;

            foreach (var evt in events)
            {
                switch (evt.EventType)
                {
                    case "TaskScheduled":
                    case "SubOrchestrationInstanceCreated":

                        // Trying to match the completion event
                        correlatedEventsTask.Result.TryGetValue(evt.EventId, out var correlatedEvt);
                        if (correlatedEvt != null)
                        {
                            yield return correlatedEvt.ToHistoryEvent
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
                        else
                        {
                            yield return evt.ToHistoryEvent();
                        }

                        break;
                    case "ExecutionStarted":

                        executionStartedEvent = evt;

                        yield return evt.ToHistoryEvent(null, evt.Name);

                        break;
                    case "ExecutionCompleted":
                    case "ExecutionFailed":
                    case "ExecutionTerminated":

                        yield return evt.ToHistoryEvent(executionStartedEvent?._Timestamp);

                        break;
                    case "ContinueAsNew":
                    case "TimerCreated":
                    case "TimerFired":
                    case "EventRaised":
                    case "EventSent":

                        yield return evt.ToHistoryEvent();

                        break;
                }
            }
        }

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
