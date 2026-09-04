// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using DurableFunctionsMonitor.DotNetIsolated;
using System;
using Azure.Data.Tables;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// Covers the storage-facing logic that does not need a Storage account: the XXXHistory row
    /// mapping and the blob URL checks that guard the large-payload download endpoint.
    /// </summary>
    [TestClass]
    public class StorageTests
    {
        [TestMethod]
        public void MapsHistoryEntityFromTableEntity()
        {
            // Arrange

            var eventTime = new DateTimeOffset(2024, 5, 6, 7, 8, 9, TimeSpan.Zero);

            var entity = new TableEntity("my-instance-id", "0000000002")
            {
                ["InstanceId"] = "my-instance-id",
                ["EventType"] = "TaskCompleted",
                ["Name"] = "MyActivity",
                // NOTE: the Durable Task Framework writes its own _Timestamp column, distinct
                // from the system-managed Timestamp
                ["_Timestamp"] = eventTime,
                ["Input"] = "{\"a\":1}",
                ["Result"] = "42",
                ["TaskScheduledId"] = 7,
                ["EventId"] = 3
            };

            // Act

            var historyEntity = HistoryEntity.From(entity);

            // Assert

            Assert.AreEqual("my-instance-id", historyEntity.InstanceId);
            Assert.AreEqual("TaskCompleted", historyEntity.EventType);
            Assert.AreEqual("MyActivity", historyEntity.Name);
            Assert.AreEqual(eventTime, historyEntity._Timestamp);
            Assert.AreEqual("{\"a\":1}", historyEntity.Input);
            Assert.AreEqual("42", historyEntity.Result);
            Assert.AreEqual(7, historyEntity.TaskScheduledId);
            Assert.AreEqual(3, historyEntity.EventId);
        }

        [TestMethod]
        public void MapsHistoryEntityWithMissingColumns()
        {
            // Arrange

            // Most XXXHistory columns are only present on some event types
            var entity = new TableEntity("my-instance-id", "0000000001")
            {
                ["EventType"] = "ExecutionStarted"
            };

            // Act

            var historyEntity = HistoryEntity.From(entity);

            // Assert

            Assert.AreEqual("ExecutionStarted", historyEntity.EventType);
            Assert.IsNull(historyEntity.Name);
            Assert.IsNull(historyEntity.Input);
            Assert.IsNull(historyEntity.Result);
            Assert.IsNull(historyEntity.Details);
            Assert.IsNull(historyEntity.FailureDetails);

            // TaskScheduledId is nullable and must stay null, since it is used to correlate events
            Assert.IsNull(historyEntity.TaskScheduledId);

            Assert.AreEqual(default(DateTimeOffset), historyEntity._Timestamp);
            Assert.AreEqual(0, historyEntity.EventId);
        }

        [TestMethod]
        [DataRow("https://myacct.blob.core.windows.net/", "https://myacct.blob.core.windows.net/big/payload.gz", DisplayName = "our own account")]
        [DataRow("https://myacct.blob.core.windows.net", "https://myacct.blob.core.windows.net/big/payload.gz", DisplayName = "service Uri without a trailing slash")]
        [DataRow("https://myacct.blob.core.windows.net/", "https://myacct-secondary.blob.core.windows.net/big/payload.gz", DisplayName = "RA-GRS secondary endpoint")]
        [DataRow("http://127.0.0.1:10000/devstoreaccount1", "http://127.0.0.1:10000/devstoreaccount1/big/payload.gz", DisplayName = "storage emulator")]
        public void AcceptsOurOwnBlobUrls(string blobServiceUri, string blobUrl)
        {
            Orchestration.CheckBlobUrl(blobUrl, new Uri(blobServiceUri));
        }

        [TestMethod]
        [DataRow("https://myacct.blob.core.windows.net/", "https://evil.blob.core.windows.net/big/payload.gz", DisplayName = "a different account")]
        [DataRow("https://myacct.blob.core.windows.net/", "https://myacctevil.blob.core.windows.net/big/payload.gz", DisplayName = "an account name with our name as its prefix")]
        [DataRow("https://myacct.blob.core.windows.net/", "https://myacct.blob.core.windows.net.evil.com/big/payload.gz", DisplayName = "a look-alike domain suffix")]
        [DataRow("https://myacct.blob.core.windows.net", "https://myacct.blob.core.windows.net.evil.com/big/payload.gz", DisplayName = "a look-alike domain suffix, service Uri without a trailing slash")]
        [DataRow("https://myacct.blob.core.windows.net/", "https://myacct-secondary.blob.core.windows.net.evil.com/big/payload.gz", DisplayName = "a look-alike suffix on the secondary endpoint")]
        [DataRow("http://127.0.0.1:10000/devstoreaccount1", "http://127.0.0.1:10000/devstoreaccount1evil/big/payload.gz", DisplayName = "an emulator account with our name as its prefix")]
        public void RejectsForeignBlobUrls(string blobServiceUri, string blobUrl)
        {
            Assert.ThrowsExactly<NotSupportedException>(() => Orchestration.CheckBlobUrl(blobUrl, new Uri(blobServiceUri)));
        }

        [TestMethod]
        public void SplitsBlobUrlIntoContainerAndBlobName()
        {
            var serviceUri = new Uri("https://myacct.blob.core.windows.net/");

            var (containerName, blobName) = Orchestration.SplitBlobUrl(serviceUri, "https://myacct.blob.core.windows.net/bigcontainer/some/nested/payload.gz");

            Assert.AreEqual("bigcontainer", containerName);
            Assert.AreEqual("some/nested/payload.gz", blobName);
        }

        [TestMethod]
        public void SplitsBlobUrlWhenTheAccountIsInThePath()
        {
            // The storage emulator puts the account name in the path rather than the host
            var serviceUri = new Uri("http://127.0.0.1:10000/devstoreaccount1");

            var (containerName, blobName) = Orchestration.SplitBlobUrl(serviceUri, "http://127.0.0.1:10000/devstoreaccount1/bigcontainer/payload.gz");

            Assert.AreEqual("bigcontainer", containerName);
            Assert.AreEqual("payload.gz", blobName);
        }

        [TestMethod]
        public void SplitsBlobUrlAndDecodesTheBlobName()
        {
            var serviceUri = new Uri("https://myacct.blob.core.windows.net/");

            var (containerName, blobName) = Orchestration.SplitBlobUrl(serviceUri, "https://myacct.blob.core.windows.net/bigcontainer/name%20with%20spaces.gz");

            Assert.AreEqual("bigcontainer", containerName);
            Assert.AreEqual("name with spaces.gz", blobName);
        }

        [TestMethod]
        public void ThrowsWhenBlobUrlHasNoContainer()
        {
            var serviceUri = new Uri("https://myacct.blob.core.windows.net/");

            Assert.ThrowsExactly<NotSupportedException>(() => Orchestration.SplitBlobUrl(serviceUri, "https://myacct.blob.core.windows.net/loose-blob"));
        }

        [TestMethod]
        public void DerivesTheSecondaryBlobServiceUri()
        {
            var secondaryUri = Globals.GetSecondaryBlobServiceUri(new Uri("https://myacct.blob.core.windows.net/"));

            Assert.AreEqual("myacct-secondary.blob.core.windows.net", secondaryUri.Host);
        }

        [TestMethod]
        public void DerivesNoSecondaryBlobServiceUriForAnIpHost()
        {
            // The emulator has no secondary endpoint, and its host is an IP address rather than
            // "<account>.blob.<suffix>", so there is nothing to insert "-secondary" into
            Assert.IsNull(Globals.GetSecondaryBlobServiceUri(new Uri("http://127.0.0.1:10000/devstoreaccount1")));
        }
    }
}
