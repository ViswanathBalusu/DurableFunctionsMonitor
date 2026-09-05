// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Azure;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The safeguards of the history truncation, which need a controllable table client: the order of the deletes,
    /// the checks that happen before the first write, and the concurrency check on the Instances row.
    /// The Azurite integration tests cover what it does to real tables.
    /// </summary>
    [TestClass]
    public class OrchestrationHistoryEditorUnitTests
    {
        private const string InstanceId = "my-instance";
        private const string ExecutionId = "exec-1";
        private const string HubName = "Hub";

        private readonly Dictionary<string, TableEntity> _rows = new Dictionary<string, TableEntity>();
        private readonly List<string> _writes = new List<string>();
        private TableEntity _instanceRow;
        private List<TableEntity> _deleted;
        private Mock<ITableClient> _tableClient;

        [TestInitialize]
        public void TestInit()
        {
            this._instanceRow = new TableEntity(InstanceId, string.Empty)
            {
                ["ExecutionId"] = ExecutionId,
                ["RuntimeStatus"] = "Completed",
                ["Output"] = "\"done\"",
                ["CompletedTime"] = DateTimeOffset.UtcNow
            };

            this._rows["sentinel"] = new TableEntity(InstanceId, "sentinel") { ["ExecutionId"] = ExecutionId, ["IsCheckpointComplete"] = true };

            this._tableClient = new Mock<ITableClient>();

            this._tableClient
                .Setup(c => c.GetEntityAsync($"{HubName}Instances", InstanceId, string.Empty))
                .ReturnsAsync(() => this._instanceRow);

            this._tableClient
                .Setup(c => c.GetEntityAsync($"{HubName}History", InstanceId, It.IsAny<string>()))
                .ReturnsAsync((string table, string partitionKey, string rowKey) => this._rows.TryGetValue(rowKey, out var row) ? row : null);

            this._tableClient
                .Setup(c => c.GetAllAsync($"{HubName}History", It.IsAny<string>()))
                .ReturnsAsync((string table, string filter) => this.Query(filter));

            this._tableClient
                .Setup(c => c.ReplaceEntityAsync(It.IsAny<string>(), It.IsAny<TableEntity>()))
                .Returns((string table, TableEntity entity) =>
                {
                    this._writes.Add($"Replace:{table}:{entity.RowKey}");
                    return Task.CompletedTask;
                });

            this._tableClient
                .Setup(c => c.UpsertEntityAsync(It.IsAny<string>(), It.IsAny<TableEntity>()))
                .Returns((string table, TableEntity entity) =>
                {
                    this._writes.Add($"Upsert:{table}:{entity.RowKey}");
                    return Task.CompletedTask;
                });

            this._tableClient
                .Setup(c => c.DeleteEntitiesAsync(It.IsAny<string>(), It.IsAny<IEnumerable<TableEntity>>()))
                .Returns((string table, IEnumerable<TableEntity> entities) =>
                {
                    this._deleted = entities.ToList();
                    this._writes.Add($"Delete:{table}:{this._deleted.Count}");
                    return Task.CompletedTask;
                });

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tableClient.Object;
        }

        [TestCleanup]
        public void TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
        }

        [TestMethod]
        public async Task DeletesHighestKeysFirstAndChecksBeforeTheFirstWrite()
        {
            // Arrange

            this.SeedCompletedRun();

            // Act

            int deleted = await OrchestrationHistoryEditor.TruncateHistoryAsync(null, "SomeConnString", HubName, InstanceId, 8);

            // Assert

            // The event opened its episode, so the opener at 7 goes too
            Assert.AreEqual(8, deleted);

            var deletedKeys = this._deleted.Select(r => r.RowKey).ToList();
            CollectionAssert.AreEqual(deletedKeys.OrderByDescending(k => k, StringComparer.Ordinal).ToList(), deletedKeys, "highest key first");
            Assert.AreEqual(7L.ToString("X16"), deletedKeys.Last());
            Assert.AreEqual(8L.ToString("X16"), deletedKeys[deletedKeys.Count - 2]);

            // The Instances row is written conditionally and the sentinel is touched before anything is deleted; the reopen comes last
            CollectionAssert.AreEqual(
                new[] { $"Replace:{HubName}Instances:", $"Replace:{HubName}History:sentinel", $"Delete:{HubName}History:8", $"Replace:{HubName}Instances:" },
                this._writes);

            Assert.AreEqual("Running", this._instanceRow.GetString("RuntimeStatus"));
            Assert.IsFalse(this._instanceRow.ContainsKey("Output"));
        }

        [TestMethod]
        public async Task StopsBeforeDeletingWhenTheInstanceRowChangedMeanwhile()
        {
            // Arrange

            this.SeedCompletedRun();

            // Somebody pressed Rewind between our read and our first write
            this._tableClient
                .Setup(c => c.ReplaceEntityAsync($"{HubName}Instances", It.IsAny<TableEntity>()))
                .ThrowsAsync(new RequestFailedException(412, "Precondition Failed"));

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationHistoryEditor.TruncateHistoryAsync(null, "SomeConnString", HubName, InstanceId, 8));

            // Assert

            StringAssert.Contains(ex.Message, "modified concurrently");
            Assert.IsNull(this._deleted, "no history row may be deleted after a failed concurrency check");
            CollectionAssert.DoesNotContain(this._writes, $"Replace:{HubName}History:sentinel");
        }

        [TestMethod]
        public async Task RefusesToReplayPastWorkThatWasStillRunningWhenTheEventArrived()
        {
            // Arrange

            // Task.WhenAll(CallActivityAsync("Work"), WaitForExternalEvent("Approval")): the approval arrived while Work ran
            this.Seed(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{}"),
                Row(2, "TaskScheduled", name: "Work", eventId: 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                Row(5, "EventRaised", name: "Approval", input: "{\"ok\":true}"),
                Row(6, "OrchestratorCompleted"),
                Row(7, "OrchestratorStarted"),
                Row(8, "TaskCompleted", taskScheduledId: 0, result: "42"),
                Row(9, "TaskScheduled", name: "Next", eventId: 1),
                Row(10, "OrchestratorCompleted"));

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationHistoryEditor.TruncateHistoryAsync(null, "SomeConnString", HubName, InstanceId, 5));

            // Assert

            StringAssert.Contains(ex.Message, "TaskScheduled 'Work' (id 0)");
            StringAssert.Contains(ex.Message, "update-input-and-rewind");
            Assert.AreEqual(0, this._writes.Count, "nothing may be written when the replay is refused");
        }

        [TestMethod]
        public async Task IgnoresTimersStillPendingWhenTheEventArrived()
        {
            // Arrange

            // Task.WhenAny(WaitForExternalEvent("Approval"), CreateTimer(timeout)): the timeout timer is still pending at the event
            this.Seed(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{}"),
                Row(2, "TimerCreated", eventId: 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                Row(5, "EventRaised", name: "Approval", input: "{\"ok\":true}"),
                Row(6, "TaskScheduled", name: "Next", eventId: 1),
                Row(7, "OrchestratorCompleted"),
                Row(8, "OrchestratorStarted"),
                Row(9, "TimerFired", timerId: 0),
                Row(10, "OrchestratorCompleted"));

            // Act

            int deleted = await OrchestrationHistoryEditor.TruncateHistoryAsync(null, "SomeConnString", HubName, InstanceId, 5);

            // Assert

            Assert.AreEqual(7, deleted);
        }

        // Started, one activity, an approval that opened its own episode, a child, a second activity, completed
        private void SeedCompletedRun()
        {
            this.Seed(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{\"a\":1}"),
                Row(2, "TaskScheduled", name: "Activity1", eventId: 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                Row(5, "TaskCompleted", taskScheduledId: 0, result: "42"),
                Row(6, "OrchestratorCompleted"),
                Row(7, "OrchestratorStarted"),
                Row(8, "EventRaised", name: "Approval", input: "{\"ok\":true}"),
                Row(9, "SubOrchestrationInstanceCreated", name: "Child", eventId: 1),
                Row(10, "OrchestratorCompleted"),
                Row(11, "OrchestratorStarted"),
                Row(12, "SubOrchestrationInstanceCompleted", taskScheduledId: 1, result: "true"),
                Row(13, "ExecutionCompleted", result: "\"done\""),
                Row(14, "OrchestratorCompleted"));
        }

        private void Seed(params TableEntity[] rows)
        {
            foreach (var row in rows)
            {
                this._rows[row.RowKey] = row;
            }
        }

        private static TableEntity Row(long sequenceNumber, string eventType, string name = null, string input = null, int? eventId = null, int? taskScheduledId = null, int? timerId = null, string result = null)
        {
            var row = new TableEntity(InstanceId, sequenceNumber.ToString("X16"))
            {
                ["ExecutionId"] = ExecutionId,
                ["EventType"] = eventType,
                ["_Timestamp"] = DateTimeOffset.UtcNow,
                ["EventId"] = eventId ?? -1
            };

            if (name != null) row["Name"] = name;
            if (input != null) row["Input"] = input;
            if (result != null) row["Result"] = result;
            if (taskScheduledId.HasValue) row["TaskScheduledId"] = taskScheduledId.Value;
            if (timerId.HasValue) row["TimerId"] = timerId.Value;

            return row;
        }

        // Answers the two OData filters the editor uses: the tail from a row key onward, and the kept rows before it
        private List<TableEntity> Query(string filter)
        {
            var rows = this._rows.Values.Where(r => r.RowKey != "sentinel" && r.GetString("ExecutionId") == ExecutionId);

            var ge = Regex.Match(filter, @"RowKey ge '([0-9A-F]{16})'");
            if (ge.Success)
            {
                rows = rows.Where(r => string.CompareOrdinal(r.RowKey, ge.Groups[1].Value) >= 0);
            }

            var lt = Regex.Match(filter, @"RowKey lt '([0-9A-F]{16})'");
            if (lt.Success)
            {
                rows = rows.Where(r => string.CompareOrdinal(r.RowKey, lt.Groups[1].Value) < 0);
            }

            return rows.OrderBy(r => r.RowKey, StringComparer.Ordinal).ToList();
        }
    }
}
