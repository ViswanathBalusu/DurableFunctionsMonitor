// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.DurableTask.Client.Entities;
using Microsoft.DurableTask.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// <see cref="Batch.DfmBatchFunction"/>: body validation (action, instanceIds shape/size/duplicates,
    /// entity ids on orchestration-only actions), per-id execution through the same
    /// <see cref="OrchestrationActions.ExecuteAsync"/> the single-instance endpoint uses, and the
    /// per-id status mapping (409/400/500) inside an always-200 response.
    /// </summary>
    [TestClass]
    public class BatchFunctionTests
    {
        private const string HubName = "TestHub";

        private StubDurableTaskClient _durableClient;

        [TestInitialize]
        public void TestInit()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            this._durableClient = new StubDurableTaskClient();
        }

        // ------------------------------------------------------------------
        // Happy path / per-id status mapping
        // ------------------------------------------------------------------

        [TestMethod]
        public async Task AllInstancesSucceed_ReturnsOkCountAndStatus200Everywhere()
        {
            var body = BatchBody("suspend", new[] { "a", "b", "c" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var json = ReadJson(response);
            Assert.AreEqual("suspend", (string)json["action"]);
            Assert.AreEqual(3, (int)json["okCount"]);
            Assert.AreEqual(0, (int)json["failedCount"]);

            var results = (JArray)json["results"];
            Assert.AreEqual(3, results.Count);
            foreach (var result in results)
            {
                Assert.AreEqual((int)HttpStatusCode.OK, (int)result["status"]);
                Assert.IsTrue((bool)result["ok"]);
                Assert.IsNull(result["message"]);
            }

            // request order preserved
            CollectionAssert.AreEqual(new[] { "a", "b", "c" }, results.Select(r => (string)r["instanceId"]).ToArray());
        }

        [TestMethod]
        public async Task OneInstanceThrowsInvalidOperationException_OkCount2AndThatIdIs409()
        {
            this._durableClient.ExceptionsByInstanceId["b"] = new InvalidOperationException("wrong runtime status");

            var body = BatchBody("suspend", new[] { "a", "b", "c" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var json = ReadJson(response);
            Assert.AreEqual(2, (int)json["okCount"]);
            Assert.AreEqual(1, (int)json["failedCount"]);

            var results = (JArray)json["results"];
            var failed = results.Single(r => (string)r["instanceId"] == "b");
            Assert.IsFalse((bool)failed["ok"]);
            Assert.AreEqual((int)HttpStatusCode.Conflict, (int)failed["status"]);
            StringAssert.Contains((string)failed["message"], "wrong runtime status");

            foreach (var id in new[] { "a", "c" })
            {
                var ok = results.Single(r => (string)r["instanceId"] == id);
                Assert.IsTrue((bool)ok["ok"]);
                Assert.AreEqual((int)HttpStatusCode.OK, (int)ok["status"]);
            }
        }

        [TestMethod]
        public async Task RaiseEventMissingNamePropertyMapsToPerId400()
        {
            var body = "{ \"action\": \"raise-event\", \"instanceIds\": [\"a\"], \"payload\": { } }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var json = ReadJson(response);
            Assert.AreEqual(0, (int)json["okCount"]);
            Assert.AreEqual(1, (int)json["failedCount"]);

            var result = ((JArray)json["results"]).Single();
            Assert.AreEqual((int)HttpStatusCode.BadRequest, (int)result["status"]);
            Assert.IsFalse((bool)result["ok"]);
            Assert.IsNotNull((string)result["message"]);
        }

        [TestMethod]
        public async Task UnexpectedExceptionFromTheClientMapsToPerId500()
        {
            this._durableClient.ExceptionsByInstanceId["a"] = new ApplicationException("boom");

            var body = BatchBody("suspend", new[] { "a" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var json = ReadJson(response);
            var result = ((JArray)json["results"]).Single();
            Assert.AreEqual((int)HttpStatusCode.InternalServerError, (int)result["status"]);
            StringAssert.Contains((string)result["message"], "boom");
        }

        [TestMethod]
        public async Task RaiseEventPassesNameAndDataThroughToTheClient()
        {
            var body = "{ \"action\": \"raise-event\", \"instanceIds\": [\"a\"], \"payload\": { \"name\": \"Approval\", \"data\": { \"ok\": true } } }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, "Raise:a:Approval");
        }

        [TestMethod]
        public async Task ResultsPreserveRequestOrderEvenWhenLaterIdsFinishFirst()
        {
            // 'a' delays the longest, 'c' returns immediately: without index-based ordering the results
            // list would come back in completion order (c, b, a) instead of request order (a, b, c).
            this._durableClient.DelaysByInstanceId["a"] = TimeSpan.FromMilliseconds(150);
            this._durableClient.DelaysByInstanceId["b"] = TimeSpan.FromMilliseconds(75);

            var body = BatchBody("suspend", new[] { "a", "b", "c" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            var json = ReadJson(response);
            var ids = ((JArray)json["results"]).Select(r => (string)r["instanceId"]).ToArray();

            CollectionAssert.AreEqual(new[] { "a", "b", "c" }, ids);
        }

        [TestMethod]
        public async Task NeverRunsMoreThanEightInstancesConcurrently()
        {
            var instanceIds = Enumerable.Range(0, 20).Select(i => $"id-{i}").ToArray();
            this._durableClient.ConcurrencyDelay = TimeSpan.FromMilliseconds(30);

            var body = BatchBody("suspend", instanceIds);

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.IsTrue(this._durableClient.MaxObservedConcurrency <= 8, $"Observed concurrency {this._durableClient.MaxObservedConcurrency} exceeds the cap of 8");
            Assert.IsTrue(this._durableClient.MaxObservedConcurrency > 1, "Test is inconclusive: no concurrency was observed at all");
        }

        // ------------------------------------------------------------------
        // Body / action validation
        // ------------------------------------------------------------------

        [TestMethod]
        public async Task MissingActionIsABadRequest()
        {
            var body = "{ \"instanceIds\": [\"a\"] }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task UnknownActionIsABadRequest()
        {
            var body = BatchBody("frobnicate", new[] { "a" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        [DataRow("replay")]
        [DataRow("restart-in-place")]
        [DataRow("update-input-and-rewind")]
        public async Task DangerousActionsAreRefusedWithASpecificMessage(string action)
        {
            var body = BatchBody(action, new[] { "a" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            string text = ReadText(response);
            StringAssert.Contains(text, "Dangerous operations cannot run in batch");
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task EmptyInstanceIdsIsABadRequest()
        {
            var body = BatchBody("suspend", Array.Empty<string>());

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task MissingInstanceIdsIsABadRequest()
        {
            var body = "{ \"action\": \"suspend\" }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task InstanceIdsNotAnArrayIsABadRequest()
        {
            var body = "{ \"action\": \"suspend\", \"instanceIds\": \"a\" }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task InstanceIdsWithANonStringElementIsABadRequest()
        {
            var body = "{ \"action\": \"suspend\", \"instanceIds\": [\"a\", 42] }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task DuplicateInstanceIdsIsABadRequest()
        {
            var body = BatchBody("suspend", new[] { "a", "a" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task TwoHundredOneInstanceIdsIsABadRequest()
        {
            var instanceIds = Enumerable.Range(0, 201).Select(i => $"id-{i}").ToArray();
            var body = BatchBody("suspend", instanceIds);

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task ExactlyTwoHundredInstanceIdsIsAccepted()
        {
            var instanceIds = Enumerable.Range(0, 200).Select(i => $"id-{i}").ToArray();
            var body = BatchBody("suspend", instanceIds);

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var json = ReadJson(response);
            Assert.AreEqual(200, (int)json["okCount"]);
        }

        [TestMethod]
        public async Task MalformedJsonBodyIsABadRequest()
        {
            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest("{ not json"), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task NonObjectBodyIsABadRequest()
        {
            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest("[1,2,3]"), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task PayloadThatIsNotAJsonObjectIsABadRequest()
        {
            var body = "{ \"action\": \"suspend\", \"instanceIds\": [\"a\"], \"payload\": \"not-an-object\" }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task PayloadThatIsJsonNullIsTreatedAsAbsent()
        {
            var body = "{ \"action\": \"purge\", \"instanceIds\": [\"a\"], \"payload\": null }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, "Purge:a");
        }

        [TestMethod]
        public async Task EmptyBodyIsABadRequest()
        {
            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(string.Empty), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        [DataRow("rewind")]
        [DataRow("restart")]
        [DataRow("suspend")]
        [DataRow("resume")]
        public async Task OrchestrationOnlyActionsRejectAnEntityId(string action)
        {
            var body = BatchBody(action, new[] { "@counter@my-key" });

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task RaiseEventAcceptsAnEntityIdAndSignalsIt()
        {
            var body = "{ \"action\": \"raise-event\", \"instanceIds\": [\"@counter@my-key\"], \"payload\": { \"name\": \"add\", \"data\": 1 } }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.FakeEntities.Calls, "Signal:@counter@my-key:add");
        }

        [TestMethod]
        public async Task PurgeIgnoresAMissingPayload()
        {
            var body = "{ \"action\": \"purge\", \"instanceIds\": [\"a\"] }";

            var response = await this.Function.DfmBatchFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, "Purge:a");
        }

        private Batch Function => new Batch(new DfmSettings(), new DfmExtensionPoints(), NullLoggerFactory.Instance);

        private static string BatchBody(string action, IReadOnlyList<string> instanceIds)
        {
            var idsJson = string.Join(",", instanceIds.Select(id => $"\"{id}\""));
            return $"{{ \"action\": \"{action}\", \"instanceIds\": [{idsJson}] }}";
        }

        private static JObject ReadJson(Microsoft.Azure.Functions.Worker.Http.HttpResponseData response)
        {
            return JObject.Parse(ReadText(response));
        }

        private static string ReadText(Microsoft.Azure.Functions.Worker.Http.HttpResponseData response)
        {
            response.Body.Position = 0;
            return new StreamReader(response.Body).ReadToEnd();
        }

        // A request whose body is the given JSON string
        private class FakeJsonRequest : FakeHttpRequestData
        {
            private readonly MemoryStream _body;

            public FakeJsonRequest(string body) : base(new Uri("http://localhost"))
            {
                this._body = new MemoryStream(Encoding.UTF8.GetBytes(body ?? string.Empty));
            }

            public override Stream Body => this._body;
        }

        // Records what the endpoint asks the Durable Task client (and its Entities client) to do, optionally
        // throwing a configured exception or delaying, per instance id - and tracks how many instances are
        // ever executing at once, to prove the SemaphoreSlim(8) cap.
        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public List<string> Calls { get; } = new List<string>();
            public Dictionary<string, Exception> ExceptionsByInstanceId { get; } = new Dictionary<string, Exception>();
            public Dictionary<string, TimeSpan> DelaysByInstanceId { get; } = new Dictionary<string, TimeSpan>();
            public TimeSpan? ConcurrencyDelay { get; set; }
            public int MaxObservedConcurrency => this._maxObservedConcurrency;

            public FakeDurableEntityClient FakeEntities { get; } = new FakeDurableEntityClient();
            public override DurableEntityClient Entities => this.FakeEntities;

            private int _currentConcurrency;
            private int _maxObservedConcurrency;

            public override async Task SuspendInstanceAsync(string instanceId, string reason = null, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Suspend:{instanceId}:{reason}");
            }

            public override async Task ResumeInstanceAsync(string instanceId, string reason = null, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Resume:{instanceId}:{reason}");
            }

            public override async Task<PurgeResult> PurgeInstanceAsync(string instanceId, PurgeInstanceOptions options, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Purge:{instanceId}");
                return new PurgeResult(1);
            }

            public override Task<PurgeResult> PurgeInstanceAsync(string instanceId, CancellationToken cancellation = default)
            {
                return this.PurgeInstanceAsync(instanceId, null, cancellation);
            }

            public override async Task RewindInstanceAsync(string instanceId, string reason, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Rewind:{instanceId}:{reason}");
            }

            public override async Task TerminateInstanceAsync(string instanceId, object output = null, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Terminate:{instanceId}:{output}");
            }

            public override async Task RaiseEventAsync(string instanceId, string eventName, object eventPayload = null, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Raise:{instanceId}:{eventName}");
            }

            public override async Task<string> RestartAsync(string instanceId, bool restartWithNewInstanceId = false, CancellationToken cancellation = default)
            {
                await this.TrackAndMaybeThrowAsync(instanceId);
                this.Calls.Add($"Restart:{instanceId}:{restartWithNewInstanceId}");
                return instanceId;
            }

            private async Task TrackAndMaybeThrowAsync(string instanceId)
            {
                int current = Interlocked.Increment(ref this._currentConcurrency);
                InterlockedMax(ref this._maxObservedConcurrency, current);
                try
                {
                    if (this.ConcurrencyDelay.HasValue)
                    {
                        await Task.Delay(this.ConcurrencyDelay.Value);
                    }
                    else if (this.DelaysByInstanceId.TryGetValue(instanceId, out var delay))
                    {
                        await Task.Delay(delay);
                    }

                    if (this.ExceptionsByInstanceId.TryGetValue(instanceId, out var ex))
                    {
                        throw ex;
                    }
                }
                finally
                {
                    Interlocked.Decrement(ref this._currentConcurrency);
                }
            }

            private static void InterlockedMax(ref int target, int value)
            {
                int initial;
                do
                {
                    initial = target;
                    if (value <= initial)
                    {
                        return;
                    }
                }
                while (Interlocked.CompareExchange(ref target, value, initial) != initial);
            }
        }

        // A minimal Entities client that only records SignalEntityAsync calls
        private class FakeDurableEntityClient : DurableEntityClient
        {
            public FakeDurableEntityClient() : base("FakeDurableEntityClient")
            {
            }

            public List<string> Calls { get; } = new List<string>();

            public override Task SignalEntityAsync(EntityInstanceId id, string operationName, object input = null, SignalEntityOptions options = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Signal:{id}:{operationName}");
                return Task.CompletedTask;
            }

            public override Task<EntityMetadata> GetEntityAsync(EntityInstanceId id, bool includeState = true, CancellationToken cancellation = default)
                => throw new NotImplementedException();

            public override Task<EntityMetadata<T>> GetEntityAsync<T>(EntityInstanceId id, bool includeState = true, CancellationToken cancellation = default)
                => throw new NotImplementedException();

            public override AsyncPageable<EntityMetadata> GetAllEntitiesAsync(EntityQuery filter = null)
                => throw new NotImplementedException();

            public override AsyncPageable<EntityMetadata<T>> GetAllEntitiesAsync<T>(EntityQuery filter = null)
                => throw new NotImplementedException();

            public override Task<CleanEntityStorageResult> CleanEntityStorageAsync(CleanEntityStorageRequest? request = null, bool continueUntilComplete = true, CancellationToken cancellation = default)
                => throw new NotImplementedException();
        }
    }
}
