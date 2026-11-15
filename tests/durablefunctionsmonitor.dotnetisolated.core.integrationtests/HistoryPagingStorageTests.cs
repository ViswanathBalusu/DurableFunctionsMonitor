// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// The history of an instance that is longer than one request returns, in a real Table endpoint: a few
    /// thousand events, read a page at a time, with the completions of its tasks fetched as they are needed.
    /// It must be the history that reading the whole partition gives (<see cref="HistoryReadWhole"/>), and a
    /// page of it must not cost the whole of it.
    ///
    /// One instance for the whole class, because nothing here changes it.
    /// </summary>
    [TestClass]
    public class HistoryPagingStorageTests
    {
        private const string InstanceId = "long-running-instance";
        private const string ExecutionId = "9d6c1f0e";

        // How many times the orchestrator went round its loop
        private const int Rounds = 900;

        [ClassInitialize]
        public static async Task ClassInit(TestContext context)
        {
            if (!StorageEmulator.IsAvailable)
            {
                return;
            }

            _hubName = "DfmHist" + Guid.NewGuid().ToString("N").Substring(0, 12);

            _service = new TableServiceClient(StorageEmulator.ConnectionString);
            await _service.CreateTableIfNotExistsAsync(_hubName + "Instances");
            await _service.CreateTableIfNotExistsAsync(_hubName + "History");

            await _service.GetTableClient(_hubName + "Instances").UpsertEntityAsync(new TableEntity(InstanceId, string.Empty)
            {
                ["ExecutionId"] = ExecutionId,
                ["Name"] = "LongRunner",
                ["RuntimeStatus"] = "Running",
                ["Input"] = new string('i', 20000)
            });

            _rows = BuildHistory();

            var history = _service.GetTableClient(_hubName + "History");

            foreach (var chunk in _rows.Chunk(100))
            {
                await history.SubmitTransactionAsync(chunk.Select(row => new TableTransactionAction(TableTransactionActionType.UpsertReplace, row)));
            }
        }

        [ClassCleanup]
        public static async Task ClassCleanup()
        {
            if (_service != null)
            {
                await _service.DeleteTableAsync(_hubName + "Instances");
                await _service.DeleteTableAsync(_hubName + "History");
            }
        }

        [TestInitialize]
        public void TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            this._realClient = DurableFunctionsMonitor.DotNetIsolated.TableClient.GetTableClient(ConnStringName);
            this._tableClient = new CountingTableClient(this._realClient);

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tableClient;
        }

        [TestCleanup]
        public void TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
        }

        /// <summary>
        /// An orchestrator that goes round a loop: an activity that completes at once, a timer, and every so often
        /// a sub-orchestration that takes long to come back, an activity that was rewound, an event. Laid out the
        /// way the engine lays a history out, episode by episode, with the columns it writes.
        /// </summary>
        private static List<TableEntity> BuildHistory()
        {
            var rows = new List<TableEntity>();
            long sequenceNumber = 0;
            int eventId = 0;

            // Completions on their way, by the round they arrive in
            var arriving = new Dictionary<int, List<Action<TableEntity>>>();

            TableEntity Next(string eventType)
            {
                var row = new TableEntity(InstanceId, sequenceNumber.ToString("X16"))
                {
                    ["ExecutionId"] = ExecutionId,
                    ["EventType"] = eventType,
                    ["EventId"] = -1,
                    ["IsPlayed"] = true,
                    ["_Timestamp"] = StartTime.AddSeconds(sequenceNumber),
                    ["OrchestrationInstance"] = "{\"InstanceId\":\"" + InstanceId + "\",\"ExecutionId\":\"" + ExecutionId + "\"}"
                };

                sequenceNumber++;
                rows.Add(row);

                return row;
            }

            void Arrive(int round, string eventType, Action<TableEntity> fill)
            {
                if (!arriving.TryGetValue(round, out var list))
                {
                    arriving[round] = list = new List<Action<TableEntity>>();
                }

                list.Add(row => { row["EventType"] = eventType; fill(row); });
            }

            Next("OrchestratorStarted");

            var started = Next("ExecutionStarted");
            started["Name"] = "LongRunner";
            started["Input"] = "{\"rounds\":" + Rounds + "}";
            started["ParentInstance"] = "null";

            for (int round = 0; round < Rounds; round++)
            {
                // What came back in the meantime opens the episode
                if (arriving.TryGetValue(round, out var arrived))
                {
                    foreach (var fill in arrived)
                    {
                        fill(Next("to be filled"));
                    }
                }

                int activityId = eventId++;
                var scheduled = Next("TaskScheduled");
                scheduled["EventId"] = activityId;
                scheduled["Name"] = "DoWork";

                Arrive(round + 1, "TaskCompleted", row =>
                {
                    row["TaskScheduledId"] = activityId;
                    row["Result"] = $"\"work of round {activityId}\"";
                });

                int timerId = eventId++;
                var fireAt = StartTime.AddHours(round);
                var timer = Next("TimerCreated");
                timer["EventId"] = timerId;
                timer["FireAt"] = fireAt;

                Arrive(round + 1, "TimerFired", row =>
                {
                    row["TimerId"] = timerId;
                    row["FireAt"] = fireAt;
                });

                if (round % 10 == 3)
                {
                    // A sub-orchestration that comes back hundreds of rounds later, if at all
                    int subOrchestrationId = eventId++;
                    var created = Next("SubOrchestrationInstanceCreated");
                    created["EventId"] = subOrchestrationId;
                    created["Name"] = "SlowChild";
                    created["InstanceId"] = $"slow-child-{subOrchestrationId}";

                    Arrive(round + 350, "SubOrchestrationInstanceCompleted", row =>
                    {
                        row["TaskScheduledId"] = subOrchestrationId;
                        row["Result"] = "\"slow, but done\"";
                    });
                }

                if (round % 97 == 5)
                {
                    // What a rewind leaves of a failed task: its old outcome, as a GenericEvent with the same id,
                    // long after the task itself completed
                    Arrive(round + 500, "GenericEvent", row => row["TaskScheduledId"] = activityId);
                }

                if (round % 50 == 7)
                {
                    var raised = Next("EventRaised");
                    raised["Name"] = "Nudge";
                    raised["Input"] = "{\"round\":" + round + "}";
                }

                Next("OrchestratorCompleted");
                Next("OrchestratorStarted");
            }

            // What an execution before this one left behind, with ids this one uses as well
            for (int i = 0; i < 6; i++)
            {
                var stale = Next(i % 2 == 0 ? "TaskScheduled" : "TaskCompleted");
                stale["ExecutionId"] = "an-earlier-execution";
                stale[i % 2 == 0 ? "EventId" : "TaskScheduledId"] = i / 2;
            }

            rows.Add(new TableEntity(InstanceId, "sentinel") { ["ExecutionId"] = ExecutionId });

            return rows;
        }

        private Task<IEnumerable<HistoryEvent>> GetHistoryAsync()
        {
            return OrchestrationHistory.GetHistoryDirectlyFromTable(null, ConnStringName, _hubName, InstanceId);
        }

        private static string Serialize(IEnumerable<HistoryEvent> events)
        {
            return JsonConvert.SerializeObject(events, Formatting.Indented);
        }

        [TestMethod]
        public async Task ThePartitionIsLongerThanAFewRequestsReturn()
        {
            Assert.IsTrue(_rows.Count > 5000, $"{_rows.Count} rows");

            var whole = await HistoryReadWhole.ReadAsync(this._realClient, _hubName, InstanceId);

            Assert.IsTrue(whole.Count > 2000, $"{whole.Count} events");
        }

        [TestMethod]
        public async Task TheWholeHistoryIsWhatReadingThePartitionGives()
        {
            var expected = await HistoryReadWhole.ReadAsync(this._realClient, _hubName, InstanceId);

            this._tableClient.Reset();

            var history = (await this.GetHistoryAsync()).ToList();

            Assert.AreEqual(expected.Count, history.Count);
            Assert.AreEqual(Serialize(expected), Serialize(history));

            // And it took fewer rows to get there: the markers of nine hundred episodes were never sent
            int markers = _rows.Count(row => row.GetString("EventType") is "OrchestratorStarted" or "OrchestratorCompleted");
            Assert.IsTrue(this._tableClient.RowsReturned < _rows.Count - markers + 1100, $"{this._tableClient.RowsReturned} rows were read of {_rows.Count}");
        }

        [TestMethod]
        [DataRow(0, 200)]
        [DataRow(800, 200)]
        [DataRow(1000, 200)]
        [DataRow(1900, 250)]
        public async Task APageOfItIsThatPageOfTheWhole(int skip, int top)
        {
            var expected = (await HistoryReadWhole.ReadAsync(this._realClient, _hubName, InstanceId)).Skip(skip).Take(top);

            var page = (await this.GetHistoryAsync()).Skip(skip).Take(top).ToList();

            Assert.AreEqual(top, page.Count);
            Assert.AreEqual(Serialize(expected), Serialize(page));
        }

        [TestMethod]
        public async Task TheFirstPagesOfItCostAPageOfEventsAndTheirCompletions()
        {
            this._tableClient.Reset();

            var page = (await this.GetHistoryAsync()).Take(200).ToList();

            Assert.AreEqual(200, page.Count);

            // The instance row; one page of events; the completions of what that page scheduled, which fit
            // into one more. Not the five thousand rows of the partition, and not every completion in it.
            Assert.AreEqual(1, this._tableClient.PointReads);
            Assert.AreEqual(2, this._tableClient.Pages);
            Assert.AreEqual(0, this._tableClient.OtherQueries);

            Assert.IsTrue(this._tableClient.RowsReturned < 1600, $"{this._tableClient.RowsReturned} rows were read for the first 200 events");
            Assert.IsFalse(this._tableClient.PageFilters.Any(filter => filter.EndsWith("TaskScheduledId ge 0")), "every completion of the history was read");
        }

        [TestMethod]
        public async Task ATaskIsShownWithItsLatestOutcomeHoweverLateItCame()
        {
            var history = (await this.GetHistoryAsync()).Take(100).ToList();

            // Scheduled in round 3, completed 350 rounds and well over a thousand rows later: the first page shows it completed
            var slowChild = history.First(e => e.Name == "SlowChild");
            Assert.AreEqual("SubOrchestrationInstanceCompleted", slowChild.EventType);
            Assert.AreEqual("\"slow, but done\"", slowChild.Result);
            Assert.IsTrue(slowChild.SubOrchestrationId.StartsWith("slow-child-"));

            // Completed in round 6, and then, 500 rounds later, the leftover of a rewind with the same id.
            // The latest row with a task's id is its outcome, and a GenericEvent is shown as the task itself.
            var rewound = history.Where(e => e.Name == "DoWork").ElementAt(5);
            Assert.AreEqual("TaskScheduled", rewound.EventType);
        }

        private static readonly DateTimeOffset StartTime = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);

        private static string _hubName;
        private static TableServiceClient _service;
        private static List<TableEntity> _rows;

        private ITableClient _realClient;
        private CountingTableClient _tableClient;

        private const string ConnStringName = "DfmTestHistoryPagingConnString";
    }
}
