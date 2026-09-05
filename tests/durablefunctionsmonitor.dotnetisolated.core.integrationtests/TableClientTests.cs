// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives ITableClient against a real Table endpoint. These cover the parts of the
    /// Azure.Data.Tables port that a mocked ITableClient cannot: OData filter syntax, paging,
    /// the missing-entity contract and ETag concurrency.
    /// </summary>
    [TestClass]
    public class TableClientTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            // A Task Hub of our own per test, so a rerun never trips over the previous one
            this._hubName = "DfmTest" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            var service = new TableServiceClient(StorageEmulator.ConnectionString);
            await service.CreateTableIfNotExistsAsync(this.InstancesTable);
            await service.CreateTableIfNotExistsAsync(this.HistoryTable);

            this._instances = service.GetTableClient(this.InstancesTable);
            this._history = service.GetTableClient(this.HistoryTable);
            this._service = service;

            this._tableClient = DurableFunctionsMonitor.DotNetIsolated.TableClient.GetTableClient(ConnStringName);
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            if (this._service != null)
            {
                await this._service.DeleteTableAsync(this.InstancesTable);
                await this._service.DeleteTableAsync(this.HistoryTable);
            }
        }

        [TestMethod]
        public async Task ListsTableNames()
        {
            // Act

            var names = await this._tableClient.ListTableNamesAsync();

            // Assert

            CollectionAssert.IsSubsetOf(
                new[] { this.InstancesTable, this.HistoryTable },
                names.ToList());
        }

        [TestMethod]
        public async Task ReturnsNullForAMissingEntity()
        {
            // The legacy TableOperation.Retrieve returned a null Result rather than throwing, and
            // GetParentInstanceIdDirectlyFromTable still relies on that

            var entity = await this._tableClient.GetEntityAsync(this.InstancesTable, "no-such-instance", string.Empty);

            Assert.IsNull(entity);
        }

        [TestMethod]
        public async Task RoundTripsAnEntityWhoseKeyContainsAQuote()
        {
            // Arrange

            // A single quote is what would break a hand-built OData filter
            string instanceId = "instance'with-quote";

            await this._instances.UpsertEntityAsync(new TableEntity(instanceId, string.Empty)
            {
                ["ExecutionId"] = "exec-1",
                ["RuntimeStatus"] = "Running"
            });

            // Act

            var entity = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);

            // Assert

            Assert.IsNotNull(entity);
            Assert.AreEqual("exec-1", entity.GetString("ExecutionId"));
        }

        [TestMethod]
        public async Task AppliesTheGeneratedQueryFilter()
        {
            // Arrange

            string instanceId = "instance'with-quote";
            await this.AddHistoryAsync(instanceId, "exec-1", "0000000001", "TaskScheduled", taskScheduledId: null);
            await this.AddHistoryAsync(instanceId, "exec-1", "0000000002", "TaskCompleted", taskScheduledId: 7);
            await this.AddHistoryAsync(instanceId, "exec-2", "0000000003", "TaskScheduled", taskScheduledId: null);
            await this.AddHistoryAsync("another-instance", "exec-1", "0000000001", "TaskScheduled", taskScheduledId: null);

            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and ExecutionId eq {"exec-1"}");

            // Act

            var rows = await this._tableClient.GetAllAsync(this.HistoryTable, filter);

            // Assert

            // Only the two rows of that instance and that execution - the quote did not break out
            // of the filter, and did not match everything either
            Assert.AreEqual(2, rows.Count());
        }

        [TestMethod]
        public async Task AppliesTheCorrelatedEventsFilter()
        {
            // Arrange

            string instanceId = "my-instance";
            await this.AddHistoryAsync(instanceId, "exec-1", "0000000001", "TaskScheduled", taskScheduledId: null);
            await this.AddHistoryAsync(instanceId, "exec-1", "0000000002", "TaskCompleted", taskScheduledId: 7);

            string instanceIdFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and ExecutionId eq {"exec-1"}");

            // Act

            // This is the shape OrchestrationHistory builds for the correlated-events query
            var rows = await this._tableClient.GetAllAsync(this.HistoryTable, $"{instanceIdFilter} and TaskScheduledId ge 0");

            // Assert

            Assert.AreEqual(1, rows.Count());
            Assert.AreEqual(7, rows.Single().GetInt32("TaskScheduledId"));
        }

        [TestMethod]
        public async Task ReturnsEverythingWhenTheFilterIsNull()
        {
            // The Netherite backend queries its partitions table with no filter at all

            await this.AddHistoryAsync("my-instance", "exec-1", "0000000001", "TaskScheduled", taskScheduledId: null);
            await this.AddHistoryAsync("my-instance", "exec-1", "0000000002", "TaskCompleted", taskScheduledId: 7);

            var rows = await this._tableClient.GetAllAsync(this.HistoryTable, null);

            Assert.AreEqual(2, rows.Count());
        }

        [TestMethod]
        public async Task PagesThroughMoreRowsThanOneQueryReturns()
        {
            // Arrange

            // Table Storage caps a query at 1000 entities, so this forces a continuation token.
            // The legacy code drove that by hand; Pageable has to do it for us now.
            const int rowCount = 1100;
            string instanceId = "big-instance";

            var batch = new List<TableTransactionAction>();
            for (int i = 0; i < rowCount; i++)
            {
                batch.Add(new TableTransactionAction(
                    TableTransactionActionType.UpsertReplace,
                    new TableEntity(instanceId, i.ToString("D10")) { ["EventType"] = "TimerFired" }));

                // Table transactions are capped at 100 entities
                if (batch.Count == 100)
                {
                    await this._history.SubmitTransactionAsync(batch);
                    batch.Clear();
                }
            }
            if (batch.Count > 0)
            {
                await this._history.SubmitTransactionAsync(batch);
            }

            // Act

            var rows = await this._tableClient.GetAllAsync(this.HistoryTable, null);

            // Assert

            Assert.AreEqual(rowCount, rows.Count());
        }

        [TestMethod]
        public async Task StopsQueryingWhenTheLazyEnumerationIsAbandoned()
        {
            // GetAll is deliberately lazy, because the history endpoint does not always read all of it

            string instanceId = "my-instance";
            for (int i = 0; i < 5; i++)
            {
                await this.AddHistoryAsync(instanceId, "exec-1", i.ToString("D10"), "TimerFired", taskScheduledId: null);
            }

            var firstTwo = this._tableClient.GetAll(this.HistoryTable, null).Take(2).ToList();

            Assert.AreEqual(2, firstTwo.Count);
        }

        [TestMethod]
        public async Task ReplacesAnEntity()
        {
            // Arrange

            string instanceId = "my-instance";
            await this._instances.UpsertEntityAsync(new TableEntity(instanceId, string.Empty)
            {
                ["CustomStatus"] = "\"old\"",
                ["RuntimeStatus"] = "Running"
            });

            // Act

            // This is what the 'set-custom-status' endpoint does
            var entity = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);
            entity["CustomStatus"] = "\"new\"";
            await this._tableClient.ReplaceEntityAsync(this.InstancesTable, entity);

            // Assert

            var updated = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);
            Assert.AreEqual("\"new\"", updated.GetString("CustomStatus"));
            Assert.AreEqual("Running", updated.GetString("RuntimeStatus"));
        }

        [TestMethod]
        public async Task ReplacingAnEntityDropsRemovedColumns()
        {
            // Arrange

            string instanceId = "my-instance";
            await this._instances.UpsertEntityAsync(new TableEntity(instanceId, string.Empty)
            {
                ["CustomStatus"] = "\"old\"",
                ["RuntimeStatus"] = "Running"
            });

            // Act

            // Clearing the custom status has to actually remove the column, which is why this is a
            // Replace rather than a Merge
            var entity = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);
            entity.Remove("CustomStatus");
            await this._tableClient.ReplaceEntityAsync(this.InstancesTable, entity);

            // Assert

            var updated = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);
            Assert.IsNull(updated.GetString("CustomStatus"));
            Assert.AreEqual("Running", updated.GetString("RuntimeStatus"));
        }

        [TestMethod]
        public async Task ReplacingAStaleEntityIsRejected()
        {
            // Arrange

            string instanceId = "my-instance";
            await this._instances.UpsertEntityAsync(new TableEntity(instanceId, string.Empty)
            {
                ["RuntimeStatus"] = "Running"
            });

            var stale = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);
            var fresh = await this._tableClient.GetEntityAsync(this.InstancesTable, instanceId, string.Empty);

            fresh["RuntimeStatus"] = "Completed";
            await this._tableClient.ReplaceEntityAsync(this.InstancesTable, fresh);

            // Act / Assert

            // The legacy TableOperation.Replace carried the entity's ETag, so a concurrent update
            // lost rather than silently overwriting. That has to keep holding.
            stale["RuntimeStatus"] = "Failed";
            var ex = await Assert.ThrowsExactlyAsync<RequestFailedException>(
                () => this._tableClient.ReplaceEntityAsync(this.InstancesTable, stale));

            Assert.AreEqual(412, ex.Status);
        }

        [TestMethod]
        public async Task MapsAHistoryRowIntoAHistoryEntity()
        {
            // Arrange

            var eventTime = DateTimeOffset.UtcNow.AddMinutes(-4);
            string instanceId = "my-instance";

            await this._history.UpsertEntityAsync(new TableEntity(instanceId, "0000000002")
            {
                ["InstanceId"] = instanceId,
                ["ExecutionId"] = "exec-1",
                ["EventType"] = "TaskCompleted",
                ["Name"] = "MyActivity",
                // The Durable Task Framework's own column, alongside the system-managed Timestamp
                ["_Timestamp"] = eventTime,
                ["Result"] = "42",
                ["TaskScheduledId"] = 7,
                ["EventId"] = 3
            });

            // Act

            var rows = await this._tableClient.GetAllAsync(this.HistoryTable, null);
            var historyEntity = HistoryEntity.From(rows.Single());

            // Assert

            Assert.AreEqual(instanceId, historyEntity.InstanceId);
            Assert.AreEqual("TaskCompleted", historyEntity.EventType);
            Assert.AreEqual("MyActivity", historyEntity.Name);
            Assert.AreEqual("42", historyEntity.Result);
            Assert.AreEqual(7, historyEntity.TaskScheduledId);
            Assert.AreEqual(3, historyEntity.EventId);

            // Round-tripping through Table Storage loses sub-millisecond precision
            Assert.IsTrue(
                Math.Abs((historyEntity._Timestamp - eventTime).TotalSeconds) < 1,
                $"_Timestamp came back as {historyEntity._Timestamp:O}, expected around {eventTime:O}");
        }

        [TestMethod]
        public async Task CapsTheScanAndReportsTruncation()
        {
            // Arrange

            // The bounded scan the aggregation endpoints are built on: read at most maxRows rows and
            // say so when the hub held more. Table Storage has no server-side count, so this cap is
            // the only thing standing between a big hub and an unbounded scan.
            const int rowCount = 25;
            await this.SeedInstancesAsync(rowCount);

            // Act

            var result = await this._tableClient.QueryAsync(
                this.InstancesTable, null, new[] { "RuntimeStatus" }, 10, CancellationToken.None);

            // Assert

            Assert.AreEqual(10, result.rows.Count);
            Assert.IsTrue(result.truncated, "25 rows through a cap of 10 should report truncated");

            // The projection: RuntimeStatus was asked for, Name was not
            Assert.IsTrue(result.rows.All(r => r.GetString("RuntimeStatus") == "Running"));
            Assert.IsFalse(
                result.rows.Any(r => r.ContainsKey("Name")),
                "Name was not in the select list, so it should not come back");

            // ... and the keys always come back, because every aggregation identifies its rows by them
            Assert.IsTrue(result.rows.All(r => !string.IsNullOrEmpty(r.PartitionKey)));
        }

        [TestMethod]
        public async Task DoesNotReportTruncationWhenTheRowCountEqualsTheCap()
        {
            // Arrange

            // Exactly at the cap is a complete result, not a partial one. This is the off-by-one the
            // extra row that QueryAsync reads is there to get right.
            await this.SeedInstancesAsync(10);

            // Act

            var result = await this._tableClient.QueryAsync(
                this.InstancesTable, null, null, 10, CancellationToken.None);

            // Assert

            Assert.AreEqual(10, result.rows.Count);
            Assert.IsFalse(result.truncated);
        }

        [TestMethod]
        public async Task AppliesTheFilterToTheCappedScan()
        {
            // Arrange

            await this.SeedInstancesAsync(5);
            await this._instances.UpsertEntityAsync(new TableEntity("failed-instance", string.Empty)
            {
                ["Name"] = "MyOrchestration",
                ["RuntimeStatus"] = "Failed"
            });

            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter($"RuntimeStatus eq {"Failed"}");

            // Act

            var result = await this._tableClient.QueryAsync(
                this.InstancesTable, filter, new[] { "RuntimeStatus" }, 100, CancellationToken.None);

            // Assert

            Assert.AreEqual(1, result.rows.Count);
            Assert.IsFalse(result.truncated);
            Assert.AreEqual("failed-instance", result.rows.Single().PartitionKey);
        }

        [TestMethod]
        public async Task PagesThroughMoreRowsThanOnePageHoldsWhenTheCapIsHigher()
        {
            // Arrange

            // A cap above the 1000-entity page limit has to keep following continuation tokens
            const int rowCount = 1100;

            var batch = new List<TableTransactionAction>();
            for (int i = 0; i < rowCount; i++)
            {
                batch.Add(new TableTransactionAction(
                    TableTransactionActionType.UpsertReplace,
                    new TableEntity("big-instance", i.ToString("D10")) { ["EventType"] = "TimerFired" }));

                // Table transactions are capped at 100 entities
                if (batch.Count == 100)
                {
                    await this._history.SubmitTransactionAsync(batch);
                    batch.Clear();
                }
            }
            if (batch.Count > 0)
            {
                await this._history.SubmitTransactionAsync(batch);
            }

            // Act

            var result = await this._tableClient.QueryAsync(
                this.HistoryTable, null, new[] { "EventType" }, 50000, CancellationToken.None);

            // Assert

            Assert.AreEqual(rowCount, result.rows.Count);
            Assert.IsFalse(result.truncated);
        }

        private async Task SeedInstancesAsync(int count)
        {
            for (int i = 0; i < count; i++)
            {
                await this._instances.UpsertEntityAsync(new TableEntity($"instance-{i:D3}", string.Empty)
                {
                    ["Name"] = "MyOrchestration",
                    ["RuntimeStatus"] = "Running",
                    ["CreatedTime"] = DateTimeOffset.UtcNow,
                    ["LastUpdatedTime"] = DateTimeOffset.UtcNow
                });
            }
        }

        private Task AddHistoryAsync(string instanceId, string executionId, string rowKey, string eventType, int? taskScheduledId)
        {
            var entity = new TableEntity(instanceId, rowKey)
            {
                ["InstanceId"] = instanceId,
                ["ExecutionId"] = executionId,
                ["EventType"] = eventType,
                ["_Timestamp"] = DateTimeOffset.UtcNow
            };

            if (taskScheduledId.HasValue)
            {
                entity["TaskScheduledId"] = taskScheduledId.Value;
            }

            return this._history.UpsertEntityAsync(entity);
        }

        private string InstancesTable => this._hubName + "Instances";
        private string HistoryTable => this._hubName + "History";

        private const string ConnStringName = "AzureWebJobsStorage";

        private string _hubName;
        private TableServiceClient _service;
        private Azure.Data.Tables.TableClient _instances;
        private Azure.Data.Tables.TableClient _history;
        private ITableClient _tableClient;
    }
}
