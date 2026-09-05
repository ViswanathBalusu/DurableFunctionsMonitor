// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// Conditional GET (ETag / If-None-Match) on the orchestration details and history endpoints:
    /// the pure helper and each endpoint's 304-vs-200 branches.
    /// </summary>
    [TestClass]
    public class ConditionalGetTests
    {
        private const string InstanceId = "my-instance";
        private const string HubName = "TestHub";

        [TestInitialize]
        public void TestInit()
        {
            TableClient.MockedTableClient = null;
        }

        [TestMethod]
        public void ComputeETagIsBasedOnLastUpdatedAtAndRuntimeStatus()
        {
            var metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
            {
                RuntimeStatus = OrchestrationRuntimeStatus.Running,
                LastUpdatedAt = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero)
            };

            string etag = ConditionalGet.ComputeETag(metadata);

            Assert.AreEqual($"W/\"{metadata.LastUpdatedAt.UtcTicks}:Running\"", etag);
        }

        [TestMethod]
        public void ComputeETagChangesWhenRuntimeStatusChanges()
        {
            var lastUpdatedAt = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero);

            var running = new OrchestrationMetadata("MyOrchestrator", InstanceId) { RuntimeStatus = OrchestrationRuntimeStatus.Running, LastUpdatedAt = lastUpdatedAt };
            var completed = new OrchestrationMetadata("MyOrchestrator", InstanceId) { RuntimeStatus = OrchestrationRuntimeStatus.Completed, LastUpdatedAt = lastUpdatedAt };

            Assert.AreNotEqual(ConditionalGet.ComputeETag(running), ConditionalGet.ComputeETag(completed));
        }

        [TestMethod]
        public void TryNotModifiedReturnsTrueWhenIfNoneMatchEqualsTheETag()
        {
            var req = new FakeHttpRequestData(new Uri("http://localhost/"));
            req.Headers.Add("If-None-Match", "W/\"123:Running\"");

            bool result = ConditionalGet.TryNotModified(req, "W/\"123:Running\"", out var response);

            Assert.IsTrue(result);
            Assert.AreEqual(HttpStatusCode.NotModified, response.StatusCode);
            Assert.IsTrue(response.Headers.TryGetValues("ETag", out var etagValues));
            CollectionAssert.Contains(new List<string>(etagValues), "W/\"123:Running\"");
        }

        [TestMethod]
        public void TryNotModifiedReturnsFalseWhenIfNoneMatchDiffers()
        {
            var req = new FakeHttpRequestData(new Uri("http://localhost/"));
            req.Headers.Add("If-None-Match", "W/\"123:Running\"");

            bool result = ConditionalGet.TryNotModified(req, "W/\"456:Completed\"", out var response);

            Assert.IsFalse(result);
            Assert.IsNull(response);
        }

        [TestMethod]
        public void TryNotModifiedReturnsFalseWhenHeaderIsAbsent()
        {
            var req = new FakeHttpRequestData(new Uri("http://localhost/"));

            bool result = ConditionalGet.TryNotModified(req, "W/\"123:Running\"", out var response);

            Assert.IsFalse(result);
            Assert.IsNull(response);
        }

        [TestMethod]
        public async Task DetailsReturns304WithNoBodyWhenIfNoneMatchMatches()
        {
            var lastUpdatedAt = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero);
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Running,
                    LastUpdatedAt = lastUpdatedAt,
                    SerializedInput = "{\"a\":1}"
                }
            };
            string etag = ConditionalGet.ComputeETag(durableClient.Metadata);

            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')"));
            req.Headers.Add("If-None-Match", etag);

            var response = await Function().DfmGetOrchestrationFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.NotModified, response.StatusCode);
            Assert.IsTrue(response.Headers.TryGetValues("ETag", out var etagValues));
            CollectionAssert.Contains(new List<string>(etagValues), etag);
            Assert.AreEqual(0, await ReadBodyLengthAsync(response));
        }

        [TestMethod]
        public async Task DetailsReturns200WithETagWhenIfNoneMatchDiffers()
        {
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Running,
                    LastUpdatedAt = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero),
                    SerializedInput = "{\"a\":1}"
                }
            };
            string currentEtag = ConditionalGet.ComputeETag(durableClient.Metadata);

            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')"));
            req.Headers.Add("If-None-Match", "W/\"stale-etag\"");

            var response = await Function().DfmGetOrchestrationFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.IsTrue(response.Headers.TryGetValues("ETag", out var etagValues));
            CollectionAssert.Contains(new List<string>(etagValues), currentEtag);
            Assert.IsTrue(await ReadBodyLengthAsync(response) > 0);
        }

        [TestMethod]
        public async Task DetailsReturns200WithETagWhenNoIfNoneMatchHeaderIsSent()
        {
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Running,
                    LastUpdatedAt = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero),
                    SerializedInput = "{\"a\":1}"
                }
            };

            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')"));

            var response = await Function().DfmGetOrchestrationFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.IsTrue(response.Headers.TryGetValues("ETag", out _));
        }

        [TestMethod]
        public async Task HistoryReturns304WhenEligibleAndIfNoneMatchMatches()
        {
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Completed,
                    LastUpdatedAt = new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero)
                }
            };
            string etag = ConditionalGet.ComputeETag(durableClient.Metadata);

            var extensionPoints = new DfmExtensionPoints
            {
                GetInstanceHistoryRoutine = (client, connName, hub, id) => throw new InvalidOperationException("history should not be fetched on a 304")
            };

            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')/history"));
            req.Headers.Add("If-None-Match", etag);

            var response = await Function(extensionPoints).DfmGetOrchestrationHistoryFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.NotModified, response.StatusCode);
            Assert.IsTrue(response.Headers.TryGetValues("ETag", out var etagValues));
            CollectionAssert.Contains(new List<string>(etagValues), etag);
            Assert.AreEqual(0, await ReadBodyLengthAsync(response));
        }

        [TestMethod]
        public async Task HistoryReturns200WithETagWhenIfNoneMatchDiffers()
        {
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Completed,
                    LastUpdatedAt = new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero)
                }
            };
            string currentEtag = ConditionalGet.ComputeETag(durableClient.Metadata);

            var extensionPoints = new DfmExtensionPoints
            {
                GetInstanceHistoryRoutine = (client, connName, hub, id) => Task.FromResult<IEnumerable<HistoryEvent>>(new List<HistoryEvent>())
            };

            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')/history"));
            req.Headers.Add("If-None-Match", "W/\"stale-etag\"");

            var response = await Function(extensionPoints).DfmGetOrchestrationHistoryFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.IsTrue(response.Headers.TryGetValues("ETag", out var etagValues));
            CollectionAssert.Contains(new List<string>(etagValues), currentEtag);
        }

        [TestMethod]
        public async Task HistoryIsNeverConditionalWhenSkipIsNonZero()
        {
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Completed,
                    LastUpdatedAt = new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero)
                }
            };
            string etag = ConditionalGet.ComputeETag(durableClient.Metadata);

            var extensionPoints = new DfmExtensionPoints
            {
                GetInstanceHistoryRoutine = (client, connName, hub, id) => Task.FromResult<IEnumerable<HistoryEvent>>(new List<HistoryEvent>())
            };

            // Same etag as would match, but $skip=5 makes this a paged request: never conditional.
            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')/history?$skip=5"));
            req.Headers.Add("If-None-Match", etag);

            var response = await Function(extensionPoints).DfmGetOrchestrationHistoryFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        }

        [TestMethod]
        public async Task HistoryIsNeverConditionalWhenFilterIsPresent()
        {
            var durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Completed,
                    LastUpdatedAt = new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero)
                }
            };
            string etag = ConditionalGet.ComputeETag(durableClient.Metadata);

            var extensionPoints = new DfmExtensionPoints
            {
                GetInstanceHistoryRoutine = (client, connName, hub, id) => Task.FromResult<IEnumerable<HistoryEvent>>(new List<HistoryEvent>())
            };

            var req = new FakeHttpRequestData(new Uri($"http://localhost/orchestrations('{InstanceId}')/history?%24filter=EventType%20eq%20%27ExecutionStarted%27"));
            req.Headers.Add("If-None-Match", etag);

            var response = await Function(extensionPoints).DfmGetOrchestrationHistoryFunction(req, durableClient, "-", HubName, InstanceId);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        }

        private static Orchestration Function(DfmExtensionPoints extensionPoints = null)
        {
            return new Orchestration(new DfmSettings(), extensionPoints ?? new DfmExtensionPoints(), NullLoggerFactory.Instance);
        }

        private static async Task<long> ReadBodyLengthAsync(HttpResponseData response)
        {
            response.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(response.Body))
            {
                string body = await reader.ReadToEndAsync();
                return body.Length;
            }
        }

        // A minimal Durable client stub that returns fixed metadata for both GetInstancesAsync overload shapes
        // used by GetInstanceAsync(instanceId, true) and GetInstanceAsync(instanceId, false).
        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public OrchestrationMetadata Metadata { get; set; }

            public override Task<OrchestrationMetadata> GetInstancesAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default)
            {
                return Task.FromResult(this.Metadata);
            }
        }
    }
}
