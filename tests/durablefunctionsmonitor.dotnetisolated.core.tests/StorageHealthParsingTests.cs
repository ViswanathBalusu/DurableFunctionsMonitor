// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The pure half of the /storage routine: the names it derives from a Task Hub name, and the parsing of
    /// the three shapes it reads from storage - taskhub.json, a row of the '{hub}Partitions' table and a
    /// lease blob's metadata.
    ///
    /// The captured shapes below are those of DurableTask.AzureStorage (TaskHubInfo and TableLease). They
    /// are another library's storage detail, not a contract, so should that library rename a column this
    /// test fails here instead of the Storage screen quietly showing every partition as unowned.
    /// </summary>
    [TestClass]
    public class StorageHealthParsingTests
    {
        [TestMethod]
        public void DerivesTheContainerAndQueueNamesFromTheHubName()
        {
            // Storage names are lower case; the hub name keeps its own casing everywhere else
            Assert.AreEqual("durablefunctionshub-leases", StorageHealth.GetLeasesContainerName("DurableFunctionsHub"));
            Assert.AreEqual("durablefunctionshub-workitems", StorageHealth.GetWorkItemQueueName("DurableFunctionsHub"));
            Assert.AreEqual("durablefunctionshub-control-00", StorageHealth.GetControlQueueName("DurableFunctionsHub", 0));

            // Two digits, so control-10 sorts after control-09 both in storage and on the screen
            Assert.AreEqual("durablefunctionshub-control-09", StorageHealth.GetControlQueueName("DurableFunctionsHub", 9));
            Assert.AreEqual("durablefunctionshub-control-10", StorageHealth.GetControlQueueName("DurableFunctionsHub", 10));
        }

        [TestMethod]
        public void ParsesACapturedTaskHubJson()
        {
            // Arrange: the blob DurableTask.AzureStorage writes when it creates a Task Hub

            const string Json = @"{""TaskHubName"":""DurableFunctionsHub"",""CreatedAt"":""2026-09-01T08:30:00Z"",""PartitionCount"":4}";

            // Act

            var result = StorageHealth.ParseTaskHubInfo("DurableFunctionsHub", Json);

            // Assert

            Assert.AreEqual("DurableFunctionsHub", result.Name);
            Assert.AreEqual(4, result.PartitionCount);
            Assert.AreEqual(new DateTimeOffset(2026, 9, 1, 8, 30, 0, TimeSpan.Zero), result.CreatedAt);
            Assert.AreEqual(StorageHealth.TaskHubSourceTaskHubJson, result.Source);
        }

        [TestMethod]
        public void AMissingTaskHubJsonIsSourceUnknownAndAnUnknownPartitionCount()
        {
            // Act

            var result = StorageHealth.ParseTaskHubInfo("DurableFunctionsHub", null);

            // Assert: 'not known', never a made-up 4 (the queue list falls back to 4 separately, and says so)

            Assert.IsNull(result.PartitionCount);
            Assert.IsNull(result.CreatedAt);
            Assert.AreEqual(StorageHealth.TaskHubSourceUnknown, result.Source);
        }

        [TestMethod]
        public void AMalformedTaskHubJsonDegradesInsteadOfThrowing()
        {
            // Act

            var result = StorageHealth.ParseTaskHubInfo("DurableFunctionsHub", "{ not json");

            // Assert

            Assert.IsNull(result.PartitionCount);
            Assert.AreEqual(StorageHealth.TaskHubSourceUnknown, result.Source);
        }

        [TestMethod]
        public void ATaskHubJsonWithoutThePartitionCountStillCountsAsRead()
        {
            // Act

            var result = StorageHealth.ParseTaskHubInfo("DurableFunctionsHub", @"{""TaskHubName"":""DurableFunctionsHub""}");

            // Assert: the document was there and was read, it just did not say how many partitions there are

            Assert.AreEqual(StorageHealth.TaskHubSourceTaskHubJson, result.Source);
            Assert.IsNull(result.PartitionCount);
            Assert.IsNull(result.CreatedAt);
        }

        [TestMethod]
        public void ReadsAPartitionCountAndCreatedAtWrittenAsStrings()
        {
            // Arrange: nothing promises the CLR types another library serializes with

            const string Json = @"{""CreatedAt"":""2026-09-01T08:30:00+02:00"",""partitioncount"":""8""}";

            // Act

            var result = StorageHealth.ParseTaskHubInfo("DurableFunctionsHub", Json);

            // Assert: property lookup is case-insensitive and the offset is converted to UTC

            Assert.AreEqual(8, result.PartitionCount);
            Assert.AreEqual(new DateTimeOffset(2026, 9, 1, 6, 30, 0, TimeSpan.Zero), result.CreatedAt);
        }

        [TestMethod]
        public void ListsTheWorkItemQueueFirstAndThenOneControlQueuePerPartition()
        {
            // Act

            var queues = StorageHealth.BuildQueueList("DurableFunctionsHub", 4);

            // Assert

            Assert.AreEqual(5, queues.Count);

            Assert.AreEqual("durablefunctionshub-workitems", queues[0].Name);
            Assert.AreEqual(StorageHealth.QueueKindWorkItems, queues[0].Kind);
            Assert.IsNull(queues[0].Partition);

            CollectionAssert.AreEqual(
                new[]
                {
                    "durablefunctionshub-control-00",
                    "durablefunctionshub-control-01",
                    "durablefunctionshub-control-02",
                    "durablefunctionshub-control-03"
                },
                queues.Skip(1).Select(q => q.Name).ToArray());

            CollectionAssert.AreEqual(new int?[] { 0, 1, 2, 3 }, queues.Skip(1).Select(q => q.Partition).ToArray());
            Assert.IsTrue(queues.Skip(1).All(q => q.Kind == StorageHealth.QueueKindControl));

            // Counts are the caller's job; the list itself says nothing about depth
            Assert.IsTrue(queues.All(q => q.ApproximateMessageCount == null));
        }

        [TestMethod]
        public void FallsBackToFourControlQueuesWhenThePartitionCountIsUnknown()
        {
            // Act

            var queues = StorageHealth.BuildQueueList("DurableFunctionsHub", null);

            // Assert: the framework's own default, which is what the overwhelming majority of hubs run with

            Assert.AreEqual(1 + StorageHealth.DefaultPartitionCount, queues.Count);
        }

        [TestMethod]
        public void ParsesACapturedTableLeaseRow()
        {
            // Arrange: a row of '{hub}Partitions', as the table partition manager writes it

            var row = new TableEntity("DurableFunctionsHub", "durablefunctionshub-control-01")
            {
                ["CurrentOwner"] = "worker-a",
                ["NextOwner"] = "worker-b",
                ["OwnedSince"] = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero),
                ["IsDraining"] = true
            };

            // Act

            var result = StorageHealth.ParsePartitionRow(row);

            // Assert

            Assert.AreEqual("durablefunctionshub-control-01", result.Name);
            Assert.AreEqual("worker-a", result.Owner);
            Assert.AreEqual("worker-b", result.NextOwner);
            Assert.AreEqual(new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero), result.OwnedSince);
            Assert.IsTrue(result.IsDraining.Value);
            Assert.AreEqual(StorageHealth.PartitionSourceTable, result.Source);
        }

        [TestMethod]
        public void AnUnownedPartitionRowReadsAsUnowned()
        {
            // Arrange: the framework empties the owner columns rather than deleting the row

            var row = new TableEntity("DurableFunctionsHub", "durablefunctionshub-control-02")
            {
                ["CurrentOwner"] = string.Empty,
                ["NextOwner"] = string.Empty,
                ["IsDraining"] = false
            };

            // Act

            var result = StorageHealth.ParsePartitionRow(row);

            // Assert: an empty string is not an owner

            Assert.IsNull(result.Owner);
            Assert.IsNull(result.NextOwner);
            Assert.IsNull(result.OwnedSince);
            Assert.IsFalse(result.IsDraining.Value);
        }

        [TestMethod]
        public void PartitionColumnsAreReadCaseInsensitivelyAndAcrossClrTypes()
        {
            // Arrange: the same row written with different casing, a string date and a string bool

            var row = new TableEntity("DurableFunctionsHub", "durablefunctionshub-control-03")
            {
                ["currentowner"] = "worker-c",
                ["ownedsince"] = "2026-09-04T12:00:00Z",
                ["isdraining"] = "true"
            };

            // Act

            var result = StorageHealth.ParsePartitionRow(row);

            // Assert

            Assert.AreEqual("worker-c", result.Owner);
            Assert.AreEqual(new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero), result.OwnedSince);
            Assert.IsTrue(result.IsDraining.Value);
        }

        [TestMethod]
        public void AReshapedPartitionRowDegradesToUnknownInsteadOfThrowing()
        {
            // Arrange: a row whose columns are all of the wrong type

            var row = new TableEntity("DurableFunctionsHub", "durablefunctionshub-control-00")
            {
                ["CurrentOwner"] = 42,
                ["OwnedSince"] = 7,
                ["IsDraining"] = 1
            };

            // Act

            var result = StorageHealth.ParsePartitionRow(row);

            // Assert

            Assert.IsNull(result.Owner);
            Assert.IsNull(result.OwnedSince);
            Assert.IsNull(result.IsDraining);
            Assert.AreEqual(StorageHealth.PartitionSourceTable, result.Source);
        }

        [TestMethod]
        public void ParsesALeaseBlobOfTheBlobPartitionManager()
        {
            // Arrange

            var metadata = new Dictionary<string, string> { { "owner", "worker-a" } };
            var lastModified = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);

            // Act

            var result = StorageHealth.ParseLeaseBlob("durablefunctionshub-control-01", metadata, lastModified);

            // Assert

            Assert.AreEqual("durablefunctionshub-control-01", result.Name);
            Assert.AreEqual("worker-a", result.Owner);
            Assert.AreEqual(lastModified, result.OwnedSince);
            Assert.AreEqual(StorageHealth.PartitionSourceLeaseBlob, result.Source);

            // A lease blob cannot express either of these
            Assert.IsNull(result.IsDraining);
            Assert.IsNull(result.NextOwner);
        }

        [TestMethod]
        public void ALeaseBlobWithoutOwnerMetadataReadsAsUnowned()
        {
            // Act

            var result = StorageHealth.ParseLeaseBlob("durablefunctionshub-control-01", new Dictionary<string, string>(), null);

            // Assert

            Assert.IsNull(result.Owner);
            Assert.IsNull(result.OwnedSince);
            Assert.AreEqual(StorageHealth.PartitionSourceLeaseBlob, result.Source);
        }

        [TestMethod]
        public void APartitionNothingIsKnownAboutStillHasItsName()
        {
            // Act

            var result = StorageHealth.UnknownPartition("DurableFunctionsHub", 2);

            // Assert: the row is shown and says 'unknown', rather than being dropped

            Assert.AreEqual("durablefunctionshub-control-02", result.Name);
            Assert.IsNull(result.Owner);
            Assert.AreEqual(StorageHealth.PartitionSourceNone, result.Source);
        }
    }
}
