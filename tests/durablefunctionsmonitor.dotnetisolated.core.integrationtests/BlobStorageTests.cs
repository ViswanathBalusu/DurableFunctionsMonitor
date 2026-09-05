// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Storage.Blobs;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives the Azure.Storage.Blobs port against a real Blob endpoint - listing, downloading and
    /// the User-Agent stamping that ClientOptions.Diagnostics.ApplicationId could not carry.
    /// </summary>
    [TestClass]
    public class BlobStorageTests
    {
        [TestInitialize]
        public async Task TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            // A container of our own per test, so a rerun never trips over the previous one
            this._containerName = "dfmtest-" + Guid.NewGuid().ToString("N").Substring(0, 12);

            this._container = new BlobServiceClient(StorageEmulator.ConnectionString)
                .GetBlobContainerClient(this._containerName);

            await this._container.CreateIfNotExistsAsync();
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            if (this._container != null)
            {
                await this._container.DeleteIfExistsAsync();
            }

            TableClient.CustomUserAgent = null;
        }

        [TestMethod]
        public async Task ListsBlobNamesUnderAPrefix()
        {
            // Arrange

            await this.UploadAsync("tab-templates/MyTab.MyEntity.liquid", "hello template");
            await this.UploadAsync("tab-templates/Other.liquid", "other");
            await this.UploadAsync("function-maps/dfm-func-map.MyHub.json", "{}");

            var container = Globals.GetBlobServiceClient(ConnStringName).GetBlobContainerClient(this._containerName);

            // Act

            var tabTemplates = await container.ListBlobNamesAsync("tab-templates/");
            var functionMaps = await container.ListBlobNamesAsync("function-maps/");

            // Assert

            CollectionAssert.AreEquivalent(
                new[] { "tab-templates/MyTab.MyEntity.liquid", "tab-templates/Other.liquid" },
                tabTemplates.ToList());

            CollectionAssert.AreEquivalent(
                new[] { "function-maps/dfm-func-map.MyHub.json" },
                functionMaps.ToList());
        }

        [TestMethod]
        public async Task ListsMoreBlobsThanOnePageReturns()
        {
            // Arrange

            // Blob listing pages at 5000 by default, so ask for a smaller page explicitly is not
            // possible through our helper - instead rely on the helper draining the AsyncPageable.
            // 120 blobs is enough to prove the enumeration is not truncated to a single response.
            const int blobCount = 120;
            for (int i = 0; i < blobCount; i++)
            {
                await this.UploadAsync($"many/{i:D4}.liquid", "x");
            }

            var container = Globals.GetBlobServiceClient(ConnStringName).GetBlobContainerClient(this._containerName);

            // Act

            var names = await container.ListBlobNamesAsync("many/");

            // Assert

            Assert.AreEqual(blobCount, names.Count());
        }

        [TestMethod]
        public async Task DownloadsBlobContent()
        {
            // Arrange

            await this.UploadAsync("tab-templates/Other.liquid", "other");

            var container = Globals.GetBlobServiceClient(ConnStringName).GetBlobContainerClient(this._containerName);

            // Act

            using (var stream = new MemoryStream())
            {
                await container.GetBlobClient("tab-templates/Other.liquid").DownloadToAsync(stream);

                // Assert

                Assert.AreEqual("other", Encoding.UTF8.GetString(stream.ToArray()));
            }
        }

        [TestMethod]
        public async Task ReportsAMissingBlobAsNotExisting()
        {
            var container = Globals.GetBlobServiceClient(ConnStringName).GetBlobContainerClient(this._containerName);

            Assert.IsFalse(await container.GetBlobClient("no-such-blob.liquid").ExistsAsync());
        }

        [TestMethod]
        public async Task SplitsARealBlobUrlBackIntoItsContainerAndName()
        {
            // Arrange

            // A blob name that has to survive percent-encoding in the URL and back
            const string blobName = "big/name with spaces.gz";
            await this.UploadAsync(blobName, "spaced");

            var blobService = Globals.GetBlobServiceClient(ConnStringName);
            string blobUrl = this._container.GetBlobClient(blobName).Uri.ToString();

            // Act

            // This is what the large-payload download endpoint does with the URL it finds in the
            // orchestration status
            LargeMessageBlobs.CheckBlobUrl(blobUrl, blobService.Uri);
            var (containerName, parsedBlobName) = LargeMessageBlobs.SplitBlobUrl(blobService.Uri, blobUrl);

            // Assert

            Assert.AreEqual(this._containerName, containerName);
            Assert.AreEqual(blobName, parsedBlobName);

            using (var stream = new MemoryStream())
            {
                await blobService.GetBlobContainerClient(containerName).GetBlobClient(parsedBlobName).DownloadToAsync(stream);
                Assert.AreEqual("spaced", Encoding.UTF8.GetString(stream.ToArray()));
            }
        }

        [TestMethod]
        public async Task StampsDfMonsIdentifierOntoTheUserAgent()
        {
            // Arrange

            // Longer than the 24 characters ClientOptions.Diagnostics.ApplicationId accepts before
            // throwing while building the pipeline, which is why this goes through a policy instead
            TableClient.CustomUserAgent = "DurableFunctionsMonitorIsolated-Standalone/9.9.9";

            var capturing = new CapturingTransport();
            var options = new BlobClientOptions { Transport = capturing };
            Globals.ApplyCustomUserAgent(options);

            // Act

            var client = new BlobServiceClient(StorageEmulator.ConnectionString, options);
            await client.GetBlobContainerClient(this._containerName).GetBlobClient("anything").ExistsAsync();

            // Assert

            Assert.IsNotNull(capturing.CapturedUserAgent);
            Assert.IsTrue(
                capturing.CapturedUserAgent.StartsWith(TableClient.CustomUserAgent),
                $"User-Agent was '{capturing.CapturedUserAgent}'");

            // The SDK's own token has to survive too - it is what Azure Storage support looks at
            Assert.IsTrue(
                capturing.CapturedUserAgent.Contains("azsdk-net-Storage.Blobs"),
                $"User-Agent was '{capturing.CapturedUserAgent}'");
        }

        [TestMethod]
        public async Task LeavesTheUserAgentAloneWhenNoIdentifierIsConfigured()
        {
            // Arrange

            TableClient.CustomUserAgent = null;

            var capturing = new CapturingTransport();
            var options = new BlobClientOptions { Transport = capturing };
            Globals.ApplyCustomUserAgent(options);

            // Act

            var client = new BlobServiceClient(StorageEmulator.ConnectionString, options);
            await client.GetBlobContainerClient(this._containerName).GetBlobClient("anything").ExistsAsync();

            // Assert

            Assert.IsTrue(
                capturing.CapturedUserAgent.StartsWith("azsdk-net-Storage.Blobs"),
                $"User-Agent was '{capturing.CapturedUserAgent}'");
        }

        private Task UploadAsync(string blobName, string content)
        {
            return this._container.GetBlobClient(blobName)
                .UploadAsync(new MemoryStream(Encoding.UTF8.GetBytes(content)), overwrite: true);
        }

        /// <summary>
        /// Passes requests through untouched, remembering the User-Agent the pipeline produced.
        /// </summary>
        private class CapturingTransport : HttpPipelineTransport
        {
            public string CapturedUserAgent;

            public override Request CreateRequest() => this._inner.CreateRequest();

            public override void Process(HttpMessage message)
            {
                this.Capture(message);
                this._inner.Process(message);
            }

            public override ValueTask ProcessAsync(HttpMessage message)
            {
                this.Capture(message);
                return this._inner.ProcessAsync(message);
            }

            private void Capture(HttpMessage message)
                => message.Request.Headers.TryGetValue("User-Agent", out this.CapturedUserAgent);

            private readonly HttpPipelineTransport _inner = new HttpClientTransport();
        }

        private const string ConnStringName = "AzureWebJobsStorage";

        private string _containerName;
        private BlobContainerClient _container;
    }
}
