// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Linq;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The default parent lookup: the ParentInstanceId column of the Instances row when the engine wrote one,
    /// the instance's own history when it did not, and a table scan only when neither says anything.
    ///
    /// What matters as much as the answer is what it costs: every instance that is opened is asked for its
    /// parent, and the XXXHistory table of a busy Task Hub holds hundreds of millions of rows.
    /// </summary>
    [TestClass]
    public class ParentInstanceIdTests
    {
        private const string InstancesTable = "FakeDurableTaskClientInstances";
        private const string HistoryTable = "FakeDurableTaskClientHistory";

        private InMemoryTableClient _tables;

        [TestInitialize]
        public void TestInit()
        {
            this._tables = new InMemoryTableClient();

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tables;
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags, null);
        }

        [TestCleanup]
        public void TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags, null);
        }

        private Task<string> GetParentAsync(string instanceId)
        {
            return DetailedOrchestrationStatus.GetParentInstanceIdDirectlyFromTable(new FakeDurableTaskClient(), "SomeConnString", "Hub", instanceId);
        }

        private static TableEntity InstanceRow(string instanceId, string parentInstanceId = null, string executionId = "exec-1")
        {
            var row = new TableEntity(instanceId, string.Empty)
            {
                ["ExecutionId"] = executionId,
                ["Name"] = "MyOrchestrator",
                ["CreatedTime"] = new DateTimeOffset(2026, 11, 14, 10, 0, 0, TimeSpan.Zero),
                ["Input"] = new string('x', 30000)
            };

            if (parentInstanceId != null)
            {
                row["ParentInstanceId"] = parentInstanceId;
            }

            return row;
        }

        private static TableEntity HistoryRow(string instanceId, long sequenceNumber, string eventType, string parentInstance = null)
        {
            var row = new TableEntity(instanceId, sequenceNumber.ToString("X16"))
            {
                ["ExecutionId"] = "exec-1",
                ["EventType"] = eventType
            };

            if (parentInstance != null)
            {
                row["ParentInstance"] = parentInstance;
            }

            return row;
        }

        // The ParentInstance column of an ExecutionStarted row, as DurableTask.AzureStorage writes it
        private static string ParentInstanceJson(string parentInstanceId)
        {
            return "{\"$type\":\"DurableTask.Core.ParentInstance, DurableTask.Core\",\"Name\":\"ParentOrchestrator\","
                + "\"OrchestrationInstance\":{\"$type\":\"DurableTask.Core.OrchestrationInstance, DurableTask.Core\",\"InstanceId\":\"" + parentInstanceId + "\",\"ExecutionId\":\"5f1c2d\"},"
                + "\"TaskScheduleId\":3,\"Version\":\"\"}";
        }

        [TestMethod]
        public async Task ReturnsTheParentRecordedOnTheInstanceRow()
        {
            this._tables.Add(InstancesTable, InstanceRow("child-instance", parentInstanceId: "parent-instance"));

            Assert.AreEqual("parent-instance", await this.GetParentAsync("child-instance"));

            // One point read, and nothing else
            Assert.AreEqual("GetEntity", this._tables.Requests.Single().Kind);
        }

        [TestMethod]
        public async Task ATopLevelInstanceIsAnsweredByItsRowAlone()
        {
            // The engine writes an empty ParentInstanceId for everything that is not a sub-orchestration.
            // That is an answer. Taking it for 'unknown' is what used to start a scan of the whole history
            // table for every top-level instance that was opened, a scan that could only end by timing out.
            this._tables.Add(InstancesTable, InstanceRow("top-level-instance", parentInstanceId: string.Empty));

            // A history that, if it were scanned, would name a parent
            this._tables.Add(HistoryTable, HistoryRow("some-other-instance", 5, "SubOrchestrationInstanceCreated"));

            Assert.IsNull(await this.GetParentAsync("top-level-instance"));

            Assert.AreEqual("GetEntity", this._tables.Requests.Single().Kind);
        }

        [TestMethod]
        public async Task ReadsOnlyWhatItNeedsOfTheInstanceRow()
        {
            this._tables.Add(InstancesTable, InstanceRow("child-instance", parentInstanceId: "parent-instance"));

            await this.GetParentAsync("child-instance");

            // Not the input, the output and the custom status, which are most of the row
            CollectionAssert.AreEquivalent(new[] { "ParentInstanceId", "CreatedTime" }, this._tables.Requests.Single().Select.ToArray());
        }

        [TestMethod]
        public async Task AsksTheInstancesOwnHistoryWhenTheColumnIsAbsent()
        {
            // A row written by an engine from before the column
            this._tables.Add(InstancesTable, InstanceRow("child-instance"));

            this._tables.Add(HistoryTable,
                HistoryRow("child-instance", 0, "OrchestratorStarted"),
                HistoryRow("child-instance", 1, "ExecutionStarted", ParentInstanceJson("parent-instance")),
                HistoryRow("child-instance", 2, "TaskScheduled"),
                HistoryRow("other-instance", 1, "ExecutionStarted", ParentInstanceJson("someone-elses-parent")));

            Assert.AreEqual("parent-instance", await this.GetParentAsync("child-instance"));

            var requests = this._tables.Requests;

            Assert.AreEqual(2, requests.Count);
            Assert.AreEqual("GetEntity", requests[0].Kind);

            // One partition, one row, one column
            Assert.AreEqual(HistoryTable, requests[1].Table);
            StringAssert.Contains(requests[1].Filter, "PartitionKey eq 'child-instance'");
            Assert.AreEqual(1, requests[1].RowsReturned);
            CollectionAssert.AreEqual(new[] { "ParentInstance" }, requests[1].Select.ToArray());
        }

        [TestMethod]
        public async Task AsksTheInstancesOwnHistoryWhenTheColumnComesBackAsANull()
        {
            // The same row from before the column, as Table Storage itself answers for it: asked for a column
            // the row does not have, it puts a null in its place, where the emulator leaves the column out.
            // A null is not the empty string the engine writes for 'no parent': it is 'this row does not say'.
            this._tables.MissingColumnsComeBackAsNulls = true;

            this._tables.Add(InstancesTable, InstanceRow("child-instance"));

            this._tables.Add(HistoryTable,
                HistoryRow("child-instance", 0, "OrchestratorStarted"),
                HistoryRow("child-instance", 1, "ExecutionStarted", ParentInstanceJson("parent-instance")));

            Assert.AreEqual("parent-instance", await this.GetParentAsync("child-instance"));

            Assert.AreEqual(2, this._tables.Requests.Count);
        }

        [TestMethod]
        [DataRow("parent-instance", "parent-instance")]
        [DataRow("", null)]
        public async Task ARowThatHasTheColumnIsStillAnsweredByItsRowAloneThere(string recorded, string expected)
        {
            // And a row of a current engine is one point read on the real service as well: the column is
            // there, with a parent in it or with the empty string of a top-level instance
            this._tables.MissingColumnsComeBackAsNulls = true;

            this._tables.Add(InstancesTable, InstanceRow("some-instance", parentInstanceId: recorded));
            this._tables.Add(HistoryTable, HistoryRow("some-instance", 1, "ExecutionStarted", ParentInstanceJson("what-the-history-says")));

            Assert.AreEqual(expected, await this.GetParentAsync("some-instance"));

            Assert.AreEqual("GetEntity", this._tables.Requests.Single().Kind);
        }

        [TestMethod]
        [DataRow(null)]
        [DataRow("")]
        [DataRow("null")]
        public async Task AHistoryThatNamesNoParentIsATopLevelInstance(string parentInstanceColumn)
        {
            this._tables.Add(InstancesTable, InstanceRow("top-level-instance"));
            this._tables.Add(HistoryTable, HistoryRow("top-level-instance", 1, "ExecutionStarted", parentInstanceColumn));

            Assert.IsNull(await this.GetParentAsync("top-level-instance"));

            // The row and the first event of the history. No scan.
            Assert.AreEqual(2, this._tables.Requests.Count);
        }

        [TestMethod]
        public async Task FindsTheFirstEventOfAHistoryThatDoesNotStartWithIt()
        {
            // The "service" answers after every two rows it has looked at: the pages before the event are empty,
            // and an empty page is not the end of a history
            this._tables.ScanLimit = 2;

            this._tables.Add(InstancesTable, InstanceRow("child-instance"));
            this._tables.Add(HistoryTable,
                Enumerable.Range(0, 9).Select(i => HistoryRow("child-instance", i, "OrchestratorStarted"))
                    .Append(HistoryRow("child-instance", 9, "ExecutionStarted", ParentInstanceJson("parent-instance")))
                    .ToArray());

            Assert.AreEqual("parent-instance", await this.GetParentAsync("child-instance"));
        }

        [TestMethod]
        public async Task FallsBackToTheOldFormatIdWhenNeitherTheRowNorTheHistorySays()
        {
            // An old row, and no history (it has not started yet): the id itself, '{parent execution id}:{task id}',
            // is all there is, and the parent is the instance with that execution id
            this._tables.Add(InstancesTable,
                InstanceRow("parent-execution:3"),
                InstanceRow("aaa-unrelated", executionId: "other-execution"),
                InstanceRow("parent-instance", executionId: "parent-execution"),
                InstanceRow("zzz-unrelated", executionId: "another-execution"));

            Assert.AreEqual("parent-instance", await this.GetParentAsync("parent-execution:3"));

            var scan = this._tables.Requests.Last();

            Assert.AreEqual(InstancesTable, scan.Table);
            Assert.AreEqual("ExecutionId eq 'parent-execution'", scan.Filter);

            // Keys only, and it stopped at the parent instead of reading the table to its end
            Assert.AreEqual(0, scan.Select.Count);
            Assert.AreEqual(1, scan.RowsReturned);
            Assert.IsTrue(scan.RowsScanned < 4, $"scanned {scan.RowsScanned} rows");
        }

        [TestMethod]
        public async Task FallsBackToTheEventThatCreatedTheInstanceWhenNeitherTheRowNorTheHistorySays()
        {
            // An old row with an id of its own choosing and no history: the parent is the instance whose history
            // holds the SubOrchestrationInstanceCreated event for it, written at about the time it was created
            var createdTime = new DateTimeOffset(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);

            this._tables.Add(InstancesTable, InstanceRow("named-child"));

            var created = HistoryRow("parent-instance", 7, "SubOrchestrationInstanceCreated");
            created["InstanceId"] = "named-child";
            created["Timestamp"] = createdTime.AddSeconds(1);

            var unrelated = HistoryRow("unrelated-instance", 3, "SubOrchestrationInstanceCreated");
            unrelated["InstanceId"] = "some-other-child";
            unrelated["Timestamp"] = createdTime.AddSeconds(1);

            var tooLate = HistoryRow("a-later-parent", 3, "SubOrchestrationInstanceCreated");
            tooLate["InstanceId"] = "named-child";
            tooLate["Timestamp"] = createdTime.AddMinutes(10);

            this._tables.Add(HistoryTable, created, unrelated, tooLate);

            Assert.AreEqual("parent-instance", await this.GetParentAsync("named-child"));
        }

        [TestMethod]
        public async Task TheHistoryScanCanBeSwitchedOff()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags, $"SomeFlag,{Globals.DfMonDisableNewParentIdResolutionAlgorithm}");

            this._tables.Add(InstancesTable, InstanceRow("named-child"));

            var created = HistoryRow("parent-instance", 7, "SubOrchestrationInstanceCreated");
            created["InstanceId"] = "named-child";
            created["Timestamp"] = new DateTimeOffset(2026, 11, 14, 10, 0, 1, TimeSpan.Zero);
            this._tables.Add(HistoryTable, created);

            Assert.IsNull(await this.GetParentAsync("named-child"));

            // The row and the instance's own (empty) history were asked. The table was not scanned.
            Assert.AreEqual(2, this._tables.Requests.Count);
        }

        [TestMethod]
        public async Task AnInstanceThatIsGoneHasNoParent()
        {
            Assert.IsNull(await this.GetParentAsync("no-such-instance"));
        }

        [TestMethod]
        public async Task AParentItCannotReadIsNotTakenForNoParent()
        {
            // Should the engine ever write this column differently, 'cannot tell' must not turn into 'top level':
            // restart-in-place refuses to run on a sub-orchestration, and would run on this one
            this._tables.Add(InstancesTable, InstanceRow("parent-execution:3"), InstanceRow("parent-instance", executionId: "parent-execution"));
            this._tables.Add(HistoryTable, HistoryRow("parent-execution:3", 1, "ExecutionStarted", "{\"SomethingElse\":true}"));

            Assert.AreEqual("parent-instance", await this.GetParentAsync("parent-execution:3"));
        }

        [TestMethod]
        [DataRow("{\"Name\":\"P\",\"OrchestrationInstance\":{\"InstanceId\":\"parent-1\",\"ExecutionId\":\"e\"},\"TaskScheduleId\":0}", true, "parent-1")]
        [DataRow("{\"name\":\"P\",\"orchestrationInstance\":{\"instanceId\":\"parent-2\"}}", true, "parent-2")]
        [DataRow("{\"OrchestrationInstance\":{\"InstanceId\":\"2026-11-14T10:00:00Z\"}}", true, "2026-11-14T10:00:00Z")]
        [DataRow(null, true, null)]
        [DataRow("", true, null)]
        [DataRow("  ", true, null)]
        [DataRow("null", true, null)]
        [DataRow("{}", false, null)]
        [DataRow("{\"OrchestrationInstance\":null}", false, null)]
        [DataRow("{\"OrchestrationInstance\":{\"InstanceId\":\"\"}}", false, null)]
        [DataRow("{\"OrchestrationInstance\":{\"InstanceId\":42}}", false, null)]
        [DataRow("[1,2]", false, null)]
        [DataRow("\"parent\"", false, null)]
        [DataRow("{not json", false, null)]
        public void ReadsTheParentOutOfTheParentInstanceColumn(string json, bool understood, string expectedParentInstanceId)
        {
            Assert.AreEqual(understood, DetailedOrchestrationStatus.TryParseParentInstance(json, out string parentInstanceId));
            Assert.AreEqual(expectedParentInstanceId, parentInstanceId);
        }
    }
}
