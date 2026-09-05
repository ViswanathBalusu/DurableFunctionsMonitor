// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The sequence number a history record is addressed by, decoded from the XXXHistory RowKey
    /// </summary>
    [TestClass]
    public class HistorySequenceNumberTests
    {
        [TestInitialize]
        public void TestInit()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
        }

        [TestMethod]
        [DataRow("0000000000000011", 17L)]
        [DataRow("0000000000000000", 0L)]
        [DataRow("000000000000001B", 27L)]
        [DataRow("0000000002", 2L)]
        public void DecodesTheHexRowKey(string rowKey, long expected)
        {
            Assert.AreEqual(expected, HistoryEntity.TryParseSequenceNumber(rowKey));
        }

        [TestMethod]
        [DataRow("sentinel")]
        [DataRow("")]
        [DataRow(null)]
        [DataRow("not-a-number")]
        public void LeavesOtherRowKeysWithoutASequenceNumber(string rowKey)
        {
            Assert.IsNull(HistoryEntity.TryParseSequenceNumber(rowKey));
        }

        [TestMethod]
        public void MapsSequenceNumberAndBlobReferenceFromTheRow()
        {
            // Arrange

            var entity = new TableEntity("my-instance", "000000000000001B")
            {
                ["EventType"] = "EventRaised",
                ["Name"] = "Approval",
                ["Input"] = "",
                ["InputBlobName"] = "my-instance/history-000000000000001B-EventRaised-1A2B3C4D-Input.json.gz"
            };

            // Act

            var historyEntity = HistoryEntity.From(entity);

            // Assert

            Assert.AreEqual(27, historyEntity.SequenceNumber);
            Assert.AreEqual("my-instance/history-000000000000001B-EventRaised-1A2B3C4D-Input.json.gz", historyEntity.InputBlobName);
        }

        [TestMethod]
        public void MapsTimerIdAndFireAtFromTheRow()
        {
            // Arrange

            var fireAt = DateTimeOffset.UtcNow.AddMinutes(5);

            var entity = new TableEntity("my-instance", "0000000000000002")
            {
                ["EventType"] = "TimerFired",
                ["TimerId"] = 3,
                ["FireAt"] = fireAt
            };

            // Act

            var historyEntity = HistoryEntity.From(entity);

            // Assert

            Assert.AreEqual(3, historyEntity.TimerId);
            Assert.AreEqual(fireAt, historyEntity.FireAt);
        }

        [TestMethod]
        public void LeavesTimerIdAndFireAtNullWhenTheRowHasNoSuchColumns()
        {
            // Arrange

            var entity = new TableEntity("my-instance", "0000000000000001")
            {
                ["EventType"] = "TaskScheduled"
            };

            // Act

            var historyEntity = HistoryEntity.From(entity);

            // Assert

            Assert.IsNull(historyEntity.TimerId);
            Assert.IsNull(historyEntity.FireAt);
        }

        [TestMethod]
        public async Task HistoryEventsCarryTimerIdAndFireAt()
        {
            // Arrange

            const string instanceId = "my-instance";
            const string executionId = "exec-1";

            var fireAt = DateTimeOffset.UtcNow.AddMinutes(5);

            var rows = new[]
            {
                Row(0, "OrchestratorStarted"),
                Row(1, "TimerCreated", eventId: 3, fireAt: fireAt),
                Row(2, "TimerFired", timerId: 3, fireAt: fireAt),
                Row(3, "OrchestratorCompleted")
            };

            var tableClient = new Mock<ITableClient>();

            tableClient
                .Setup(c => c.GetEntityAsync("HubInstances", instanceId, string.Empty))
                .ReturnsAsync(new TableEntity(instanceId, string.Empty) { ["ExecutionId"] = executionId });

            tableClient
                .Setup(c => c.GetAll("HubHistory", It.IsAny<string>()))
                .Returns(rows);

            tableClient
                .Setup(c => c.GetAllAsync("HubHistory", It.Is<string>(filter => filter.Contains("TaskScheduledId ge 0"))))
                .ReturnsAsync(rows.Where(r => r.ContainsKey("TaskScheduledId")).ToList());

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            // Act

            var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, "SomeConnString", "Hub", instanceId))
                .Where(e => e.EventType == "TimerCreated" || e.EventType == "TimerFired")
                .ToList();

            // Assert

            Assert.AreEqual(2, history.Count);

            var timerCreated = history[0];
            Assert.AreEqual("TimerCreated", timerCreated.EventType);
            Assert.IsNull(timerCreated.TimerId);
            Assert.AreEqual(fireAt, timerCreated.FireAt);

            var timerFired = history[1];
            Assert.AreEqual("TimerFired", timerFired.EventType);
            Assert.AreEqual(3, timerFired.TimerId);
            Assert.AreEqual(fireAt, timerFired.FireAt);

            static TableEntity Row(long sequenceNumber, string eventType, int? eventId = null, int? timerId = null, DateTimeOffset? fireAt = null)
            {
                var row = new TableEntity(instanceId, sequenceNumber.ToString("X16"))
                {
                    ["ExecutionId"] = executionId,
                    ["EventType"] = eventType,
                    ["_Timestamp"] = DateTimeOffset.UtcNow,
                    ["EventId"] = eventId ?? -1
                };

                if (timerId.HasValue) row["TimerId"] = timerId.Value;
                if (fireAt.HasValue) row["FireAt"] = fireAt.Value;

                return row;
            }
        }

        [TestMethod]
        public async Task ReturnsAnEmptyHistoryForAnUnknownInstance()
        {
            // Arrange

            var tableClient = new Mock<ITableClient>();

            tableClient
                .Setup(c => c.GetEntityAsync("HubInstances", "no-such-instance", string.Empty))
                .ReturnsAsync((TableEntity)null);

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            // Act

            var history = await OrchestrationHistory.GetHistoryDirectlyFromTable(null, "SomeConnString", "Hub", "no-such-instance");

            // Assert

            Assert.AreEqual(0, history.Count());
        }

        [TestMethod]
        public async Task HistoryEventsCarryTheSequenceNumberOfTheirSchedulingRow()
        {
            // Arrange

            const string instanceId = "my-instance";
            const string executionId = "exec-1";

            var rows = new[]
            {
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{\"a\":1}"),
                Row(2, "TaskScheduled", name: "MyActivity", eventId: 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                Row(5, "TaskCompleted", taskScheduledId: 0, result: "42"),
                Row(6, "EventRaised", name: "Approval", input: "{\"ok\":true}"),
                Row(7, "OrchestratorCompleted")
            };

            var tableClient = new Mock<ITableClient>();

            tableClient
                .Setup(c => c.GetEntityAsync("HubInstances", instanceId, string.Empty))
                .ReturnsAsync(new TableEntity(instanceId, string.Empty) { ["ExecutionId"] = executionId });

            tableClient
                .Setup(c => c.GetAll("HubHistory", It.IsAny<string>()))
                .Returns(rows);

            tableClient
                .Setup(c => c.GetAllAsync("HubHistory", It.Is<string>(filter => filter.Contains("TaskScheduledId ge 0"))))
                .ReturnsAsync(rows.Where(r => r.ContainsKey("TaskScheduledId")).ToList());

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            // Act

            var history = (await OrchestrationHistory.GetHistoryDirectlyFromTable(null, "SomeConnString", "Hub", instanceId)).ToList();

            // Assert

            Assert.AreEqual(3, history.Count);

            Assert.AreEqual("ExecutionStarted", history[0].EventType);
            Assert.AreEqual(1, history[0].SequenceNumber);
            Assert.AreEqual("{\"a\":1}", history[0].Input);

            // The scheduled task is merged with its completion, and addressed by the row that scheduled it
            Assert.AreEqual("TaskCompleted", history[1].EventType);
            Assert.AreEqual(2, history[1].SequenceNumber);
            Assert.AreEqual("MyActivity", history[1].Name);
            Assert.AreEqual("42", history[1].Result);

            Assert.AreEqual("EventRaised", history[2].EventType);
            Assert.AreEqual(6, history[2].SequenceNumber);
            Assert.AreEqual("Approval", history[2].Name);
            Assert.AreEqual("{\"ok\":true}", history[2].Input);

            static TableEntity Row(long sequenceNumber, string eventType, string name = null, string input = null, int? eventId = null, int? taskScheduledId = null, string result = null)
            {
                var row = new TableEntity(instanceId, sequenceNumber.ToString("X16"))
                {
                    ["ExecutionId"] = executionId,
                    ["EventType"] = eventType,
                    ["_Timestamp"] = DateTimeOffset.UtcNow,
                    ["EventId"] = eventId ?? -1
                };

                if (name != null) row["Name"] = name;
                if (input != null) row["Input"] = input;
                if (result != null) row["Result"] = result;
                if (taskScheduledId.HasValue) row["TaskScheduledId"] = taskScheduledId.Value;

                return row;
            }
        }
    }
}
