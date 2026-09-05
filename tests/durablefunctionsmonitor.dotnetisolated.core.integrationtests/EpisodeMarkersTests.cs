// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives the Azure Storage episode-marker and instance-row routines against a real Table endpoint,
    /// on tables laid out the way the Durable Task Framework writes them: hex row keys, ExecutionId on
    /// every row, a sentinel row, OrchestratorStarted/OrchestratorCompleted pairs around every episode
    /// and the leftovers of the generation that ran before this one.
    /// </summary>
    [TestClass]
    public class EpisodeMarkersTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmSpans" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._tableService = new TableServiceClient(StorageEmulator.ConnectionString);
            await this._tableService.CreateTableIfNotExistsAsync(this.InstancesTable);
            await this._tableService.CreateTableIfNotExistsAsync(this.HistoryTable);

            this._instances = this._tableService.GetTableClient(this.InstancesTable);
            this._history = this._tableService.GetTableClient(this.HistoryTable);
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            if (this._tableService != null)
            {
                await this._tableService.DeleteTableAsync(this.InstancesTable);
                await this._tableService.DeleteTableAsync(this.HistoryTable);
            }
        }

        [TestMethod]
        public async Task PairsTheEpisodesOfTheFailedHistoryLayout()
        {
            // Arrange

            await this.SeedInstanceAsync("Failed");
            await this.SeedFailedHistoryAsync();

            // Act

            // Going through the extension point, so that the wiring of the default is covered as well
            var markers = await new DfmExtensionPoints().GetEpisodeMarkersRoutine(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(5, markers.Count, "the layout wraps five orchestrator episodes");

            for (int i = 0; i < 4; i++)
            {
                Assert.IsNotNull(markers[i].End, $"episode #{i} is closed by an OrchestratorCompleted row");
                Assert.IsTrue(markers[i].Start <= markers[i].End.Value, $"episode #{i} cannot end before it starts");
            }

            // The instance failed while the last episode was still running, so that one stays open
            Assert.IsNull(markers[4].End);

            // Chronological order, no overlaps
            var starts = markers.Select(m => m.Start).ToList();
            CollectionAssert.AreEqual(starts.OrderBy(s => s).ToList(), starts);
            for (int i = 1; i < markers.Count; i++)
            {
                Assert.IsTrue(markers[i - 1].End.Value <= markers[i].Start, $"episode #{i} starts after #{i - 1} ended");
            }

            Assert.IsTrue(markers.All(m => m.Start.Offset == TimeSpan.Zero), "timestamps are reported in UTC");
        }

        [TestMethod]
        public async Task PairsTheEpisodesAgainstTheHistoryRowTimestamps()
        {
            // Arrange

            await this.SeedInstanceAsync("Completed");
            await this.SeedHistoryAsync(
                Row(0, "OrchestratorStarted"),
                Row(1, "ExecutionStarted", name: "MyOrchestrator"),
                Row(2, "OrchestratorCompleted"),
                Row(3, "OrchestratorStarted"),
                Row(4, "ExecutionCompleted"),
                Row(5, "OrchestratorCompleted"));

            // Act

            var markers = await AzureStorageAggregations.GetEpisodeMarkersAsync(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(2, markers.Count);

            Assert.AreEqual(await this.RowTimestampAsync(0), markers[0].Start);
            Assert.AreEqual(await this.RowTimestampAsync(2), markers[0].End);
            Assert.AreEqual(await this.RowTimestampAsync(3), markers[1].Start);
            Assert.AreEqual(await this.RowTimestampAsync(5), markers[1].End);
        }

        [TestMethod]
        public async Task IgnoresTheEpisodesOfPreviousGenerations()
        {
            // Arrange

            await this.SeedInstanceAsync("Running");
            await this.SeedHistoryAsync(
                // Two complete episodes left behind by the generation that ran before this one
                Row(0, "OrchestratorStarted", executionId: PreviousExecutionId),
                Row(1, "OrchestratorCompleted", executionId: PreviousExecutionId),
                Row(2, "OrchestratorStarted", executionId: PreviousExecutionId),
                Row(3, "OrchestratorCompleted", executionId: PreviousExecutionId),

                // The current generation
                Row(4, "OrchestratorStarted"),
                Row(5, "ExecutionStarted", name: "MyOrchestrator"),
                Row(6, "OrchestratorCompleted"));

            // Act

            var markers = await AzureStorageAggregations.GetEpisodeMarkersAsync(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(1, markers.Count);
            Assert.AreEqual(await this.RowTimestampAsync(4), markers[0].Start);
            Assert.AreEqual(await this.RowTimestampAsync(6), markers[0].End);
        }

        [TestMethod]
        public async Task LeavesAnEpisodeThatNeverCompletedOpen()
        {
            // Arrange

            await this.SeedInstanceAsync("Running");
            await this.SeedHistoryAsync(
                // The host died in the middle of this one, so no OrchestratorCompleted was ever written
                Row(0, "OrchestratorStarted"),
                Row(1, "OrchestratorStarted"),
                Row(2, "OrchestratorCompleted"));

            // Act

            var markers = await AzureStorageAggregations.GetEpisodeMarkersAsync(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(2, markers.Count);
            Assert.IsNull(markers[0].End, "an episode with no OrchestratorCompleted after it stays open");
            Assert.AreEqual(await this.RowTimestampAsync(2), markers[1].End);
        }

        [TestMethod]
        public async Task ReturnsNoMarkersWhenThereIsNoInstanceRow()
        {
            // Arrange

            await this.SeedFailedHistoryAsync();

            // Act (the instance row was never written, or was purged)

            var markers = await AzureStorageAggregations.GetEpisodeMarkersAsync(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(0, markers.Count);
        }

        [TestMethod]
        public async Task ReadsExecutionIdAndGenerationOfTheInstanceRow()
        {
            // Arrange

            await this.SeedInstanceAsync("Running", generation: 3);

            // Act

            var rowInfo = await new DfmExtensionPoints().GetInstanceRowInfoRoutine(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(ExecutionId, rowInfo.ExecutionId);
            Assert.AreEqual(3, rowInfo.Generation);

            // Azure Storage cannot tell the size of a history without reading all of it
            Assert.IsNull(rowInfo.HistoryBytesEstimate);
        }

        [TestMethod]
        public async Task ReportsAnUnknownGenerationAsNull()
        {
            // Arrange (rows written by older versions of the framework carry no Generation column)

            await this.SeedInstanceAsync("Running");

            // Act

            var rowInfo = await AzureStorageAggregations.GetInstanceRowInfoAsync(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.AreEqual(ExecutionId, rowInfo.ExecutionId);
            Assert.IsNull(rowInfo.Generation);
        }

        [TestMethod]
        public async Task ReturnsNoRowInfoWhenTheInstanceIsGone()
        {
            // Act (nothing was seeded)

            var rowInfo = await AzureStorageAggregations.GetInstanceRowInfoAsync(null, ConnStringName, this._hubName, InstanceId);

            // Assert

            Assert.IsNull(rowInfo);
        }

        #region Setup

        // The layout of OrchestrationHistoryEditorTests.SeedFailedHistoryAsync: a failed run of five
        // orchestrator episodes, the last of which never completed, plus the sentinel row and a leftover
        // row of the generation that ran before this one.
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
                Row(20, "TaskCompleted", taskScheduledId: 2, result: "old", executionId: PreviousExecutionId));
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

        private Task SeedInstanceAsync(string runtimeStatus, int? generation = null)
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

            if (generation.HasValue)
            {
                row["Generation"] = generation.Value;
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

        // The _Timestamp of a seeded row, as Table Storage stored it (rounded to milliseconds, in UTC)
        private async Task<DateTimeOffset> RowTimestampAsync(long sequenceNumber)
        {
            var row = await this._history.GetEntityAsync<TableEntity>(InstanceId, sequenceNumber.ToString("X16"));

            return row.Value.GetDateTimeOffset("_Timestamp").Value.ToUniversalTime();
        }

        private string InstancesTable => this._hubName + "Instances";
        private string HistoryTable => this._hubName + "History";

        private const string ConnStringName = "DFM_TEST_SPANS_CONN_STRING";
        private const string InstanceId = "my-instance";
        private const string ExecutionId = "exec-1";
        private const string PreviousExecutionId = "exec-0";

        private string _hubName;
        private TableServiceClient _tableService;
        private Azure.Data.Tables.TableClient _instances;
        private Azure.Data.Tables.TableClient _history;

        #endregion
    }
}
