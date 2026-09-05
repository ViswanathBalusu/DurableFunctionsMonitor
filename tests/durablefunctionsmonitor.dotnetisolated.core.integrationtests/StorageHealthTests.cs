// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using Azure.Storage.Blobs;
using Azure.Storage.Queues;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives StorageHealth.GetAsync - everything GET /storage reports - against a real Storage endpoint,
    /// on the layout DurableTask.AzureStorage creates for a Task Hub: a '{hub lower}-leases' container with
    /// taskhub.json, the work-item and control queues, a '{hub}Partitions' table and the large-message
    /// container.
    ///
    /// The parsing rules themselves are unit tested in StorageHealthParsingTests; what is proved here is
    /// the storage half - that the right names are read, that missing pieces degrade to nulls instead of
    /// failing the whole call, and that the row counts are only produced when they were asked for.
    /// </summary>
    [TestClass]
    public class StorageHealthTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmStorage" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._tableService = new TableServiceClient(StorageEmulator.ConnectionString);
            this._blobService = new BlobServiceClient(StorageEmulator.ConnectionString);
            this._queueService = new QueueServiceClient(StorageEmulator.ConnectionString);

            this._now = DateTimeOffset.UtcNow;
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            // Every test seeds a different subset of the hub, and TestInit gives up before creating the
            // clients when there is no emulator - so each of these is best effort.
            if (this._tableService == null)
            {
                return;
            }

            foreach (string table in new[] { this.InstancesTable, this.HistoryTable, this.PartitionsTable })
            {
                await IgnoringFailures(() => this._tableService.DeleteTableAsync(table));
            }

            foreach (string container in new[] { this.LeasesContainer, this.LargeMessagesContainer })
            {
                await IgnoringFailures(() => this._blobService.DeleteBlobContainerAsync(container));
            }

            foreach (var queue in this.QueueNames)
            {
                await IgnoringFailures(() => this._queueService.DeleteQueueAsync(queue));
            }
        }

        private static async Task IgnoringFailures(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch (Azure.RequestFailedException)
            {
                // It was never created by this test
            }
        }

        [TestMethod]
        public async Task ReportsTheSeededHubInTheStorageResponse()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act

            // Going through the extension point, so that the wiring of the Azure Storage default is covered too
            var result = await new DfmExtensionPoints().GetStorageHealthRoutine(
                ConnStringName, this._hubName, false, null, CancellationToken.None);

            // Assert

            // taskhub.json is the source of the partition count, and it is read, not guessed
            Assert.AreEqual(this._hubName, result.TaskHub.Name);
            Assert.AreEqual(4, result.TaskHub.PartitionCount);
            Assert.AreEqual(StorageHealth.TaskHubSourceTaskHubJson, result.TaskHub.Source);
            Assert.IsNotNull(result.TaskHub.CreatedAt);

            // One work-item queue and one control queue per partition, in that order
            CollectionAssert.AreEqual(this.QueueNames.ToArray(), result.Queues.Select(q => q.Name).ToArray());
            Assert.AreEqual(2, result.Queues.Single(q => q.Kind == StorageHealth.QueueKindWorkItems).ApproximateMessageCount);
            Assert.AreEqual(1, result.Queues.Single(q => q.Name == this.ControlQueue(0)).ApproximateMessageCount);
            Assert.AreEqual(0, result.Queues.Single(q => q.Name == this.ControlQueue(1)).ApproximateMessageCount);

            // Partitions come from the table, which is the only source that knows about draining
            Assert.AreEqual(4, result.Partitions.Count);
            Assert.IsTrue(result.Partitions.All(p => p.Source == StorageHealth.PartitionSourceTable));

            var first = result.Partitions.First();
            Assert.AreEqual(this.ControlQueue(0), first.Name);
            Assert.AreEqual("worker-a", first.Owner);
            Assert.IsNotNull(first.OwnedSince);
            Assert.IsFalse(first.IsDraining.Value);

            var draining = result.Partitions.Single(p => p.Name == this.ControlQueue(3));
            Assert.AreEqual("worker-b", draining.Owner);
            Assert.AreEqual("worker-a", draining.NextOwner);
            Assert.IsTrue(draining.IsDraining.Value);

            // Tables: the two a hub cannot work without are always named; the optional ones only when they exist
            Assert.AreEqual(this.InstancesTable, result.Tables.Instances);
            Assert.AreEqual(this.HistoryTable, result.Tables.History);
            Assert.AreEqual(this.PartitionsTable, result.Tables.Partitions);
            Assert.IsNull(result.Tables.Audit, "no audit table was created");

            // The large-message container exists, but without an instance nothing is counted
            Assert.AreEqual(this.LargeMessagesContainer, result.LargeMessages.Container);
            Assert.IsTrue(result.LargeMessages.Exists);
            Assert.IsNull(result.LargeMessages.BlobCount);
            Assert.IsNull(result.LargeMessages.TotalBytes);

            // counts: false, so the two scans never ran
            Assert.IsNull(result.Counts.InstancesRows);
            Assert.IsNull(result.Counts.HistoryRows);
            Assert.IsFalse(result.Counts.Partial);

            Assert.IsFalse(result.Cached);
            Assert.IsTrue(result.ElapsedMs >= 0);
        }

        [TestMethod]
        public async Task CountsTheRowsOfBothTablesWhenAsked()
        {
            // Arrange

            await this.SeedTheHubAsync();

            // Act

            var result = await StorageHealth.GetAsync(ConnStringName, this._hubName, true, null, CancellationToken.None);

            // Assert

            Assert.AreEqual(3, result.Counts.InstancesRows);
            Assert.AreEqual(5, result.Counts.HistoryRows);
            Assert.IsFalse(result.Counts.Partial);
        }

        [TestMethod]
        public async Task CountsTheLargeMessageBlobsOfOneInstanceOnly()
        {
            // Arrange

            await this.SeedTheHubAsync();

            var container = this._blobService.GetBlobContainerClient(this.LargeMessagesContainer);
            await container.UploadBlobAsync("instance-1/Input.json.gz", BinaryDataOf(300));
            await container.UploadBlobAsync("instance-1/Output.json.gz", BinaryDataOf(200));
            await container.UploadBlobAsync("instance-2/Input.json.gz", BinaryDataOf(999));

            // Act

            var result = await StorageHealth.GetAsync(ConnStringName, this._hubName, false, "instance-1", CancellationToken.None);

            // Assert: the '{instanceId}/' prefix bounds the listing to the one instance that was asked about

            Assert.IsTrue(result.LargeMessages.Exists);
            Assert.AreEqual(2, result.LargeMessages.BlobCount);
            Assert.AreEqual(500, result.LargeMessages.TotalBytes);
        }

        [TestMethod]
        public async Task FallsBackToTheLeaseBlobsWhenThereIsNoPartitionsTable()
        {
            // Arrange: a hub on the blob partition manager - lease blobs, no Partitions table

            await this.SeedTheHubAsync(withPartitionsTable: false);

            var leases = this._blobService.GetBlobContainerClient(this.LeasesContainer);
            for (int partition = 0; partition < 2; partition++)
            {
                var blob = leases.GetBlobClient(this.ControlQueue(partition));
                await blob.UploadAsync(BinaryDataOf(10));
                await blob.SetMetadataAsync(new System.Collections.Generic.Dictionary<string, string> { { "owner", $"worker-{partition}" } });
            }

            // Act

            var result = await StorageHealth.GetAsync(ConnStringName, this._hubName, false, null, CancellationToken.None);

            // Assert

            Assert.AreEqual(2, result.Partitions.Count);
            Assert.IsTrue(result.Partitions.All(p => p.Source == StorageHealth.PartitionSourceLeaseBlob));
            CollectionAssert.AreEqual(new[] { "worker-0", "worker-1" }, result.Partitions.Select(p => p.Owner).ToArray());
            Assert.IsTrue(result.Partitions.All(p => p.OwnedSince != null));

            // taskhub.json lives in the same container and is not a lease blob
            Assert.IsFalse(result.Partitions.Any(p => p.Name.EndsWith(StorageHealth.TaskHubBlobName)));

            Assert.IsNull(result.Tables.Partitions);
        }

        [TestMethod]
        public async Task ReportsUnknownPartitionsWhenThereIsNeitherATableNorLeaseBlobs()
        {
            // Arrange

            await this.SeedTheHubAsync(withPartitionsTable: false);

            // Act

            var result = await StorageHealth.GetAsync(ConnStringName, this._hubName, false, null, CancellationToken.None);

            // Assert: one row per partition, all of them explicit about knowing nothing

            Assert.AreEqual(4, result.Partitions.Count);
            Assert.IsTrue(result.Partitions.All(p => p.Source == StorageHealth.PartitionSourceNone));
            Assert.IsTrue(result.Partitions.All(p => p.Owner == null));
            CollectionAssert.AreEqual(
                Enumerable.Range(0, 4).Select(this.ControlQueue).ToArray(),
                result.Partitions.Select(p => p.Name).ToArray());
        }

        [TestMethod]
        public async Task AHubThatWasNeverStartedDegradesToNullsInsteadOfFailing()
        {
            // Act: nothing was created at all - no container, no queue, no table

            var result = await StorageHealth.GetAsync(ConnStringName, this._hubName, true, "instance-1", CancellationToken.None);

            // Assert

            Assert.IsNull(result.TaskHub.PartitionCount);
            Assert.AreEqual(StorageHealth.TaskHubSourceUnknown, result.TaskHub.Source);

            // The queue list is still the shape of a hub, with every depth unknown
            Assert.AreEqual(5, result.Queues.Count);
            Assert.IsTrue(result.Queues.All(q => q.ApproximateMessageCount == null));

            Assert.AreEqual(4, result.Partitions.Count);
            Assert.IsTrue(result.Partitions.All(p => p.Source == StorageHealth.PartitionSourceNone));

            // The two required tables are named even though they do not exist; the optional ones are not
            Assert.AreEqual(this.InstancesTable, result.Tables.Instances);
            Assert.IsNull(result.Tables.Partitions);

            Assert.IsFalse(result.LargeMessages.Exists);
            Assert.IsNull(result.LargeMessages.BlobCount);

            // 'unknown', not zero: a table that does not exist has no row count
            Assert.IsNull(result.Counts.InstancesRows);
            Assert.IsNull(result.Counts.HistoryRows);
        }

        #region Setup

        /// <summary>
        /// A hub as DurableTask.AzureStorage lays it out: taskhub.json with 4 partitions, the five queues
        /// (with a couple of messages in two of them), the Instances and History tables with a handful of
        /// rows, an owned-and-draining Partitions table and the large-message container.
        /// </summary>
        private async Task SeedTheHubAsync(bool withPartitionsTable = true)
        {
            await this._tableService.CreateTableIfNotExistsAsync(this.InstancesTable);
            await this._tableService.CreateTableIfNotExistsAsync(this.HistoryTable);

            var instances = this._tableService.GetTableClient(this.InstancesTable);
            for (int i = 0; i < 3; i++)
            {
                await instances.UpsertEntityAsync(new TableEntity($"instance-{i}", string.Empty)
                {
                    ["Name"] = "MyOrchestrator",
                    ["RuntimeStatus"] = "Completed",
                    ["CreatedTime"] = this._now.AddMinutes(-10),
                    ["LastUpdatedTime"] = this._now.AddMinutes(-9)
                });
            }

            var history = this._tableService.GetTableClient(this.HistoryTable);
            for (int i = 0; i < 5; i++)
            {
                await history.UpsertEntityAsync(new TableEntity("instance-0", i.ToString("X16"))
                {
                    ["EventType"] = "TaskCompleted",
                    ["_Timestamp"] = this._now.AddMinutes(-10)
                });
            }

            var leases = this._blobService.GetBlobContainerClient(this.LeasesContainer);
            await leases.CreateIfNotExistsAsync();
            await leases.UploadBlobAsync(
                StorageHealth.TaskHubBlobName,
                BinaryData.FromString($"{{\"TaskHubName\":\"{this._hubName}\",\"CreatedAt\":\"{this._now.AddDays(-1):o}\",\"PartitionCount\":4}}"));

            await this._blobService.CreateBlobContainerAsync(this.LargeMessagesContainer);

            foreach (var queueName in this.QueueNames)
            {
                await this._queueService.CreateQueueAsync(queueName);
            }

            // Two messages waiting for a worker, one orchestrator message on partition 0
            var workItems = this._queueService.GetQueueClient(this.WorkItemQueue);
            await workItems.SendMessageAsync("{}");
            await workItems.SendMessageAsync("{}");
            await this._queueService.GetQueueClient(this.ControlQueue(0)).SendMessageAsync("{}");

            if (!withPartitionsTable)
            {
                return;
            }

            await this._tableService.CreateTableIfNotExistsAsync(this.PartitionsTable);
            var partitions = this._tableService.GetTableClient(this.PartitionsTable);
            for (int partition = 0; partition < 4; partition++)
            {
                bool draining = partition == 3;

                await partitions.UpsertEntityAsync(new TableEntity(this._hubName, this.ControlQueue(partition))
                {
                    ["CurrentOwner"] = draining ? "worker-b" : "worker-a",
                    ["NextOwner"] = draining ? "worker-a" : string.Empty,
                    ["OwnedSince"] = this._now.AddMinutes(-30),
                    ["IsDraining"] = draining
                });
            }
        }

        private static BinaryData BinaryDataOf(int bytes)
        {
            return BinaryData.FromBytes(Encoding.ASCII.GetBytes(new string('x', bytes)));
        }

        private string ControlQueue(int partition) => $"{this._hubName.ToLowerInvariant()}-control-{partition:00}";

        private string WorkItemQueue => $"{this._hubName.ToLowerInvariant()}-workitems";

        private string[] QueueNames =>
            new[] { this.WorkItemQueue }.Concat(Enumerable.Range(0, 4).Select(this.ControlQueue)).ToArray();

        private string InstancesTable => this._hubName + "Instances";
        private string HistoryTable => this._hubName + "History";
        private string PartitionsTable => this._hubName + "Partitions";
        private string LeasesContainer => $"{this._hubName.ToLowerInvariant()}-leases";
        private string LargeMessagesContainer => $"{this._hubName.ToLowerInvariant()}-largemessages";

        private const string ConnStringName = "DFM_TEST_STORAGE_HEALTH_CONN_STRING";

        private string _hubName;
        private DateTimeOffset _now;
        private TableServiceClient _tableService;
        private BlobServiceClient _blobService;
        private QueueServiceClient _queueService;

        #endregion
    }
}
