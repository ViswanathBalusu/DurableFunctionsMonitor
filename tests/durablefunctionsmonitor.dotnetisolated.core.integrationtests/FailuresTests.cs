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
    /// Drives AzureStorageAggregations.GetFailuresAsync - the bounded, projected scan of the XXXInstances
    /// table behind GET /failures - against a real Table endpoint, on rows laid out the way the Durable Task
    /// Framework writes them (PartitionKey = instanceId, RowKey = "", the error JSON in Output).
    ///
    /// The grouping rules are unit tested in FailuresAggregatorTests; what is proved here is the storage
    /// half: the RuntimeStatus and CreatedTime filter, the projection, that entity rows are skipped and that
    /// hitting the cap is reported.
    /// </summary>
    [TestClass]
    public class FailuresTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmFailures" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._tableService = new TableServiceClient(StorageEmulator.ConnectionString);
            await this._tableService.CreateTableIfNotExistsAsync(this.InstancesTable);

            this._instances = this._tableService.GetTableClient(this.InstancesTable);

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
        public async Task GroupsTheSeededFailuresIntoTheFailuresResponse()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act

            // Going through the extension point, so that the wiring of the Azure Storage default is covered too
            var result = await new DfmExtensionPoints().GetFailuresRoutine(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 1000), CancellationToken.None);

            // Assert

            // Nine failed orchestrations in three signatures: 6 inventory, 2 timeouts, 1 ledger
            Assert.AreEqual(3, result.Groups.Count);
            CollectionAssert.AreEqual(new[] { 6, 2, 1 }, result.Groups.Select(g => g.Count).ToArray());
            Assert.AreEqual(9, result.TotalFailed);
            Assert.IsFalse(result.Partial);
            Assert.AreEqual(1000, result.Cap);

            var inventory = result.Groups.First();
            Assert.AreEqual("ProcessOrderOrchestrator", inventory.Name);
            StringAssert.StartsWith(inventory.Signature, "InventoryUnavailable: SKU-*");
            Assert.AreEqual(5, inventory.SampleIds.Count);
            Assert.AreEqual(6, inventory.Instances.Count);

            // The projection carried the times and the payload
            var instance = inventory.Instances.First();
            Assert.IsTrue(instance.CreatedTime > DateTimeOffset.MinValue);
            Assert.IsNotNull(instance.CompletedTime);
            Assert.IsTrue(instance.DurationMs > 0);
            StringAssert.StartsWith(instance.Reason, "InventoryUnavailable: SKU-");

            Assert.AreEqual("ReconcileLedgerOrchestrator", result.Groups.Last().Name);
        }

        [TestMethod]
        public async Task LeavesOutInstancesThatDidNotFail()
        {
            // Arrange (the seed also writes Completed and Running rows)

            await this.SeedTheHubAsync();

            // Act

            var result = await AzureStorageAggregations.GetFailuresAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 1000), CancellationToken.None);

            // Assert: the RuntimeStatus filter is applied by the table, not after the fact

            Assert.AreEqual(9, result.Scanned);
            Assert.IsFalse(result.Groups.Any(g => g.Name == "HappyOrchestrator"));
        }

        [TestMethod]
        public async Task LeavesOutFailuresCreatedOutsideTheRange()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act (a window that only covers the failure created three days ago)

            var query = this.RangeQuery(cap: 1000);
            query.From = this._now.AddDays(-4);
            query.To = this._now.AddDays(-2);

            var result = await AzureStorageAggregations.GetFailuresAsync(
                null, ConnStringName, this._hubName, query, CancellationToken.None);

            // Assert

            Assert.AreEqual(1, result.TotalFailed);
            Assert.AreEqual("OldOrchestrator", result.Groups.Single().Name);
        }

        [TestMethod]
        public async Task SkipsFailedEntityRows()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // A failed entity row: an entity has no orchestrator to group under
            await this._instances.UpsertEntityAsync(
                this.Row("@counter@warehouse-07", "counter", "Failed", createdMinutesAgo: 20, output: Error("Entity operation failed")));

            // Act

            var result = await AzureStorageAggregations.GetFailuresAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 1000), CancellationToken.None);

            // Assert: it was scanned (the table returned it) but never grouped

            Assert.AreEqual(10, result.Scanned);
            Assert.AreEqual(9, result.TotalFailed);
            Assert.IsFalse(result.Groups.Any(g => g.Name == "counter"));
        }

        [TestMethod]
        public async Task ReportsAPartialScanWhenTheCapIsHit()
        {
            // Arrange (10 failed rows sit inside the range)

            await this.SeedTheHubAsync();

            // Act

            var result = await AzureStorageAggregations.GetFailuresAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 4), CancellationToken.None);

            // Assert

            Assert.AreEqual(4, result.Scanned, "the scan stops at the cap");
            Assert.AreEqual(4, result.TotalFailed);
            Assert.IsTrue(result.Partial, "and says so, rather than passing a truncated count off as the total");
            Assert.AreEqual(4, result.Cap);
        }

        [TestMethod]
        public async Task FallsBackToTheDefaultCapWhenTheQueryDoesNotSetOne()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act (Cap left at 0, the way a query object comes out of the box)

            var result = await AzureStorageAggregations.GetFailuresAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 0), CancellationToken.None);

            // Assert

            Assert.AreEqual(AzureStorageAggregations.DefaultStatsScanCap, result.Cap);
            Assert.IsFalse(result.Partial);
        }

        [TestMethod]
        public async Task ReturnsAnEmptyResultForAHubWithNoFailures()
        {
            // Act (nothing was seeded at all)

            var result = await AzureStorageAggregations.GetFailuresAsync(
                null, ConnStringName, this._hubName, this.RangeQuery(cap: 1000), CancellationToken.None);

            // Assert

            Assert.AreEqual(0, result.Groups.Count);
            Assert.AreEqual(0, result.TotalFailed);
            Assert.IsFalse(result.Partial);
        }

        #region Setup

        /// <summary>
        /// The failure mix of ScreenFailures: six InventoryUnavailable, two ChargePayment timeouts and one
        /// ledger checksum mismatch inside the queried window, one older failure outside it, plus a couple
        /// of instances that did not fail at all.
        /// </summary>
        private async Task SeedTheHubAsync()
        {
            var rows = new List<TableEntity>();

            for (int i = 0; i < 6; i++)
            {
                rows.Add(this.Row($"order-inventory-{i}", "ProcessOrderOrchestrator", "Failed",
                    createdMinutesAgo: 100 + i,
                    output: Error($"InventoryUnavailable: SKU-{4471 + i} has 0 units in warehouse-{i:00}")));
            }

            for (int i = 0; i < 2; i++)
            {
                rows.Add(this.Row($"order-timeout-{i}", "ProcessOrderOrchestrator", "Failed",
                    createdMinutesAgo: 80 + i,
                    output: Error("Timeout: ChargePayment did not complete within 20 s")));
            }

            rows.Add(this.Row("ledger-1", "ReconcileLedgerOrchestrator", "Failed",
                createdMinutesAgo: 60,
                output: Error("Ledger checksum mismatch for account \\\"4471-EU\\\"")));

            // Not failures
            rows.Add(this.Row("happy-1", "HappyOrchestrator", "Completed", createdMinutesAgo: 50, output: "\"ok\""));
            rows.Add(this.Row("happy-2", "HappyOrchestrator", "Running", createdMinutesAgo: 40, output: null));

            // Outside the window
            rows.Add(this.Row("old-1", "OldOrchestrator", "Failed",
                createdMinutesAgo: 3 * 24 * 60,
                output: Error("Something failed long ago")));

            foreach (var row in rows)
            {
                await this._instances.UpsertEntityAsync(row);
            }
        }

        /// <summary>
        /// An XXXInstances row exactly as AzureTableTrackingStore writes it: PartitionKey = instanceId,
        /// RowKey = "", and the payload columns the projection is supposed to skip.
        /// </summary>
        private TableEntity Row(string instanceId, string name, string runtimeStatus, int createdMinutesAgo, string output)
        {
            var createdTime = this._now.AddMinutes(-createdMinutesAgo);

            var row = new TableEntity(instanceId, string.Empty)
            {
                ["ExecutionId"] = "exec-" + instanceId,
                ["Name"] = name,
                ["Version"] = "",
                ["RuntimeStatus"] = runtimeStatus,
                ["CreatedTime"] = createdTime,
                ["LastUpdatedTime"] = createdTime.AddSeconds(30),
                ["TaskHubName"] = this._hubName,

                // The fat columns the failures projection leaves behind
                ["Input"] = "{\"payload\":\"" + new string('x', 512) + "\"}",
                ["CustomStatus"] = "null"
            };

            if (output != null)
            {
                row["Output"] = output;
            }

            if (runtimeStatus != "Running")
            {
                row["CompletedTime"] = createdTime.AddSeconds(30);
            }

            return row;
        }

        /// <summary>An Output as the framework writes it for a failed orchestration.</summary>
        private static string Error(string message)
        {
            return "{\"ErrorType\":\"System.Exception\",\"ErrorMessage\":\"" + message + "\"}";
        }

        private FailuresQuery RangeQuery(int cap)
        {
            return new FailuresQuery
            {
                From = this._now.AddHours(-24),
                To = this._now,
                Cap = cap
            };
        }

        private string InstancesTable => this._hubName + "Instances";

        private const string ConnStringName = "DFM_TEST_FAILURES_CONN_STRING";

        private string _hubName;
        private DateTimeOffset _now;
        private TableServiceClient _tableService;
        private Azure.Data.Tables.TableClient _instances;

        #endregion
    }
}
