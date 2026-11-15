// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// The routines that read the Task Hub tables themselves, against the tables of a real Function App
    /// (<see cref="RealTaskHub"/>) in a real Table endpoint: the answers they give for rows the engine wrote,
    /// and what those answers cost.
    /// </summary>
    [TestClass]
    public class RealTaskHubTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmReal" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._service = new TableServiceClient(StorageEmulator.ConnectionString);
            await this._service.CreateTableIfNotExistsAsync(this.InstancesTable);
            await this._service.CreateTableIfNotExistsAsync(this.HistoryTable);

            this._hub = RealTaskHub.Load();

            // The real client, with a counter in front of it
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            this._realClient = DurableFunctionsMonitor.DotNetIsolated.TableClient.GetTableClient(ConnStringName);
            this._tableClient = new CountingTableClient(this._realClient);

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tableClient;
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;

            if (this._service != null)
            {
                await this._service.DeleteTableAsync(this.InstancesTable);
                await this._service.DeleteTableAsync(this.HistoryTable);
            }
        }

        [TestMethod]
        public void TheCapturedHubIsWhatTheTestsBelowTakeItFor()
        {
            // Every instance row has the column, and it is empty for exactly the ones that nothing started
            Assert.AreEqual(14, this._hub.Instances.Count);
            Assert.IsTrue(this._hub.Instances.All(row => row.ContainsKey("ParentInstanceId")));
            Assert.AreEqual(5, this._hub.Instances.Count(row => row.GetString("ParentInstanceId") == string.Empty));

            Assert.AreEqual(RealTaskHub.CompletedParentId, this.Instance(RealTaskHub.GeneratedChildId).GetString("ParentInstanceId"));
            Assert.AreEqual(RealTaskHub.GeneratedChildId, this.Instance(RealTaskHub.GrandchildId).GetString("ParentInstanceId"));
            Assert.AreEqual(RealTaskHub.CompletedParentId, this.Instance(RealTaskHub.NamedChildId).GetString("ParentInstanceId"));

            // A sub-orchestration's id is not built from its parent's execution id any more
            Assert.IsFalse(RealTaskHub.GeneratedChildId.Contains(':'));

            // The first event of every history says the same, as JSON, and says 'null' for a top-level one
            var executionStarted = this._hub.History.Where(row => row.GetString("EventType") == "ExecutionStarted").ToList();
            Assert.AreEqual(14, executionStarted.Count);
            Assert.IsTrue(executionStarted.All(row => row.ContainsKey("ParentInstance")));
            Assert.AreEqual(5, executionStarted.Count(row => row.GetString("ParentInstance") == "null"));
        }

        [TestMethod]
        public async Task EveryInstanceSaysWhoItsParentIsInOnePointRead()
        {
            await this.WriteHubAsync();

            foreach (var row in this._hub.Instances)
            {
                this._tableClient.Reset();

                string parentInstanceId = await this.GetParentAsync(row.PartitionKey);

                Assert.AreEqual(NullIfEmpty(row.GetString("ParentInstanceId")), parentInstanceId, row.PartitionKey);

                // The row, and nothing else: no query, of either table, for a top-level instance or any other
                Assert.AreEqual(1, this._tableClient.PointReads, row.PartitionKey);
                Assert.AreEqual(1, this._tableClient.Requests, row.PartitionKey);
            }
        }

        [TestMethod]
        public async Task TheRowsOfAnEngineFromBeforeTheColumnAreAnsweredFromTheirHistory()
        {
            // The same hub, without the column the lookup reads first
            await this.WriteHubAsync(row => row.Remove("ParentInstanceId"));

            foreach (var row in this._hub.Instances)
            {
                this._tableClient.Reset();

                string parentInstanceId = await this.GetParentAsync(row.PartitionKey);

                Assert.AreEqual(NullIfEmpty(row.GetString("ParentInstanceId")), parentInstanceId, row.PartitionKey);

                // The row, and the first event of the instance's own history: one partition, one row
                Assert.AreEqual(1, this._tableClient.PointReads, row.PartitionKey);
                Assert.AreEqual(1, this._tableClient.Pages, row.PartitionKey);
                Assert.AreEqual(2, this._tableClient.Requests, row.PartitionKey);
                Assert.AreEqual(1, this._tableClient.RowsReturned, row.PartitionKey);
            }
        }

        [TestMethod]
        public async Task ReadsTheHistoryOfEveryInstanceAsItWasReadBefore()
        {
            await this.WriteHubAsync();

            int events = 0;

            foreach (var row in this._hub.Instances)
            {
                var expected = await HistoryReadWhole.ReadAsync(this._realClient, this._hubName, row.PartitionKey);

                var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, ConnStringName, this._hubName, row.PartitionKey)).ToList();

                Assert.AreEqual(Serialize(expected), Serialize(history), row.PartitionKey);

                events += history.Count;
            }

            Assert.AreEqual(57, events);
        }

        [TestMethod]
        public async Task TheHistoryOfTheFinishedRunIsWhatItDid()
        {
            await this.WriteHubAsync();

            var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, ConnStringName, this._hubName, RealTaskHub.CompletedParentId)).ToList();

            CollectionAssert.AreEqual(
                new[]
                {
                    "ExecutionStarted",
                    "TaskCompleted", "TaskCompleted", "TaskCompleted",
                    "TaskFailed",
                    "SubOrchestrationInstanceCompleted", "SubOrchestrationInstanceCompleted",
                    "TimerCreated", "TimerFired",
                    "EventRaised",
                    "ExecutionCompleted"
                },
                history.Select(e => e.EventType).ToArray());

            var started = history[0];
            Assert.AreEqual("Parent", started.Name);
            Assert.AreEqual(1, started.SequenceNumber);
            Assert.AreEqual("{\"requestedBy\":\"probe\",\"count\":3}", started.Input);

            // An activity is one event: scheduled and completed, addressed by the row that scheduled it
            var firstActivity = history[1];
            Assert.AreEqual("SayHello", firstActivity.Name);
            Assert.AreEqual(2, firstActivity.SequenceNumber);
            Assert.AreEqual(0, firstActivity.EventId);
            Assert.AreEqual("\"Hello Tokyo!\"", firstActivity.Result);

            // What it was called with is not in the history: the engine keeps the inputs of tasks out of it
            // unless it is told otherwise (storeInputsInOrchestrationHistory)
            Assert.IsNull(firstActivity.Input);
            Assert.IsNotNull(firstActivity.ScheduledTime);
            Assert.IsTrue(firstActivity.DurationInMs > 0);

            // The failure is in FailureDetails, where this engine writes it
            var failed = history[4];
            Assert.AreEqual("Fail", failed.Name);
            StringAssert.Contains(failed.Details, "Failed on purpose");

            // A sub-orchestration with the id the engine gave it, and one with the id the orchestrator gave it
            Assert.AreEqual(RealTaskHub.GeneratedChildId, history[5].SubOrchestrationId);
            Assert.AreEqual(RealTaskHub.NamedChildId, history[6].SubOrchestrationId);
            Assert.AreEqual("Child", history[5].Name);

            var timerCreated = history[7];
            var timerFired = history[8];
            Assert.AreEqual(6, timerFired.TimerId);
            Assert.AreEqual(timerCreated.FireAt, timerFired.FireAt);

            Assert.AreEqual("Go", history[9].Name);
            Assert.AreEqual("{\"approved\":true}", history[9].Input);

            // The end of the execution is measured from its start
            var completed = history[10];
            Assert.AreEqual(started.Timestamp, completed.ScheduledTime);
            Assert.IsTrue(completed.DurationInMs > 1000, "there was a one second timer in it");
        }

        [TestMethod]
        public async Task ReadingAHistoryBringsItsEventsAndTheirCompletionsAndNothingElse()
        {
            await this.WriteHubAsync();

            int rowsInThePartition = this._hub.History.Count(row => row.PartitionKey == RealTaskHub.CompletedParentId);

            this._tableClient.Reset();

            var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, ConnStringName, this._hubName, RealTaskHub.CompletedParentId)).ToList();

            // The instance row, a page of events, and the completions of what that page scheduled
            Assert.AreEqual(1, this._tableClient.PointReads);
            Assert.AreEqual(2, this._tableClient.Pages);
            Assert.AreEqual(3, this._tableClient.Requests);

            // 11 events, and the 6 rows that completed the 4 activities and the 2 sub-orchestrations.
            // The other 19 of the partition's 36 - the markers of every episode and the sentinel - stayed where they are.
            Assert.AreEqual(11, history.Count);
            Assert.AreEqual(36, rowsInThePartition);
            Assert.AreEqual(17, this._tableClient.RowsReturned);
        }

        [TestMethod]
        public async Task AnInstanceThatWaitsHasAHistoryWithoutAnEnd()
        {
            await this.WriteHubAsync();

            var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, ConnStringName, this._hubName, RealTaskHub.RunningParentId)).ToList();

            // Everything up to the timer, and then it waits for an event nobody raised
            Assert.AreEqual("TimerFired", history.Last().EventType);
            Assert.IsFalse(history.Any(e => e.EventType == "EventRaised" || e.EventType == "ExecutionCompleted"));
        }

        [TestMethod]
        public async Task AnInstanceThatContinuedAsNewShowsItsCurrentExecution()
        {
            await this.WriteHubAsync();

            var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, ConnStringName, this._hubName, RealTaskHub.LooperId)).ToList();

            CollectionAssert.AreEqual(
                new[] { "ExecutionStarted", "TaskCompleted", "SubOrchestrationInstanceCompleted", "ExecutionCompleted" },
                history.Select(e => e.EventType).ToArray());

            // The last of the three rounds
            Assert.AreEqual("\"Hello round 1!\"", history[1].Result);
        }

        [TestMethod]
        public async Task TheStatisticsOfTheHubCountItsRows()
        {
            await this.WriteHubAsync();

            var created = this._hub.Instances.Select(row => row.GetDateTimeOffset("CreatedTime").Value).ToList();

            var result = await new DfmExtensionPoints().GetStatsRoutine(
                null,
                ConnStringName,
                this._hubName,
                new StatsQuery { From = created.Min().AddMinutes(-1), To = created.Max().AddMinutes(1), Cap = 1000 },
                CancellationToken.None);

            Assert.AreEqual(14, result.Scanned);
            Assert.IsFalse(result.Partial);
            Assert.AreEqual(14, result.Totals[StatsAggregator.AllKey]);

            foreach (var status in this._hub.Instances.GroupBy(row => row.GetString("RuntimeStatus")))
            {
                Assert.AreEqual(status.Count(), result.Totals[status.Key], status.Key);
            }
        }

        [TestMethod]
        public async Task TheListOfInstancesSaysOfEveryRowWhatTheRowSays()
        {
            await this.WriteHubAsync();

            this._tableClient.Reset();

            var instances = await this.ListInstancesAsync(new OrchestrationQuery());

            // A hub this small is one request, and its rows
            Assert.AreEqual(1, this._tableClient.Pages);
            Assert.AreEqual(1, this._tableClient.Requests);
            Assert.AreEqual(14, this._tableClient.RowsReturned);

            // In the order of the table
            var rows = this._hub.Instances.OrderBy(row => row.PartitionKey, StringComparer.Ordinal).ToList();

            Assert.AreEqual(rows.Count, instances.Count);

            for (int i = 0; i < rows.Count; i++)
            {
                var row = rows[i];
                var instance = instances[i];

                Assert.AreEqual(row.PartitionKey, instance.InstanceId);
                Assert.AreEqual(row.GetString("Name"), instance.Name, row.PartitionKey);
                Assert.AreEqual(row.GetString("RuntimeStatus"), instance.RuntimeStatus.ToString(), row.PartitionKey);
                Assert.AreEqual(row.GetDateTimeOffset("CreatedTime"), instance.CreatedAt, row.PartitionKey);
                Assert.AreEqual(row.GetDateTimeOffset("LastUpdatedTime"), instance.LastUpdatedAt, row.PartitionKey);
                Assert.AreEqual(row.GetString("CustomStatus"), instance.SerializedCustomStatus, row.PartitionKey);

                // The list does not carry what it was not asked for
                Assert.IsNull(instance.SerializedInput, row.PartitionKey);
                Assert.IsNull(instance.SerializedOutput, row.PartitionKey);
            }

            // What the engine wrote is a time, a name and a status for every one of them
            Assert.IsTrue(instances.All(i => i.CreatedAt > DateTimeOffset.UnixEpoch && i.LastUpdatedAt >= i.CreatedAt));
            Assert.IsTrue(instances.All(i => !string.IsNullOrEmpty(i.Name)));
            Assert.IsTrue(instances.All(i => Enum.IsDefined(i.RuntimeStatus)));

            // And it is the same list for a caller that may not read all of it, at the same price
            this._tableClient.Reset();

            var unsorted = await this.ListInstancesAsync(new OrchestrationQuery(), readToEnd: false);

            CollectionAssert.AreEqual(instances.Select(i => i.InstanceId).ToArray(), unsorted.Select(i => i.InstanceId).ToArray());
            Assert.AreEqual(1, this._tableClient.Requests);
        }

        [TestMethod]
        public async Task TheListOfInstancesOfAStatusIsTheRowsWithThatStatus()
        {
            await this.WriteHubAsync();

            var statuses = this._hub.Instances.GroupBy(row => row.GetString("RuntimeStatus")).ToList();

            Assert.IsTrue(statuses.Count >= 3, "the hub has finished, failed and running instances");

            foreach (var status in statuses)
            {
                var instances = await this.ListInstancesAsync(new OrchestrationQuery { Statuses = new[] { Enum.Parse<OrchestrationRuntimeStatus>(status.Key) } });

                CollectionAssert.AreEqual(
                    status.Select(row => row.PartitionKey).OrderBy(id => id, StringComparer.Ordinal).ToArray(),
                    instances.Select(i => i.InstanceId).ToArray(),
                    status.Key);
            }
        }

        [TestMethod]
        public async Task TheListOfInstancesOfATimeRangeIsTheRowsCreatedInIt()
        {
            await this.WriteHubAsync();

            // From the moment the third instance was created to the moment the tenth was, both of them in it
            var created = this._hub.Instances.Select(row => row.GetDateTimeOffset("CreatedTime").Value).OrderBy(time => time).ToList();
            var from = created[2];
            var to = created[9];

            var instances = await this.ListInstancesAsync(new OrchestrationQuery { CreatedFrom = from, CreatedTo = to });

            var expected = this._hub.Instances
                .Where(row => row.GetDateTimeOffset("CreatedTime").Value >= from && row.GetDateTimeOffset("CreatedTime").Value <= to)
                .Select(row => row.PartitionKey)
                .OrderBy(id => id, StringComparer.Ordinal)
                .ToArray();

            Assert.IsTrue(expected.Length >= 8 && expected.Length < 14);
            CollectionAssert.AreEqual(expected, instances.Select(i => i.InstanceId).ToArray());
        }

        private async Task<List<OrchestrationMetadata>> ListInstancesAsync(OrchestrationQuery query, bool readToEnd = true)
        {
            var instances = AzureStorageInstances.List(null, ConnStringName, this._hubName, query, readToEnd);

            Assert.IsNotNull(instances, "this query is the table's to answer");

            var result = new List<OrchestrationMetadata>();
            await foreach (var instance in instances)
            {
                result.Add(instance);
            }

            return result;
        }

        private Task<string> GetParentAsync(string instanceId)
        {
            return DetailedOrchestrationStatus.GetParentInstanceIdDirectlyFromTable(new NamedDurableTaskClient(this._hubName), ConnStringName, this._hubName, instanceId);
        }

        private Task WriteHubAsync(Action<TableEntity> change = null)
        {
            return this._hub.WriteToAsync(this._service, this.InstancesTable, this.HistoryTable, change);
        }

        private TableEntity Instance(string instanceId)
        {
            return this._hub.Instances.Single(row => row.PartitionKey == instanceId);
        }

        private static string NullIfEmpty(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }

        private static string Serialize(IEnumerable<HistoryEvent> events)
        {
            return JsonConvert.SerializeObject(events, Formatting.Indented);
        }

        private string InstancesTable => this._hubName + "Instances";
        private string HistoryTable => this._hubName + "History";

        private string _hubName;
        private TableServiceClient _service;
        private RealTaskHub _hub;
        private ITableClient _realClient;
        private CountingTableClient _tableClient;

        private const string ConnStringName = "DfmTestRealTaskHubConnString";
    }
}
