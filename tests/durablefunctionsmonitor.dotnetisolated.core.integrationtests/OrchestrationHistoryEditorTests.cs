// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Azure.Data.Tables;
using Azure.Storage.Blobs;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives the Azure Storage history editor against a real Table and Blob endpoint, on tables laid out
    /// the way the Durable Task Framework writes them: hex row keys, ExecutionId on every row, a sentinel
    /// row, episode markers, an older generation's leftovers and offloaded payload blobs.
    /// </summary>
    [TestClass]
    public class OrchestrationHistoryEditorTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmEdit" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._tableService = new TableServiceClient(StorageEmulator.ConnectionString);
            await this._tableService.CreateTableIfNotExistsAsync(this.InstancesTable);
            await this._tableService.CreateTableIfNotExistsAsync(this.HistoryTable);

            this._instances = this._tableService.GetTableClient(this.InstancesTable);
            this._history = this._tableService.GetTableClient(this.HistoryTable);

            this._blobs = new BlobServiceClient(StorageEmulator.ConnectionString).GetBlobContainerClient(LargeMessageBlobs.GetContainerName(this._hubName));
            await this._blobs.CreateIfNotExistsAsync();

            await this.SeedInstanceAsync("Failed");
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            if (this._tableService != null)
            {
                await this._tableService.DeleteTableAsync(this.InstancesTable);
                await this._tableService.DeleteTableAsync(this.HistoryTable);
                await this._blobs.DeleteIfExistsAsync();
            }
        }

        [TestMethod]
        public async Task ReadsAnInlineInput()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act

            string input = await OrchestrationHistoryEditor.GetEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 8);

            // Assert

            Assert.AreEqual("{\"ok\":true}", input);
        }

        [TestMethod]
        public async Task ReadsAnOffloadedInput()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();
            string blobName = await this.OffloadInputAsync(8, "{\"large\":true}");

            // Act

            string input = await OrchestrationHistoryEditor.GetEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 8);

            // Assert

            Assert.AreEqual("{\"large\":true}", input);
            Assert.IsTrue(await this._blobs.GetBlobClient(blobName).ExistsAsync(), "reading must not remove the blob");
        }

        [TestMethod]
        public async Task UpdatesTheInputOfAnEventRaisedRow()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act

            await OrchestrationHistoryEditor.UpdateEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 8, "{\"ok\":false}");

            // Assert

            var row = await this.GetHistoryRowAsync(8);
            Assert.AreEqual("{\"ok\":false}", row.GetString("Input"));
            Assert.AreEqual("EventRaised", row.GetString("EventType"));
            Assert.AreEqual("Approval", row.GetString("Name"));

            // The instance's own input is the initial one and stays untouched
            var instance = await this.GetInstanceRowAsync();
            Assert.AreEqual("{\"a\":1}", instance.GetString("Input"));
        }

        [TestMethod]
        public async Task UpdatesTheInstanceRowTooForExecutionStarted()
        {
            // Arrange

            await this.SeedHistoryAsync(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{\"a\":1}"),
                Row(2, "TaskScheduled", name: "Activity1", eventId: 0),
                Row(3, "OrchestratorCompleted"));

            // Act

            await OrchestrationHistoryEditor.UpdateEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 1, "{\"a\":2}");

            // Assert

            Assert.AreEqual("{\"a\":2}", (await this.GetHistoryRowAsync(1)).GetString("Input"));
            Assert.AreEqual("{\"a\":2}", (await this.GetInstanceRowAsync()).GetString("Input"));
        }

        [TestMethod]
        public async Task ReplacingAnOffloadedInputDropsTheBlobReference()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();
            string blobName = await this.OffloadInputAsync(8, "{\"large\":true}");

            // Act

            await OrchestrationHistoryEditor.UpdateEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 8, "{\"small\":true}");

            // Assert

            var row = await this.GetHistoryRowAsync(8);
            Assert.AreEqual("{\"small\":true}", row.GetString("Input"));
            Assert.IsFalse(row.ContainsKey("InputBlobName"), "the framework would keep reading the blob otherwise");
            Assert.IsFalse(await this._blobs.GetBlobClient(blobName).ExistsAsync(), "the orphaned blob should be gone");
        }

        [TestMethod]
        public async Task RejectsInputsAboveTheInlineLimit()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // 40,000 characters are 80 KB of UTF-16, more than the 60 KB the framework keeps inline
            string hugeInput = "\"" + new string('x', 40_000) + "\"";

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmPayloadTooLargeException>(
                () => OrchestrationHistoryEditor.UpdateEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 8, hugeInput));

            // Assert

            StringAssert.Contains(ex.Message, "60 KB");
            Assert.AreEqual("{\"ok\":true}", (await this.GetHistoryRowAsync(8)).GetString("Input"));
        }

        [TestMethod]
        public async Task RejectsEventsThatCarryNoInput()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act & Assert

            await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationHistoryEditor.UpdateEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 2, "{}"));
        }

        [TestMethod]
        public async Task RejectsRowsOfAPreviousExecution()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act & Assert

            // Row 20 exists, but belongs to the generation that ran before the current one
            await Assert.ThrowsExactlyAsync<DfmNotFoundException>(
                () => OrchestrationHistoryEditor.GetEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 20));

            await Assert.ThrowsExactlyAsync<DfmNotFoundException>(
                () => OrchestrationHistoryEditor.UpdateEventInputAsync(null, ConnStringName, this._hubName, InstanceId, 99, "{}"));
        }

        [TestMethod]
        public async Task TruncatesFromTheEpisodeOpenerAndReopensTheInstance()
        {
            // Arrange

            await this.SeedInstanceAsync("Completed", output: "{\"done\":true}", completedTime: DateTimeOffset.UtcNow);
            await this.SeedFailedHistoryAsync();

            // Act

            int deleted = await OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 8);

            // Assert

            // The event opened its episode, so the OrchestratorStarted at 7 goes too: 7..15 is 9 rows
            Assert.AreEqual(9, deleted);

            var remaining = await this.GetCurrentExecutionRowsAsync();
            CollectionAssert.AreEqual(Enumerable.Range(0, 7).Select(i => i.ToString("X16")).ToArray(), remaining.Select(r => r.RowKey).ToArray());

            // The kept history already ends with an OrchestratorCompleted, so nothing was added
            Assert.AreEqual("OrchestratorCompleted", remaining.Last().GetString("EventType"));

            // Leftovers of the previous generation and the sentinel are not ours to touch
            Assert.IsNotNull(await this.TryGetHistoryRowAsync(20));
            Assert.IsNotNull(await this.TryGetHistoryRowAsync("sentinel"));

            var instance = await this.GetInstanceRowAsync();
            Assert.AreEqual("Running", instance.GetString("RuntimeStatus"));
            Assert.AreEqual(ExecutionId, instance.GetString("ExecutionId"));
            Assert.IsFalse(instance.ContainsKey("Output"));
            Assert.IsFalse(instance.ContainsKey("CompletedTime"));
            Assert.AreEqual("{\"a\":1}", instance.GetString("Input"));
        }

        [TestMethod]
        public async Task TruncatingMidEpisodeClosesTheKeptEpisode()
        {
            // Arrange

            // The approval arrived in the same batch as a task completion, so it is not the first row of its episode
            await this.SeedHistoryAsync(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{\"a\":1}"),
                Row(2, "TaskScheduled", name: "Activity1", eventId: 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                Row(5, "TaskCompleted", taskScheduledId: 0, result: "42"),
                Row(6, "EventRaised", name: "Approval", input: "{\"ok\":true}"),
                Row(7, "SubOrchestrationInstanceCreated", name: "Child", eventId: 1),
                Row(8, "OrchestratorCompleted"));

            // Act

            int deleted = await OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 6);

            // Assert

            Assert.AreEqual(3, deleted);

            var remaining = await this.GetCurrentExecutionRowsAsync();
            CollectionAssert.AreEqual(
                new[] { "OrchestratorStarted", "ExecutionStarted", "TaskScheduled", "OrchestratorCompleted", "OrchestratorStarted", "TaskCompleted", "OrchestratorCompleted" },
                remaining.Select(r => r.GetString("EventType")).ToArray());

            // The synthetic closing row is addressed and stamped like the framework's own
            var closingRow = remaining.Last();
            Assert.AreEqual(6L.ToString("X16"), closingRow.RowKey);
            Assert.AreEqual(ExecutionId, closingRow.GetString("ExecutionId"));
            Assert.AreEqual(-1, closingRow.GetInt32("EventId"));
            Assert.IsTrue(closingRow.GetBoolean("IsPlayed"));
            Assert.IsNotNull(closingRow.GetDateTimeOffset("_Timestamp"));
        }

        [TestMethod]
        public async Task DeletesTheBlobsOfDeletedRows()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();
            string inputBlob = await this.OffloadInputAsync(8, "{\"large\":true}");
            string resultBlob = await this.OffloadAsync(11, "Result", "\"a very large result\"");
            string keptBlob = await this.OffloadAsync(5, "Result", "\"kept\"");

            // Act

            await OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 8);

            // Assert

            Assert.IsFalse(await this._blobs.GetBlobClient(inputBlob).ExistsAsync());
            Assert.IsFalse(await this._blobs.GetBlobClient(resultBlob).ExistsAsync());
            Assert.IsTrue(await this._blobs.GetBlobClient(keptBlob).ExistsAsync(), "blobs of kept rows must stay");
        }

        [TestMethod]
        public async Task RefusesToReplayPastWorkThatFinishedAfterTheEvent()
        {
            // Arrange

            // Task.WhenAll(CallActivityAsync("Work"), WaitForExternalEvent("Approval")): the approval arrived while Work ran
            await this.SeedHistoryAsync(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator", input: "{\"a\":1}"),
                Row(2, "TaskScheduled", name: "Work", eventId: 0),
                Row(3, "OrchestratorCompleted"),
                Row(4, "OrchestratorStarted"),
                Row(5, "EventRaised", name: "Approval", input: "{\"ok\":true}"),
                Row(6, "OrchestratorCompleted"),
                Row(7, "OrchestratorStarted"),
                Row(8, "TaskCompleted", taskScheduledId: 0, result: "42"),
                Row(9, "OrchestratorCompleted"));

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 5));

            // Assert

            StringAssert.Contains(ex.Message, "TaskScheduled 'Work'");
            Assert.AreEqual(10, (await this.GetCurrentExecutionRowsAsync()).Count, "nothing was deleted");
            Assert.AreEqual("Failed", (await this.GetInstanceRowAsync()).GetString("RuntimeStatus"), "the instance was not reopened");
        }

        [TestMethod]
        public async Task BumpsTheSentinelETagSoALiveSessionCannotCheckpointOverTheEdit()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();
            var sentinelBefore = await this.TryGetHistoryRowAsync("sentinel");

            // Act

            await OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 8);

            // Assert

            var sentinelAfter = await this.TryGetHistoryRowAsync("sentinel");

            Assert.AreNotEqual(sentinelBefore.ETag, sentinelAfter.ETag);
            Assert.AreEqual(ExecutionId, sentinelAfter.GetString("ExecutionId"));
            Assert.IsTrue(sentinelAfter.GetBoolean("IsCheckpointComplete"));
        }

        [TestMethod]
        public async Task RefusesToTruncateFromAnythingButAnEventRaised()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act & Assert

            await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 5));

            // Nothing happened
            Assert.AreEqual(16, (await this.GetCurrentExecutionRowsAsync()).Count);
            Assert.AreEqual("Failed", (await this.GetInstanceRowAsync()).GetString("RuntimeStatus"));
        }

        [TestMethod]
        public async Task UnknownInstancesAndEventsAreNotFound()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act & Assert

            await Assert.ThrowsExactlyAsync<DfmNotFoundException>(
                () => OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, "no-such-instance", 8));

            await Assert.ThrowsExactlyAsync<DfmNotFoundException>(
                () => OrchestrationHistoryEditor.TruncateHistoryAsync(null, ConnStringName, this._hubName, InstanceId, 42));
        }

        // A failed run: started, one activity, one approval, a child, a failing activity, all wrapped in episode markers.
        // Plus the sentinel and a leftover row of the generation that ran before this one.
        private Task SeedFailedHistoryAsync()
        {
            return this.SeedHistoryAsync(
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
                Row(13, "TaskScheduled", name: "Activity2", eventId: 2),
                Row(14, "OrchestratorCompleted"),
                Row(15, "OrchestratorStarted"),
                Row(20, "TaskCompleted", taskScheduledId: 2, result: "old", executionId: "exec-0"));
        }

        private async Task SeedHistoryAsync(params TableEntity[] rows)
        {
            foreach (var row in rows)
            {
                await this._history.UpsertEntityAsync(row);
            }

            await this._history.UpsertEntityAsync(new TableEntity(InstanceId, "sentinel")
            {
                ["ExecutionId"] = ExecutionId,
                ["IsCheckpointComplete"] = true,
                ["CheckpointCompletedTimestamp"] = DateTimeOffset.UtcNow
            });
        }

        private Task SeedInstanceAsync(string runtimeStatus, string output = null, DateTimeOffset? completedTime = null)
        {
            var row = new TableEntity(InstanceId, string.Empty)
            {
                ["ExecutionId"] = ExecutionId,
                ["Name"] = "MyOrchestrator",
                ["Version"] = "",
                ["Input"] = "{\"a\":1}",
                ["RuntimeStatus"] = runtimeStatus,
                ["CreatedTime"] = DateTimeOffset.UtcNow.AddMinutes(-10),
                ["LastUpdatedTime"] = DateTimeOffset.UtcNow.AddMinutes(-1),
                ["TaskHubName"] = this._hubName,
                ["CustomStatus"] = "null"
            };

            if (output != null)
            {
                row["Output"] = output;
            }

            if (completedTime.HasValue)
            {
                row["CompletedTime"] = completedTime.Value;
            }

            return this._instances.UpsertEntityAsync(row);
        }

        private static TableEntity Row(long sequenceNumber, string eventType, string name = null, string input = null, int? eventId = null, int? taskScheduledId = null, string result = null, string executionId = ExecutionId)
        {
            var row = new TableEntity(InstanceId, sequenceNumber.ToString("X16"))
            {
                ["ExecutionId"] = executionId,
                ["EventType"] = eventType,
                ["_Timestamp"] = DateTimeOffset.UtcNow.AddSeconds(sequenceNumber),
                ["IsPlayed"] = true,
                ["EventId"] = eventId ?? -1
            };

            if (name != null) row["Name"] = name;
            if (input != null) row["Input"] = input;
            if (result != null) row["Result"] = result;
            if (taskScheduledId.HasValue) row["TaskScheduledId"] = taskScheduledId.Value;

            return row;
        }

        // Moves a row's Input into a blob, the way the framework does for payloads above 60 KB
        private Task<string> OffloadInputAsync(long sequenceNumber, string input)
        {
            return this.OffloadAsync(sequenceNumber, "Input", input);
        }

        private async Task<string> OffloadAsync(long sequenceNumber, string property, string value)
        {
            var row = await this.GetHistoryRowAsync(sequenceNumber);

            string blobName = $"{InstanceId}/history-{row.RowKey}-{row.GetString("EventType")}-1A2B3C4D-{property}.json.gz";

            using (var compressed = new MemoryStream())
            {
                using (var gzip = new GZipStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
                {
                    var bytes = Encoding.UTF8.GetBytes(value);
                    await gzip.WriteAsync(bytes, 0, bytes.Length);
                }

                compressed.Position = 0;
                await this._blobs.GetBlobClient(blobName).UploadAsync(compressed, overwrite: true);
            }

            row[property] = string.Empty;
            row[property + "BlobName"] = blobName;
            await this._history.UpdateEntityAsync(row, row.ETag, TableUpdateMode.Replace);

            return blobName;
        }

        private async Task<TableEntity> GetInstanceRowAsync()
        {
            return (await this._instances.GetEntityAsync<TableEntity>(InstanceId, string.Empty)).Value;
        }

        private async Task<TableEntity> GetHistoryRowAsync(long sequenceNumber)
        {
            return (await this._history.GetEntityAsync<TableEntity>(InstanceId, sequenceNumber.ToString("X16"))).Value;
        }

        private Task<TableEntity> TryGetHistoryRowAsync(long sequenceNumber)
        {
            return this.TryGetHistoryRowAsync(sequenceNumber.ToString("X16"));
        }

        private async Task<TableEntity> TryGetHistoryRowAsync(string rowKey)
        {
            var response = await this._history.GetEntityIfExistsAsync<TableEntity>(InstanceId, rowKey);

            return response.HasValue ? response.Value : null;
        }

        // The current execution's rows, in sequence order, without the sentinel
        private async Task<List<TableEntity>> GetCurrentExecutionRowsAsync()
        {
            var result = new List<TableEntity>();

            await foreach (var row in this._history.QueryAsync<TableEntity>(r => r.PartitionKey == InstanceId))
            {
                if (row.RowKey != "sentinel" && row.GetString("ExecutionId") == ExecutionId)
                {
                    result.Add(row);
                }
            }

            return result.OrderBy(r => r.RowKey).ToList();
        }

        private string InstancesTable => this._hubName + "Instances";
        private string HistoryTable => this._hubName + "History";

        private const string ConnStringName = "DFM_TEST_EDITOR_CONN_STRING";
        private const string InstanceId = "my-instance";
        private const string ExecutionId = "exec-1";

        private string _hubName;
        private TableServiceClient _tableService;
        private Azure.Data.Tables.TableClient _instances;
        private Azure.Data.Tables.TableClient _history;
        private BlobContainerClient _blobs;
    }
}
