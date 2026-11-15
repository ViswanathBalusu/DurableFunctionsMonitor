// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// The XXXInstances and XXXHistory rows of a Task Hub, exactly as the Durable Task Framework wrote them.
    ///
    /// Fixtures/real-task-hub.json is an export of the tables of a real Function App (the isolated worker,
    /// Microsoft.Azure.Functions.Worker.Extensions.DurableTask 1.22.0 over DurableTask.AzureStorage 2.11, on
    /// Azurite): two runs of an orchestration that calls activities (one of which fails), a sub-orchestration
    /// with the id the engine gives it and one with an id of its own, a timer and an external event - one run
    /// finished, one still waiting for its event - plus sub-orchestrations of sub-orchestrations, an
    /// orchestration that continued as new twice, and two that failed. Every column is there with the type it
    /// had; the only thing changed is the folder name in the stack traces of the failures.
    ///
    /// Everything DfMon reads straight from these tables assumes something about what the engine writes. The
    /// rows the other tests build by hand say what DfMon assumes; these say what is true.
    /// </summary>
    class RealTaskHub
    {
        public IReadOnlyList<TableEntity> Instances { get; }

        public IReadOnlyList<TableEntity> History { get; }

        /// <summary>The run that finished: activities, two sub-orchestrations, a timer and an event.</summary>
        public const string CompletedParentId = "aa5e03b9e75342528fee200231965d22";

        /// <summary>The run that still waits for its event.</summary>
        public const string RunningParentId = "0850082987504f0e883fa60a0c3d5288";

        /// <summary>The sub-orchestration of <see cref="CompletedParentId"/> that the engine named.</summary>
        public const string GeneratedChildId = "6ecc547cd94e5ed581d71093cedc23de";

        /// <summary>The sub-orchestration of <see cref="GeneratedChildId"/>: two levels down.</summary>
        public const string GrandchildId = "0e6f9ff725dd5eefb45133904657605f";

        /// <summary>The sub-orchestration of <see cref="CompletedParentId"/> that the orchestrator named itself.</summary>
        public const string NamedChildId = "named-child-of-" + CompletedParentId;

        /// <summary>The orchestration that continued as new twice.</summary>
        public const string LooperId = "9f2fe5faf6524aa2b4bbaadf75b4dc6c";

        public static RealTaskHub Load()
        {
            string path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "real-task-hub.json");

            // DateParseHandling.None: a value is the text that was in the table, and a date among them must not be
            // read and written back in another format on its way through
            var export = JsonConvert.DeserializeObject<JObject>(File.ReadAllText(path), new JsonSerializerSettings { DateParseHandling = DateParseHandling.None });

            return new RealTaskHub(ToEntities((JArray)export["Instances"]), ToEntities((JArray)export["History"]));
        }

        private RealTaskHub(List<TableEntity> instances, List<TableEntity> history)
        {
            this.Instances = instances;
            this.History = history;
        }

        /// <summary>
        /// Writes the hub into the two tables. <paramref name="change"/> can alter a row on its way in, to make
        /// the hub of an older engine out of it (one that did not write a column yet).
        /// </summary>
        public async Task WriteToAsync(TableServiceClient service, string instancesTable, string historyTable, Action<TableEntity> change = null)
        {
            await WriteAsync(service.GetTableClient(instancesTable), this.Instances, change);
            await WriteAsync(service.GetTableClient(historyTable), this.History, change);
        }

        private static async Task WriteAsync(Azure.Data.Tables.TableClient table, IEnumerable<TableEntity> rows, Action<TableEntity> change)
        {
            // A transaction takes rows of one partition, a hundred at a time
            foreach (var partition in rows.GroupBy(row => row.PartitionKey))
            {
                foreach (var chunk in partition.Chunk(100))
                {
                    var actions = chunk.Select(row =>
                    {
                        var copy = new TableEntity(row);
                        change?.Invoke(copy);

                        return new TableTransactionAction(TableTransactionActionType.UpsertReplace, copy);
                    });

                    await table.SubmitTransactionAsync(actions);
                }
            }
        }

        private static List<TableEntity> ToEntities(JArray rows)
        {
            var result = new List<TableEntity>();

            foreach (var row in rows)
            {
                var entity = new TableEntity(row.Value<string>("PartitionKey"), row.Value<string>("RowKey"));

                foreach (var property in ((JObject)row["Properties"]).Properties())
                {
                    string value = property.Value.Value<string>("Value");

                    // The EDM type the property had in the table
                    entity[property.Name] = property.Value.Value<string>("Type") switch
                    {
                        "String" => value,
                        "Int32" => int.Parse(value, CultureInfo.InvariantCulture),
                        "Int64" => long.Parse(value, CultureInfo.InvariantCulture),
                        "Boolean" => bool.Parse(value),
                        "Double" => double.Parse(value, CultureInfo.InvariantCulture),
                        "DateTime" => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
                        "Guid" => Guid.Parse(value),
                        string type => throw new NotSupportedException($"A property of type {type} ({property.Name})")
                    };
                }

                result.Add(entity);
            }

            return result;
        }
    }

    /// <summary>
    /// Counts what goes through to the tables: how many requests, of which kind, and how many rows came back.
    /// The point of several of these tests is not only that an answer is right but that it was cheap.
    /// </summary>
    class CountingTableClient : ITableClient
    {
        public CountingTableClient(ITableClient inner)
        {
            this._inner = inner;
        }

        public int PointReads;
        public int Pages;
        public int OtherQueries;
        public int RowsReturned;

        /// <summary>The filters of the pages that were asked for, in order.</summary>
        public List<string> PageFilters { get; } = new List<string>();

        public int Requests => this.PointReads + this.Pages + this.OtherQueries;

        public void Reset()
        {
            this.PointReads = this.Pages = this.OtherQueries = this.RowsReturned = 0;

            lock (this.PageFilters) { this.PageFilters.Clear(); }
        }

        public Task<IEnumerable<string>> ListTableNamesAsync() => this._inner.ListTableNamesAsync();

        public IEnumerable<TableEntity> GetAll(string tableName, string filter)
        {
            Interlocked.Increment(ref this.OtherQueries);

            foreach (var row in this._inner.GetAll(tableName, filter))
            {
                Interlocked.Increment(ref this.RowsReturned);
                yield return row;
            }
        }

        public Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter) => this.GetAllAsync(tableName, filter, CancellationToken.None);

        public async Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter, CancellationToken ct)
        {
            Interlocked.Increment(ref this.OtherQueries);

            var rows = (await this._inner.GetAllAsync(tableName, filter, ct)).ToList();
            Interlocked.Add(ref this.RowsReturned, rows.Count);

            return rows;
        }

        public async Task<(IReadOnlyList<TableEntity> rows, bool truncated)> QueryAsync(string tableName, string filter, IEnumerable<string> select, int maxRows, CancellationToken ct)
        {
            Interlocked.Increment(ref this.OtherQueries);

            var result = await this._inner.QueryAsync(tableName, filter, select, maxRows, ct);
            Interlocked.Add(ref this.RowsReturned, result.rows.Count);

            return result;
        }

        public async Task<TablePage> QueryPageAsync(string tableName, string filter, IEnumerable<string> select, int maxPerPage, string continuationToken, CancellationToken ct)
        {
            Interlocked.Increment(ref this.Pages);
            lock (this.PageFilters) { this.PageFilters.Add(filter); }

            var page = await this._inner.QueryPageAsync(tableName, filter, select, maxPerPage, continuationToken, ct);
            Interlocked.Add(ref this.RowsReturned, page.Rows.Count);

            return page;
        }

        public Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey) => this.GetEntityAsync(tableName, partitionKey, rowKey, null);

        public async Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey, IEnumerable<string> select)
        {
            Interlocked.Increment(ref this.PointReads);

            return await this._inner.GetEntityAsync(tableName, partitionKey, rowKey, select);
        }

        public Task ReplaceEntityAsync(string tableName, TableEntity entity) => this._inner.ReplaceEntityAsync(tableName, entity);

        public Task UpsertEntityAsync(string tableName, TableEntity entity) => this._inner.UpsertEntityAsync(tableName, entity);

        public Task DeleteEntitiesAsync(string tableName, IEnumerable<TableEntity> entities) => this._inner.DeleteEntitiesAsync(tableName, entities);

        private readonly ITableClient _inner;
    }

    /// <summary>
    /// A DurableTaskClient that is nothing but the name of its Task Hub, which is all the storage routines take from one.
    /// </summary>
    class NamedDurableTaskClient : DurableTaskClient
    {
        public NamedDurableTaskClient(string hubName) : base(hubName) { }

        public override ValueTask DisposeAsync() => default;

        public override Microsoft.DurableTask.AsyncPageable<OrchestrationMetadata> GetAllInstancesAsync(OrchestrationQuery filter = null) => throw new NotSupportedException();

        public override Task<OrchestrationMetadata> GetInstancesAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task<PurgeResult> PurgeAllInstancesAsync(PurgeInstancesFilter filter, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task<PurgeResult> PurgeInstanceAsync(string instanceId, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task RaiseEventAsync(string instanceId, string eventName, object eventPayload = null, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task ResumeInstanceAsync(string instanceId, string reason = null, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task<string> ScheduleNewOrchestrationInstanceAsync(Microsoft.DurableTask.TaskName orchestratorName, object input = null, Microsoft.DurableTask.StartOrchestrationOptions options = null, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task SuspendInstanceAsync(string instanceId, string reason = null, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task TerminateInstanceAsync(string instanceId, object output = null, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task<OrchestrationMetadata> WaitForInstanceCompletionAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default) => throw new NotSupportedException();

        public override Task<OrchestrationMetadata> WaitForInstanceStartAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default) => throw new NotSupportedException();
    }

    /// <summary>
    /// The history of an instance as DfMon read it before it read it a page at a time: every row of the
    /// partition, every completion in it, and all the columns of both. Kept as the reference the paged reader
    /// is compared with, on real storage.
    /// </summary>
    static class HistoryReadWhole
    {
        public static async Task<List<HistoryEvent>> ReadAsync(ITableClient tableClient, string hubName, string instanceId)
        {
            var instanceEntity = await tableClient.GetEntityAsync($"{hubName}Instances", instanceId, string.Empty);
            if (instanceEntity == null)
            {
                return new List<HistoryEvent>();
            }

            string executionId = instanceEntity.GetString("ExecutionId") ?? string.Empty;

            string instanceIdFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and ExecutionId eq {executionId}");

            var correlatedEvents = new Dictionary<int, HistoryEntity>();
            foreach (var entity in await tableClient.GetAllAsync($"{hubName}History", $"{instanceIdFilter} and TaskScheduledId ge 0"))
            {
                var historyEntity = HistoryEntity.From(entity);
                correlatedEvents[historyEntity.TaskScheduledId.Value] = historyEntity;
            }

            var result = new List<HistoryEvent>();
            HistoryEntity executionStartedEvent = null;

            foreach (var evt in tableClient.GetAll($"{hubName}History", instanceIdFilter).Select(HistoryEntity.From))
            {
                switch (evt.EventType)
                {
                    case "TaskScheduled":
                    case "SubOrchestrationInstanceCreated":

                        correlatedEvents.TryGetValue(evt.EventId, out var correlatedEvt);
                        if (correlatedEvt != null)
                        {
                            result.Add(ToHistoryEvent(correlatedEvt, evt._Timestamp, evt.Name, correlatedEvt.EventType == "GenericEvent" ? evt.EventType : null, evt.InstanceId, evt.Input, evt.SequenceNumber));
                        }
                        else
                        {
                            result.Add(ToHistoryEvent(evt));
                        }

                        break;
                    case "ExecutionStarted":

                        executionStartedEvent = evt;
                        result.Add(ToHistoryEvent(evt, null, evt.Name));

                        break;
                    case "ExecutionCompleted":
                    case "ExecutionFailed":
                    case "ExecutionTerminated":

                        result.Add(ToHistoryEvent(evt, executionStartedEvent?._Timestamp));

                        break;
                    case "ContinueAsNew":
                    case "TimerCreated":
                    case "TimerFired":
                    case "EventRaised":
                    case "EventSent":

                        result.Add(ToHistoryEvent(evt));

                        break;
                }
            }

            return result;
        }

        private static HistoryEvent ToHistoryEvent(HistoryEntity evt, DateTimeOffset? scheduledTime = null, string functionName = null, string eventType = null, string subOrchestrationId = null, string input = null, long? sequenceNumber = null)
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
                Details = evt.Details ?? evt.FailureDetails,
                SubOrchestrationId = subOrchestrationId ?? evt.InstanceId,
                ScheduledTime = scheduledTime,
                DurationInMs = scheduledTime.HasValue ? (evt._Timestamp - scheduledTime.Value).TotalMilliseconds : 0,
                TimerId = evt.TimerId,
                FireAt = evt.FireAt
            };
        }
    }
}
