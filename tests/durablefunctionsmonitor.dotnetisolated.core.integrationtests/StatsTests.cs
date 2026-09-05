// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives AzureStorageAggregations.GetStatsAsync - the bounded, projected scan of the XXXInstances table
    /// behind GET /stats - against a real Table endpoint, on rows laid out the way the Durable Task Framework
    /// writes them (PartitionKey = instanceId, RowKey = "", entities under an @name@key id).
    ///
    /// The counting rules themselves are unit tested in StatsAggregatorTests; what is proved here is the
    /// storage half: the CreatedTime filter, the projection, the row-to-InstanceRowLite mapping and the
    /// honest reporting of scanned/partial when the cap bites.
    /// </summary>
    [TestClass]
    public class StatsTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmStats" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._tableService = new TableServiceClient(StorageEmulator.ConnectionString);
            await this._tableService.CreateTableIfNotExistsAsync(this.InstancesTable);

            this._instances = this._tableService.GetTableClient(this.InstancesTable);

            // One fixed 'now' for the whole test, so that the seeded rows and the queried range cannot drift
            // apart between the arrange and the act.
            this._now = DateTimeOffset.UtcNow;
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            if (this._tableService != null)
            {
                await this._tableService.DeleteTableAsync(this.InstancesTable);
            }
        }

        [TestMethod]
        public async Task AggregatesTheSeededHubIntoTheStatsResponse()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act

            // Going through the extension point, so that the wiring of the Azure Storage default is covered too
            var result = await new DfmExtensionPoints().GetStatsRoutine(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 1000), CancellationToken.None);

            // Assert

            // 30 orchestrations and 2 entities were created inside the range; the 2 rows created three days
            // ago are outside it and never even come back from the table.
            Assert.AreEqual(32, result.Scanned);
            Assert.IsFalse(result.Partial);
            Assert.AreEqual(1000, result.Cap);

            Assert.AreEqual(30, result.Totals[StatsAggregator.AllKey]);
            Assert.AreEqual(2, result.Totals[StatsAggregator.EntitiesKey]);

            Assert.AreEqual(14, result.Totals["Completed"]);
            Assert.AreEqual(4, result.Totals["Failed"]);
            Assert.AreEqual(4, result.Totals["Running"]);
            Assert.AreEqual(3, result.Totals["Pending"]);
            Assert.AreEqual(2, result.Totals["Suspended"]);
            Assert.AreEqual(3, result.Totals["Terminated"]);

            // Bins: every one of the 30 orchestrations was created inside the range, so they all land in a bucket
            Assert.AreEqual(48, result.BinCount);
            Assert.AreEqual(48, result.Bins.Count);
            Assert.AreEqual(30, result.Bins.Sum(b => b.Counts.Values.Sum()));

            // byName, sorted by started descending
            CollectionAssert.AreEqual(
                new[] { "AlphaOrchestrator", "BetaOrchestrator", "GammaOrchestrator", "DeltaOrchestrator" },
                result.ByName.Select(n => n.Name).ToArray());

            var alpha = result.ByName.First();
            Assert.AreEqual(12, alpha.Started);
            Assert.AreEqual(8, alpha.Completed);
            Assert.AreEqual(4, alpha.Failed);
            Assert.AreEqual(0, alpha.Running);
            Assert.AreEqual(4d / 12d, alpha.FailureRate, 0.0001);
            Assert.IsNotNull(alpha.LastFailedAt, "the Failed rows carry a LastUpdatedTime");

            // The CompletedTime column made it through the projection, so the durations are there
            Assert.IsNotNull(alpha.P50Ms);
            Assert.IsNotNull(alpha.P95Ms);

            var beta = result.ByName.Skip(1).First();
            Assert.AreEqual(10, beta.Started);
            Assert.AreEqual(4, beta.Running);

            // Entities: both rows are the same entity name, taken from the @name@key instance id
            Assert.AreEqual(1, result.EntitiesByName.Count);
            Assert.AreEqual("counter", result.EntitiesByName[0].Name);
            Assert.AreEqual(2, result.EntitiesByName[0].Count);

            // Stuck: the two Running rows last updated three hours ago (default threshold is 60 minutes)
            Assert.AreEqual(2, result.Stuck.Count);
            CollectionAssert.AreEquivalent(new[] { "beta-stuck-0", "beta-stuck-1" }, result.Stuck.SampleIds.ToArray());
            Assert.IsNotNull(result.Stuck.OldestLastUpdatedAt);

            // Long-pending: the three Pending rows created two hours ago (default threshold is 10 minutes)
            Assert.AreEqual(3, result.OldestPending.Count);
            Assert.IsNotNull(result.OldestPending.OldestCreatedAt);

            Assert.AreEqual(2, result.Suspended.Count);

            Assert.AreEqual(this.From, result.From);
            Assert.AreEqual(this.To, result.To);
        }

        [TestMethod]
        public async Task ReportsAPartialScanWhenTheCapIsHit()
        {
            // Arrange (32 rows sit inside the range)

            await this.SeedTheHubAsync();

            // Act

            var result = await AzureStorageAggregations.GetStatsAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 10), CancellationToken.None);

            // Assert

            Assert.AreEqual(10, result.Scanned, "the scan stops at the cap");
            Assert.IsTrue(result.Partial, "and says so, rather than passing a truncated count off as the total");
            Assert.AreEqual(10, result.Cap);

            // Whatever the ten rows were, they are all accounted for: an orchestration or an entity
            Assert.AreEqual(10, result.Totals[StatsAggregator.AllKey] + result.Totals[StatsAggregator.EntitiesKey]);
        }

        [TestMethod]
        public async Task ReportsAFullScanWhenTheCapIsExactlyTheNumberOfRows()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act (32 rows, cap 32 - nothing was cut short)

            var result = await AzureStorageAggregations.GetStatsAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 32), CancellationToken.None);

            // Assert

            Assert.AreEqual(32, result.Scanned);
            Assert.IsFalse(result.Partial);
        }

        [TestMethod]
        public async Task LeavesOutTheRowsCreatedOutsideTheRange()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act (a window that only covers the two rows created three days ago)

            var query = this.RangeQuery(cap: 1000);
            query.From = this._now.AddDays(-4);
            query.To = this._now.AddDays(-2);

            var result = await AzureStorageAggregations.GetStatsAsync(
                null, ConnStringName, this._hubName, query, CancellationToken.None);

            // Assert

            Assert.AreEqual(2, result.Scanned, "the CreatedTime filter is applied by the table, not after the fact");
            Assert.AreEqual(2, result.Totals[StatsAggregator.AllKey]);
            Assert.AreEqual(0, result.Totals[StatsAggregator.EntitiesKey]);
            Assert.AreEqual("OldOrchestrator", result.ByName.Single().Name);
        }

        [TestMethod]
        public async Task FallsBackToTheDefaultCapWhenTheQueryDoesNotSetOne()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act (Cap left at 0, the way a query object comes out of the box)

            var result = await AzureStorageAggregations.GetStatsAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 0), CancellationToken.None);

            // Assert

            Assert.AreEqual(AzureStorageAggregations.DefaultStatsScanCap, result.Cap);
            Assert.AreEqual(32, result.Scanned);
            Assert.IsFalse(result.Partial);
        }

        [TestMethod]
        public async Task ReturnsAnEmptyResultForAHubWithNoRowsInTheRange()
        {
            // Act (nothing was seeded at all)

            var result = await AzureStorageAggregations.GetStatsAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 1000), CancellationToken.None);

            // Assert

            Assert.AreEqual(0, result.Scanned);
            Assert.IsFalse(result.Partial);
            Assert.AreEqual(0, result.Totals[StatsAggregator.AllKey]);
            Assert.AreEqual(0, result.Totals[StatsAggregator.EntitiesKey]);
            Assert.AreEqual(0, result.ByName.Count);
            Assert.AreEqual(48, result.Bins.Count);
            Assert.AreEqual(0, result.Stuck.Count);
            Assert.IsNull(result.Stuck.OldestLastUpdatedAt);
        }

        #region Setup

        /// <summary>
        /// 30 orchestrations and 2 entities inside the queried 24-hour window, plus 2 orchestrations created
        /// three days ago (outside it). Every row also carries the fat columns of a real Instances row, which
        /// the projection has to leave behind.
        /// </summary>
        private async Task SeedTheHubAsync()
        {
            var rows = new List<TableEntity>();

            // AlphaOrchestrator: 8 Completed, 4 Failed - 12 started
            for (int i = 0; i < 8; i++)
            {
                rows.Add(this.Row($"alpha-completed-{i}", "AlphaOrchestrator", "Completed",
                    createdMinutesAgo: 600 + i, durationMinutes: 1 + i));
            }
            for (int i = 0; i < 4; i++)
            {
                rows.Add(this.Row($"alpha-failed-{i}", "AlphaOrchestrator", "Failed",
                    createdMinutesAgo: 500 + i, durationMinutes: 2 + i));
            }

            // BetaOrchestrator: 6 Completed, 2 stuck Running, 2 fresh Running - 10 started
            for (int i = 0; i < 6; i++)
            {
                rows.Add(this.Row($"beta-completed-{i}", "BetaOrchestrator", "Completed",
                    createdMinutesAgo: 400 + i, durationMinutes: 3));
            }
            for (int i = 0; i < 2; i++)
            {
                // Running and untouched for three hours - stuck, at the default 60-minute threshold
                rows.Add(this.Row($"beta-stuck-{i}", "BetaOrchestrator", "Running",
                    createdMinutesAgo: 300 + i, lastUpdatedMinutesAgo: 180 + i));
            }
            for (int i = 0; i < 2; i++)
            {
                rows.Add(this.Row($"beta-running-{i}", "BetaOrchestrator", "Running",
                    createdMinutesAgo: 30 + i, lastUpdatedMinutesAgo: 1));
            }

            // GammaOrchestrator: 3 long-pending, 2 Suspended - 5 started
            for (int i = 0; i < 3; i++)
            {
                rows.Add(this.Row($"gamma-pending-{i}", "GammaOrchestrator", "Pending",
                    createdMinutesAgo: 120 + i, lastUpdatedMinutesAgo: 120 + i));
            }
            for (int i = 0; i < 2; i++)
            {
                rows.Add(this.Row($"gamma-suspended-{i}", "GammaOrchestrator", "Suspended",
                    createdMinutesAgo: 200 + i, lastUpdatedMinutesAgo: 100 + i));
            }

            // DeltaOrchestrator: 3 Terminated
            for (int i = 0; i < 3; i++)
            {
                rows.Add(this.Row($"delta-terminated-{i}", "DeltaOrchestrator", "Terminated",
                    createdMinutesAgo: 250 + i, durationMinutes: 4));
            }

            // Two Durable Entities of the same entity name
            rows.Add(this.Row("@counter@first", "counter", "Running", createdMinutesAgo: 700, lastUpdatedMinutesAgo: 5));
            rows.Add(this.Row("@counter@second", "counter", "Running", createdMinutesAgo: 701, lastUpdatedMinutesAgo: 6));

            // Outside the window
            rows.Add(this.Row("old-0", "OldOrchestrator", "Completed", createdMinutesAgo: 3 * 24 * 60, durationMinutes: 1));
            rows.Add(this.Row("old-1", "OldOrchestrator", "Completed", createdMinutesAgo: 3 * 24 * 60 + 1, durationMinutes: 1));

            foreach (var row in rows)
            {
                await this._instances.UpsertEntityAsync(row);
            }
        }

        /// <summary>
        /// An XXXInstances row exactly as AzureTableTrackingStore writes it: PartitionKey = instanceId,
        /// RowKey = "", and the payload columns the projection is supposed to skip.
        /// </summary>
        private TableEntity Row(string instanceId, string name, string runtimeStatus, int createdMinutesAgo, int? lastUpdatedMinutesAgo = null, int? durationMinutes = null)
        {
            var createdTime = this._now.AddMinutes(-createdMinutesAgo);

            DateTimeOffset? completedTime = durationMinutes.HasValue ? createdTime.AddMinutes(durationMinutes.Value) : null;

            var lastUpdatedTime = lastUpdatedMinutesAgo.HasValue
                ? this._now.AddMinutes(-lastUpdatedMinutesAgo.Value)
                : completedTime ?? createdTime;

            var row = new TableEntity(instanceId, string.Empty)
            {
                ["ExecutionId"] = "exec-" + instanceId,
                ["Name"] = name,
                ["Version"] = "",
                ["RuntimeStatus"] = runtimeStatus,
                ["CreatedTime"] = createdTime,
                ["LastUpdatedTime"] = lastUpdatedTime,
                ["TaskHubName"] = this._hubName,

                // The fat columns: never selected by the stats projection
                ["Input"] = "{\"payload\":\"" + new string('x', 512) + "\"}",
                ["Output"] = "{\"result\":\"" + new string('y', 512) + "\"}",
                ["CustomStatus"] = "null"
            };

            if (completedTime.HasValue)
            {
                row["CompletedTime"] = completedTime.Value;
            }

            return row;
        }

        private StatsQuery RangeQuery(int cap)
        {
            return new StatsQuery
            {
                From = this.From,
                To = this.To,
                Cap = cap
            };
        }

        private DateTimeOffset From => this._now.AddHours(-24);
        private DateTimeOffset To => this._now;

        private string InstancesTable => this._hubName + "Instances";

        private const string ConnStringName = "DFM_TEST_STATS_CONN_STRING";

        private string _hubName;
        private DateTimeOffset _now;
        private TableServiceClient _tableService;
        private Azure.Data.Tables.TableClient _instances;

        #endregion
    }
}
