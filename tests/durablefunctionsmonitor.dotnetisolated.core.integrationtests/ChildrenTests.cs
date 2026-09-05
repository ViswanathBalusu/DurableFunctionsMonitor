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
    /// Drives AzureStorageAggregations.GetChildrenAsync - the PartitionKey range query behind
    /// GET orchestrations('{id}')/children - against a real Table endpoint, on rows laid out the way the
    /// Durable Task Framework writes them (PartitionKey = instanceId, RowKey = "", a generated
    /// sub-orchestration id being "{parent ExecutionId}:{taskId}").
    ///
    /// What is proved here is the storage half: that the half-open ['{executionId}:', '{executionId};')
    /// range picks up exactly this parent's generated children, that an id which merely starts with the
    /// same characters is not one of them, and that the projection carries the four ChildInstance fields.
    /// </summary>
    [TestClass]
    public class ChildrenTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmChildren" + Guid.NewGuid().ToString("N").Substring(0, 12);

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
        public async Task FindsTheGeneratedChildrenOfTheInstanceAndNothingElse()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act

            // Going through the extension point, so that the wiring of the Azure Storage default is covered too
            var result = await new DfmExtensionPoints().GetChildrenRoutine(null, ConnStringName, this._hubName, ParentId);

            // Assert

            // exec-1:0 and exec-1:1 are this parent's; exec-1x:0 belongs to another instance whose
            // ExecutionId merely starts with the same characters, and sorts past the range's upper bound
            CollectionAssert.AreEqual(
                new[] { "exec-1:0", "exec-1:1" },
                result.Children.Select(c => c.InstanceId).ToArray());

            // Azure Storage matches generated ids, so children the orchestrator named itself cannot be
            // found this way and the list is never guaranteed to be exhaustive
            Assert.IsFalse(result.Complete);
        }

        [TestMethod]
        public async Task CarriesTheFourProjectedColumnsOfEachChild()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act

            var result = await AzureStorageAggregations.GetChildrenAsync(null, ConnStringName, this._hubName, ParentId);

            // Assert

            var first = result.Children.First();
            Assert.AreEqual("exec-1:0", first.InstanceId);
            Assert.AreEqual("ReserveInventory", first.Name);
            Assert.AreEqual("Completed", first.RuntimeStatus);
            Assert.AreEqual(this._now.AddMinutes(-10).ToUnixTimeSeconds(), first.CreatedTime.ToUnixTimeSeconds());
            Assert.AreEqual(this._now.AddMinutes(-9).ToUnixTimeSeconds(), first.LastUpdatedTime.ToUnixTimeSeconds());
        }

        [TestMethod]
        public async Task OrdersTheChildrenOldestFirst()
        {
            // Arrange: the second child was created first, so creation order and id order disagree

            await this._instances.UpsertEntityAsync(this.Row(ParentId, "ProcessOrderOrchestrator", "Running", ParentExecutionId, createdMinutesAgo: 20));
            await this._instances.UpsertEntityAsync(this.Row("exec-1:0", "Second", "Completed", "exec-1-0", createdMinutesAgo: 5));
            await this._instances.UpsertEntityAsync(this.Row("exec-1:1", "First", "Completed", "exec-1-1", createdMinutesAgo: 15));

            // Act

            var result = await AzureStorageAggregations.GetChildrenAsync(null, ConnStringName, this._hubName, ParentId);

            // Assert

            CollectionAssert.AreEqual(new[] { "First", "Second" }, result.Children.Select(c => c.Name).ToArray());
        }

        [TestMethod]
        public async Task GrandchildrenAreNotReturnedBecauseTheyCarryTheChildsExecutionId()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // A child of exec-1:0, generated from *its* ExecutionId
            await this._instances.UpsertEntityAsync(this.Row("exec-1-0:0", "ChargeCard", "Completed", "exec-1-0-0", createdMinutesAgo: 8));

            // Act

            var result = await AzureStorageAggregations.GetChildrenAsync(null, ConnStringName, this._hubName, ParentId);

            // Assert: one call, one level of the tree

            CollectionAssert.AreEqual(
                new[] { "exec-1:0", "exec-1:1" },
                result.Children.Select(c => c.InstanceId).ToArray());
        }

        [TestMethod]
        public async Task ReturnsNothingForAnInstanceWithoutChildren()
        {
            // Arrange

            await this._instances.UpsertEntityAsync(this.Row("lonely", "LonelyOrchestrator", "Completed", "exec-lonely", createdMinutesAgo: 5));

            // Act

            var result = await AzureStorageAggregations.GetChildrenAsync(null, ConnStringName, this._hubName, "lonely");

            // Assert

            Assert.AreEqual(0, result.Children.Count);
            Assert.IsFalse(result.Complete);
        }

        [TestMethod]
        public async Task ReturnsNothingWhenTheInstanceRowIsGone()
        {
            // Arrange: children exist, but the parent row was purged, so there is no ExecutionId to match by

            await this._instances.UpsertEntityAsync(this.Row("exec-1:0", "ReserveInventory", "Completed", "exec-1-0", createdMinutesAgo: 10));

            // Act

            var result = await AzureStorageAggregations.GetChildrenAsync(null, ConnStringName, this._hubName, ParentId);

            // Assert: an empty list, not a crash and not a whole-table scan

            Assert.AreEqual(0, result.Children.Count);
        }

        [TestMethod]
        public async Task ReturnsNothingWhenTheInstanceRowHasNoExecutionId()
        {
            // Arrange

            var parent = this.Row(ParentId, "ProcessOrderOrchestrator", "Running", ParentExecutionId, createdMinutesAgo: 20);
            parent["ExecutionId"] = string.Empty;
            await this._instances.UpsertEntityAsync(parent);

            await this._instances.UpsertEntityAsync(this.Row("exec-1:0", "ReserveInventory", "Completed", "exec-1-0", createdMinutesAgo: 10));

            // Act

            var result = await AzureStorageAggregations.GetChildrenAsync(null, ConnStringName, this._hubName, ParentId);

            // Assert

            Assert.AreEqual(0, result.Children.Count);
        }

        #region Setup

        /// <summary>
        /// A parent with ExecutionId 'exec-1', its two generated children 'exec-1:0' and 'exec-1:1', and an
        /// unrelated instance 'exec-1x:0' whose id starts with the same characters but is not a child of it.
        /// </summary>
        private async Task SeedTheHubAsync()
        {
            var rows = new List<TableEntity>
            {
                this.Row(ParentId, "ProcessOrderOrchestrator", "Running", ParentExecutionId, createdMinutesAgo: 20),
                this.Row("exec-1:0", "ReserveInventory", "Completed", "exec-1-0", createdMinutesAgo: 10),
                this.Row("exec-1:1", "ChargePayment", "Running", "exec-1-1", createdMinutesAgo: 9),

                // Not a child: ';' closes the range right after ':', so "exec-1x:0" sorts past its upper bound
                this.Row("exec-1x:0", "SomeoneElsesChild", "Completed", "exec-1x-0", createdMinutesAgo: 8),

                // Nor is a plain instance that has nothing to do with the parent
                this.Row("unrelated", "UnrelatedOrchestrator", "Completed", "exec-2", createdMinutesAgo: 7)
            };

            foreach (var row in rows)
            {
                await this._instances.UpsertEntityAsync(row);
            }
        }

        /// <summary>
        /// An XXXInstances row exactly as AzureTableTrackingStore writes it: PartitionKey = instanceId,
        /// RowKey = "", and the payload columns the projection is supposed to skip.
        /// </summary>
        private TableEntity Row(string instanceId, string name, string runtimeStatus, string executionId, int createdMinutesAgo)
        {
            var createdTime = this._now.AddMinutes(-createdMinutesAgo);

            return new TableEntity(instanceId, string.Empty)
            {
                ["ExecutionId"] = executionId,
                ["Name"] = name,
                ["Version"] = "",
                ["RuntimeStatus"] = runtimeStatus,
                ["CreatedTime"] = createdTime,
                ["LastUpdatedTime"] = createdTime.AddMinutes(1),
                ["TaskHubName"] = this._hubName,

                // The fat columns: never selected by the children projection
                ["Input"] = "{\"payload\":\"" + new string('x', 512) + "\"}",
                ["Output"] = "{\"result\":\"" + new string('y', 512) + "\"}",
                ["CustomStatus"] = "null"
            };
        }

        private string InstancesTable => this._hubName + "Instances";

        private const string ConnStringName = "DFM_TEST_CHILDREN_CONN_STRING";
        private const string ParentId = "order-2026-09-04-000913";
        private const string ParentExecutionId = "exec-1";

        private string _hubName;
        private DateTimeOffset _now;
        private TableServiceClient _tableService;
        private Azure.Data.Tables.TableClient _instances;

        #endregion
    }
}
