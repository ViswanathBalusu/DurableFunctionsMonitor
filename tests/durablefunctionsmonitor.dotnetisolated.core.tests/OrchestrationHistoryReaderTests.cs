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

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The default history routine reads an instance's history a page at a time, asks only for the rows that
    /// become events, and fetches the completions of tasks as it needs them. These tests hold it to two things:
    /// it returns exactly what reading everything returned (<see cref="ReadEverything"/> is that algorithm, kept
    /// here as the reference), and it costs what it says it costs.
    /// </summary>
    [TestClass]
    public class OrchestrationHistoryReaderTests
    {
        private const string InstanceId = "my-instance";
        private const string ExecutionId = "exec-current";

        private InMemoryTableClient _tables;

        [TestInitialize]
        public void TestInit()
        {
            this._tables = new InMemoryTableClient();

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tables;
        }

        [TestCleanup]
        public void TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
        }

        private static Task<IEnumerable<HistoryEvent>> GetHistoryAsync()
        {
            return OrchestrationHistory.GetHistoryDirectlyFromTable(null, "SomeConnString", "Hub", InstanceId);
        }

        private void AddInstance(IEnumerable<TableEntity> historyRows)
        {
            this._tables.Add("HubInstances", new TableEntity(InstanceId, string.Empty)
            {
                ["ExecutionId"] = ExecutionId,
                ["Input"] = new string('x', 10000)
            });

            this._tables.Add("HubHistory", historyRows.ToArray());
        }

        private static string Serialize(IEnumerable<HistoryEvent> events)
        {
            return JsonConvert.SerializeObject(events, Formatting.Indented);
        }

        #region The history as it was read before: every row, every completion

        private static List<HistoryEvent> ReadEverything(IEnumerable<TableEntity> historyTable)
        {
            var rows = historyTable
                .Where(row => row.PartitionKey == InstanceId && row.GetString("ExecutionId") == ExecutionId)
                .OrderBy(row => row.RowKey, StringComparer.Ordinal)
                .Select(HistoryEntity.From)
                .ToList();

            var correlatedEvents = new Dictionary<int, HistoryEntity>();
            foreach (var row in rows.Where(row => row.TaskScheduledId >= 0))
            {
                correlatedEvents[row.TaskScheduledId.Value] = row;
            }

            var result = new List<HistoryEvent>();
            HistoryEntity executionStartedEvent = null;

            foreach (var evt in rows)
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

        #endregion

        #region Histories

        private static readonly DateTimeOffset StartTime = new DateTimeOffset(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);

        private static TableEntity Row(long sequenceNumber, string eventType, string executionId = ExecutionId, string instanceId = InstanceId)
        {
            return new TableEntity(instanceId, sequenceNumber.ToString("X16"))
            {
                ["ExecutionId"] = executionId,
                ["EventType"] = eventType,
                ["EventId"] = -1,
                ["IsPlayed"] = false,
                ["_Timestamp"] = StartTime.AddMilliseconds(sequenceNumber * 10),

                // A column the engine writes and nothing here reads
                ["OrchestrationInstance"] = "{\"InstanceId\":\"" + instanceId + "\",\"ExecutionId\":\"" + executionId + "\"}"
            };
        }

        /// <summary>
        /// A history of about the given number of rows with everything a real one has in it: episodes, activities
        /// and sub-orchestrations that complete at once, late, twice or never, timers, events in and out, rows of
        /// a previous execution left behind, the sentinel row, and another instance's history next to it.
        /// </summary>
        private static List<TableEntity> GenerateHistory(int size, int seed)
        {
            var random = new Random(seed);
            var rows = new List<TableEntity>();

            long sequenceNumber = 0;
            int nextEventId = 0;

            // Completions that are due, by the sequence number they arrive at
            var due = new SortedDictionary<long, List<TableEntity>>();

            void CompleteLater(TableEntity completion, long delay)
            {
                long at = sequenceNumber + delay;

                if (!due.TryGetValue(at, out var list))
                {
                    due[at] = list = new List<TableEntity>();
                }

                list.Add(completion);
            }

            TableEntity Next(string eventType)
            {
                var row = Row(sequenceNumber++, eventType);
                rows.Add(row);
                return row;
            }

            Next("OrchestratorStarted");

            var started = Next("ExecutionStarted");
            started["Name"] = "MyOrchestrator";
            started["Input"] = "{\"seed\":" + seed + "}";

            while (sequenceNumber < size)
            {
                // What arrived in the meantime is appended first, as its own rows
                foreach (long at in due.Keys.Where(at => at <= sequenceNumber).ToList())
                {
                    foreach (var completion in due[at])
                    {
                        var row = Next(completion.GetString("EventType"));

                        foreach (var pair in completion.Where(p => p.Key != "PartitionKey" && p.Key != "RowKey" && p.Key != "_Timestamp" && p.Key != "odata.etag" && p.Key != "Timestamp"))
                        {
                            row[pair.Key] = pair.Value;
                        }
                    }

                    due.Remove(at);
                }

                int dice = random.Next(100);

                if (dice < 40)
                {
                    int eventId = nextEventId++;

                    var scheduled = Next("TaskScheduled");
                    scheduled["EventId"] = eventId;
                    scheduled["Name"] = $"Activity{eventId % 7}";
                    scheduled["Input"] = $"[{eventId}]";

                    int outcome = random.Next(100);
                    if (outcome < 90)
                    {
                        var completed = Row(0, outcome < 80 ? "TaskCompleted" : "TaskFailed");
                        completed["TaskScheduledId"] = eventId;

                        if (outcome < 80)
                        {
                            completed["Result"] = $"\"result of {eventId}\"";
                        }
                        else if (outcome < 85)
                        {
                            completed["Details"] = $"failure of {eventId}";
                        }
                        else
                        {
                            completed["FailureDetails"] = "{\"ErrorType\":\"System.Exception\",\"ErrorMessage\":\"failure of " + eventId + "\"}";
                        }

                        // Mostly right away, sometimes much later, well past the page it was scheduled in
                        CompleteLater(completed, random.Next(10) == 0 ? random.Next(1500, 4000) : random.Next(1, 6));

                        if (random.Next(25) == 0)
                        {
                            // And once more: a rewind leaves the old outcome behind as a GenericEvent
                            var leftover = Row(0, "GenericEvent");
                            leftover["TaskScheduledId"] = eventId;
                            CompleteLater(leftover, random.Next(1, 3000));
                        }
                    }
                }
                else if (dice < 50)
                {
                    int eventId = nextEventId++;

                    var created = Next("SubOrchestrationInstanceCreated");
                    created["EventId"] = eventId;
                    created["Name"] = "ChildOrchestrator";
                    created["InstanceId"] = $"{ExecutionId}:{eventId}";
                    created["Input"] = "null";

                    if (random.Next(10) < 8)
                    {
                        var completed = Row(0, random.Next(5) == 0 ? "SubOrchestrationInstanceFailed" : "SubOrchestrationInstanceCompleted");
                        completed["TaskScheduledId"] = eventId;
                        completed["Result"] = "\"done\"";
                        CompleteLater(completed, random.Next(1, 2500));
                    }
                }
                else if (dice < 60)
                {
                    int eventId = nextEventId++;
                    var fireAt = StartTime.AddMinutes(eventId);

                    var created = Next("TimerCreated");
                    created["EventId"] = eventId;
                    created["FireAt"] = fireAt;

                    var fired = Row(0, "TimerFired");
                    fired["TimerId"] = eventId;
                    fired["FireAt"] = fireAt;
                    CompleteLater(fired, random.Next(1, 40));
                }
                else if (dice < 68)
                {
                    var raised = Next("EventRaised");
                    raised["Name"] = "Approval";
                    raised["Input"] = "true";
                }
                else if (dice < 72)
                {
                    var sent = Next("EventSent");
                    sent["Name"] = "Notify";
                    sent["InstanceId"] = "other-instance";
                    sent["Input"] = "{}";
                }
                else
                {
                    // The end of an episode and the start of the next one
                    Next("OrchestratorCompleted");
                    Next("OrchestratorStarted");
                }
            }

            if (seed % 2 == 0)
            {
                var completed = Next(seed % 4 == 0 ? "ExecutionCompleted" : "ExecutionFailed");
                completed["Result"] = "\"the end\"";
            }

            Next("OrchestratorCompleted");

            // What an earlier execution left behind, past the end of this one: rows with task ids this one uses too
            for (int i = 0; i < 20; i++)
            {
                var stale = Row(sequenceNumber + i, i % 2 == 0 ? "TaskScheduled" : "TaskCompleted", executionId: "exec-previous");
                stale[i % 2 == 0 ? "EventId" : "TaskScheduledId"] = i / 2;
                rows.Add(stale);
            }

            rows.Add(new TableEntity(InstanceId, "sentinel") { ["ExecutionId"] = ExecutionId });

            // And a neighbour
            for (int i = 0; i < 10; i++)
            {
                var other = Row(i, i % 2 == 0 ? "TaskScheduled" : "TaskCompleted", instanceId: "my-instance-2");
                other[i % 2 == 0 ? "EventId" : "TaskScheduledId"] = i / 2;
                rows.Add(other);
            }

            return rows;
        }

        #endregion

        [TestMethod]
        [DataRow(30, 1, 1000, int.MaxValue)]
        [DataRow(400, 2, 1000, int.MaxValue)]
        [DataRow(2500, 3, 1000, int.MaxValue)]
        [DataRow(6000, 4, 1000, int.MaxValue)]
        // Small pages, so that a history of a few thousand rows is dozens of them
        [DataRow(3000, 5, 100, int.MaxValue)]
        [DataRow(3000, 6, 7, int.MaxValue)]
        // A service that answers before a page is full, and often with an empty one
        [DataRow(3000, 7, 1000, 250)]
        [DataRow(3000, 8, 50, 13)]
        [DataRow(1200, 9, 1000, 1)]
        public async Task ReturnsExactlyWhatReadingEverythingReturned(int size, int seed, int pageLimit, int scanLimit)
        {
            var rows = GenerateHistory(size, seed);
            var expected = ReadEverything(rows);

            this.AddInstance(rows);
            this._tables.ServerPageLimit = pageLimit;
            this._tables.ScanLimit = scanLimit;

            var history = (await GetHistoryAsync()).ToList();

            Assert.IsTrue(expected.Count > size / 4, "the generated history should be mostly events");
            Assert.AreEqual(expected.Count, history.Count);
            Assert.AreEqual(Serialize(expected), Serialize(history));
        }

        [TestMethod]
        [DataRow(400, 21, 1000)]
        [DataRow(3000, 22, 100)]
        public async Task ReturnsTheSameFromAServiceThatAnswersAMissingColumnWithANull(int size, int seed, int pageLimit)
        {
            // Most history rows have a few of the thirteen columns that are asked for. Table Storage puts a
            // null where a row has none; the emulator, and so every test against it, leaves the column out.
            var rows = GenerateHistory(size, seed);
            var expected = ReadEverything(rows);

            this.AddInstance(rows);
            this._tables.ServerPageLimit = pageLimit;
            this._tables.MissingColumnsComeBackAsNulls = true;

            var history = (await GetHistoryAsync()).ToList();

            Assert.AreEqual(Serialize(expected), Serialize(history));
        }

        [TestMethod]
        public async Task NoFilterItSendsHasMoreComparisonsThanTableStorageTakes()
        {
            // Table Storage refuses a $filter with more than 15 comparisons in it, and no emulator does. The
            // filter of the events names every event type that is shown, so a type added to that list is a
            // comparison added to every request.
            var rows = GenerateHistory(3000, 23);

            this.AddInstance(rows);
            this._tables.ServerPageLimit = 100;

            _ = (await GetHistoryAsync()).ToList();

            var filters = this._tables.Requests.Where(r => r.Kind == "QueryPage").Select(r => r.Filter).Distinct().ToList();

            Assert.IsTrue(filters.Count >= 2, "the events and their completions are two different queries");

            foreach (string filter in filters)
            {
                int comparisons = InMemoryTableClient.CountComparisons(filter);

                Assert.IsTrue(comparisons <= InMemoryTableClient.MaxComparisonsInAFilter, $"{comparisons} comparisons in: {filter}");
            }
        }

        [TestMethod]
        [DataRow(0, 200)]
        [DataRow(200, 200)]
        [DataRow(950, 200)]
        [DataRow(1900, 300)]
        [DataRow(0, 1)]
        public async Task APageOfItIsThatPageOfEverything(int skip, int top)
        {
            var rows = GenerateHistory(6000, 11);

            this.AddInstance(rows);

            var page = (await GetHistoryAsync()).Skip(skip).Take(top).ToList();

            Assert.AreEqual(Serialize(ReadEverything(rows).Skip(skip).Take(top)), Serialize(page));
        }

        [TestMethod]
        public async Task TheFirstPagesCostOnePageOfEventsAndTheirCompletions()
        {
            var rows = GenerateHistory(20000, 21);

            this.AddInstance(rows);

            var page = (await GetHistoryAsync()).Take(200).ToList();

            Assert.AreEqual(200, page.Count);

            var requests = this._tables.Requests;

            // The instance row, one page of events, and the completions of what that page scheduled
            Assert.AreEqual("GetEntity", requests[0].Kind);
            CollectionAssert.AreEqual(new[] { "ExecutionId" }, requests[0].Select.ToArray());

            Assert.AreEqual(1, requests.Count(r => r.Filter.Contains("EventType eq 'TaskScheduled'")), "pages of events");
            Assert.IsTrue(requests.All(r => r.Kind == "GetEntity" || r.Kind == "QueryPage"));

            // No query for every completion there is
            Assert.IsFalse(requests.Any(r => r.Filter.EndsWith("TaskScheduledId ge 0")), "the completions of the whole history were read");

            int scheduledInFirstPage = ReadEverything(rows).Take(1000).Count(e => e.EventId.HasValue || e.EventType == "TaskScheduled" || e.EventType == "SubOrchestrationInstanceCreated");

            // 20000 rows in the partition. What came over the wire is a page of events and about as many completions.
            int rowsRead = requests.Where(r => r.Kind == "QueryPage").Sum(r => r.RowsReturned);
            Assert.IsTrue(rowsRead <= 1000 + scheduledInFirstPage + 100, $"{rowsRead} rows were read for the first 200 events");
            Assert.IsTrue(rowsRead < rows.Count / 8, $"{rowsRead} rows were read of a history of {rows.Count}");

            // Every query asks for the columns an event is made of, and for no others
            foreach (var request in requests.Where(r => r.Kind == "QueryPage"))
            {
                CollectionAssert.AreEquivalent(OrchestrationHistory.HistoryColumns, request.Select.ToArray());
            }
        }

        [TestMethod]
        public async Task NothingIsReadBeforeItIsEnumeratedPastTheFirstPage()
        {
            this.AddInstance(GenerateHistory(5000, 31));

            var history = await GetHistoryAsync();

            int requestsForTheFirstPage = this._tables.Requests.Count;

            // The first thousand events are in hand
            Assert.AreEqual(1000, history.Take(1000).Count());
            Assert.AreEqual(requestsForTheFirstPage, this._tables.Requests.Count);

            // One more needs the next page
            Assert.AreEqual(1001, history.Take(1001).Count());
            Assert.IsTrue(this._tables.Requests.Count > requestsForTheFirstPage);
        }

        [TestMethod]
        public async Task TheWholeOfItReadsEveryCompletionOnceAndNoRowThatIsNotShown()
        {
            var rows = GenerateHistory(12000, 41);
            var expected = ReadEverything(rows);

            this.AddInstance(rows);

            var history = (await GetHistoryAsync()).ToList();

            Assert.AreEqual(expected.Count, history.Count);

            var requests = this._tables.Requests.Where(r => r.Kind == "QueryPage").ToList();

            var eventPages = requests.Where(r => r.Filter.Contains("EventType eq 'TaskScheduled'")).ToList();
            var allCompletions = requests.Where(r => r.Filter.EndsWith("TaskScheduledId ge 0")).ToList();

            // The events, a thousand at a time: exactly as many rows as there are events
            Assert.AreEqual(expected.Count, eventPages.Sum(r => r.RowsReturned));
            Assert.AreEqual((expected.Count + 999) / 1000, eventPages.Count);

            // The completions, read through once
            int completionRows = rows.Count(r => r.PartitionKey == InstanceId && r.GetString("ExecutionId") == ExecutionId && r.ContainsKey("TaskScheduledId"));
            Assert.AreEqual(completionRows, allCompletions.Sum(r => r.RowsReturned));

            // The markers of the episodes, which are a good part of any history, never left the table
            int markerRows = rows.Count(r => r.GetString("EventType") == "OrchestratorStarted" || r.GetString("EventType") == "OrchestratorCompleted");
            Assert.IsTrue(markerRows > 1000);
            Assert.IsTrue(requests.Sum(r => r.RowsReturned) < rows.Count - markerRows + 1100);
        }

        [TestMethod]
        public async Task AHistoryWithoutTasksAsksForNoCompletions()
        {
            this.AddInstance(new[]
            {
                Row(0, "OrchestratorStarted"),
                With(Row(1, "ExecutionStarted"), "Name", "Waiter"),
                With(Row(2, "TimerCreated"), "EventId", 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                With(Row(5, "EventRaised"), "Name", "Go"),
                With(Row(6, "TimerFired"), "TimerId", 0),
                Row(7, "ExecutionCompleted"),
                Row(8, "OrchestratorCompleted")
            });

            var history = (await GetHistoryAsync()).ToList();

            CollectionAssert.AreEqual(
                new[] { "ExecutionStarted", "TimerCreated", "EventRaised", "TimerFired", "ExecutionCompleted" },
                history.Select(e => e.EventType).ToArray());

            // The instance row and one page of events
            Assert.AreEqual(2, this._tables.Requests.Count);
        }

        [TestMethod]
        public async Task ATaskThatWasRewoundShowsItsLatestOutcomeHoweverFarAwayItIs()
        {
            // The activity failed, the instance was rewound (which leaves the failure behind as a GenericEvent),
            // and the retry completed thousands of rows later. The first page shows the completion.
            var rows = new List<TableEntity>
            {
                Row(0, "OrchestratorStarted"),
                With(Row(1, "ExecutionStarted"), "Name", "MyOrchestrator"),
                With(With(Row(2, "TaskScheduled"), "EventId", 0), "Name", "Flaky"),
                With(Row(3, "GenericEvent"), "TaskScheduledId", 0)
            };

            for (int i = 4; i < 3000; i++)
            {
                rows.Add(With(Row(i, "EventRaised"), "Name", "Tick"));
            }

            rows.Add(With(With(Row(3000, "TaskCompleted"), "TaskScheduledId", 0), "Result", "\"at last\""));

            this.AddInstance(rows);

            var task = (await GetHistoryAsync()).Skip(1).First();

            Assert.AreEqual("TaskCompleted", task.EventType);
            Assert.AreEqual("Flaky", task.Name);
            Assert.AreEqual("\"at last\"", task.Result);
            Assert.AreEqual(2, task.SequenceNumber);
        }

        [TestMethod]
        public async Task ATaskWhoseOnlyOutcomeIsARewoundOneIsShownAsScheduled()
        {
            this.AddInstance(new[]
            {
                With(Row(0, "ExecutionStarted"), "Name", "MyOrchestrator"),
                With(With(Row(1, "TaskScheduled"), "EventId", 0), "Name", "Flaky"),
                With(Row(2, "GenericEvent"), "TaskScheduledId", 0)
            });

            var task = (await GetHistoryAsync()).Last();

            Assert.AreEqual("TaskScheduled", task.EventType);
            Assert.AreEqual("Flaky", task.Name);
        }

        [TestMethod]
        public async Task CanBeEnumeratedMoreThanOnce()
        {
            var rows = GenerateHistory(2600, 51);

            this.AddInstance(rows);

            var history = await GetHistoryAsync();

            string first = Serialize(history.ToList());
            string second = Serialize(history.ToList());

            Assert.AreEqual(first, second);
            Assert.AreEqual(Serialize(ReadEverything(rows)), first);
        }

        [TestMethod]
        public async Task StoppingHalfWayIsNotAnError()
        {
            this.AddInstance(GenerateHistory(9000, 61));

            // Into the third page, and no further
            var some = (await GetHistoryAsync()).Take(2100).ToList();

            Assert.AreEqual(2100, some.Count);

            int eventPages = this._tables.Requests.Count(r => r.Kind == "QueryPage" && r.Filter.Contains("EventType eq 'TaskScheduled'"));
            Assert.AreEqual(3, eventPages);
        }

        [TestMethod]
        public async Task AFailureToReadAPageIsTheCallersToSee()
        {
            this.AddInstance(GenerateHistory(2600, 71));

            var history = await GetHistoryAsync();

            // The storage account goes away after the first page
            this._tables.OnRequest = _ => throw new InvalidOperationException("the table is gone");

            Assert.ThrowsExactly<InvalidOperationException>(() => history.ToList());
        }

        private static TableEntity With(TableEntity row, string column, object value)
        {
            row[column] = value;
            return row;
        }
    }
}
