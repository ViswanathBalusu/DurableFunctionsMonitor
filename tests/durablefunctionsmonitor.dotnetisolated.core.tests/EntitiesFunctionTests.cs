// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.DurableTask.Client.Entities;
using Microsoft.DurableTask.Entities;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class EntitiesFunctionTests
    {
        [TestInitialize]
        public void Init()
        {
            TableClient.MockedTableClient = null;
        }

        [TestMethod]
        public async Task NameGivenWithKeyPrefixBuildsTheFullInstanceIdPrefix()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "name=Counter&keyPrefix=abc");

            // Act
            await func.DfmGetEntitiesFunction(req, client, "-", "hub");

            // Assert: name is lower-cased, keyPrefix appended after the '@' separator.
            Assert.AreEqual("@counter@abc", client.FakeEntities.LastFilter.InstanceIdStartsWith);
        }

        [TestMethod]
        public async Task NameGivenAloneBuildsAnExactNameMatchPrefix()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "name=Counter");

            // Act
            await func.DfmGetEntitiesFunction(req, client, "-", "hub");

            // Assert: no keyPrefix still leaves the separator, so only the entity name matches exactly.
            Assert.AreEqual("@counter@", client.FakeEntities.LastFilter.InstanceIdStartsWith);
        }

        [TestMethod]
        public async Task NoNameLeavesInstanceIdStartsWithNull()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "keyPrefix=abc");

            // Act
            await func.DfmGetEntitiesFunction(req, client, "-", "hub");

            // Assert: keyPrefix alone (no name) cannot be pushed down; it is applied client-side instead.
            Assert.IsNull(client.FakeEntities.LastFilter.InstanceIdStartsWith);
        }

        [TestMethod]
        public async Task KeyPrefixWithoutNameFiltersClientSide()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata>
            {
                MakeSummary("counter", "abc-1"),
                MakeSummary("counter", "xyz-1"),
                MakeSummary("other", "abc-2"),
            };
            var (func, req) = Setup(client, "keyPrefix=abc");

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert: only the two entities whose key starts with "abc" survive.
            var rows = (JArray)body["entities"];
            Assert.AreEqual(2, rows.Count);
            CollectionAssert.AreEquivalent(
                new[] { "@counter@abc-1", "@other@abc-2" },
                rows.Select(r => r["instanceId"].Value<string>()).ToArray());
        }

        [TestMethod]
        public async Task HasMoreIsTrueWhenThereIsOneMoreEntityThanTop()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata>
            {
                MakeSummary("counter", "k1"),
                MakeSummary("counter", "k2"),
                MakeSummary("counter", "k3"),
            };
            var (func, req) = Setup(client, "$top=2");

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            var rows = (JArray)body["entities"];
            Assert.AreEqual(2, rows.Count);
            Assert.IsTrue(body["hasMore"].Value<bool>());
        }

        [TestMethod]
        public async Task HasMoreIsFalseWhenThePageIsNotFull()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata>
            {
                MakeSummary("counter", "k1"),
                MakeSummary("counter", "k2"),
            };
            var (func, req) = Setup(client, "$top=2");

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            var rows = (JArray)body["entities"];
            Assert.AreEqual(2, rows.Count);
            Assert.IsFalse(body["hasMore"].Value<bool>());
        }

        [TestMethod]
        public async Task SkipSkipsThatManyMatchingEntities()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata>
            {
                MakeSummary("counter", "k1"),
                MakeSummary("counter", "k2"),
                MakeSummary("counter", "k3"),
            };
            var (func, req) = Setup(client, "$skip=1&$top=10");

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            var rows = (JArray)body["entities"];
            CollectionAssert.AreEqual(
                new[] { "@counter@k2", "@counter@k3" },
                rows.Select(r => r["instanceId"].Value<string>()).ToArray());
        }

        [TestMethod]
        public async Task RowsCarryTheEntityNameKeyAndLastUpdatedTime()
        {
            // Arrange
            var lastModified = new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero);
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata> { MakeSummary("counter", "my-key", lastModified) };
            var (func, req) = Setup(client, string.Empty);

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            var row = (JObject)((JArray)body["entities"])[0];
            Assert.AreEqual("@counter@my-key", row["instanceId"].Value<string>());
            Assert.AreEqual("counter", row["entityName"].Value<string>());
            Assert.AreEqual("my-key", row["key"].Value<string>());
            Assert.AreEqual("Running", row["runtimeStatus"].Value<string>());
            Assert.AreEqual("2026-03-04T05:06:07Z", row["lastUpdatedTime"].Value<string>());
        }

        [TestMethod]
        public async Task StateFetchFailureYieldsStateErrorAndANullState()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata> { MakeSummary("counter", "my-key") };
            client.FakeEntities.GetEntityHandler = _ => throw new InvalidOperationException("state too large");
            var (func, req) = Setup(client, string.Empty);

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            var row = (JObject)((JArray)body["entities"])[0];
            Assert.AreEqual(JTokenType.Null, row["state"].Type);
            Assert.AreEqual(JTokenType.Null, row["stateSummary"].Type);
            Assert.AreEqual("state too large", row["stateError"].Value<string>());
        }

        [TestMethod]
        public async Task StateIsParsedAndSummarizedWhenTheFetchSucceeds()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = new List<EntityMetadata> { MakeSummary("counter", "my-key") };
            client.FakeEntities.GetEntityHandler = id => Task.FromResult(
                new EntityMetadata(id, new SerializedData("{\"count\":42}", null)));
            var (func, req) = Setup(client, string.Empty);

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            var row = (JObject)((JArray)body["entities"])[0];
            Assert.AreEqual(42, row["state"]["count"].Value<int>());
            Assert.AreEqual("{\"count\":42}", row["stateSummary"].Value<string>());
            Assert.AreEqual(JTokenType.Null, row["stateError"].Type);
        }

        [TestMethod]
        public async Task EntitiesNotSupportedIsTreatedAsAnEmptyList()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ThrowFromGetAllEntities = new InvalidOperationException("entities not supported");
            var (func, req) = Setup(client, string.Empty);

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            Assert.AreEqual(HttpStatusCode.OK, resp.StatusCode);
            Assert.AreEqual(0, ((JArray)body["entities"]).Count);
            Assert.IsFalse(body["hasMore"].Value<bool>());
        }

        [TestMethod]
        public async Task InvalidTopIsABadRequest()
        {
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "$top=not-a-number");

            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => func.DfmGetEntitiesFunction(req, client, "-", "hub"));
        }

        [TestMethod]
        public async Task NegativeTopIsABadRequest()
        {
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "$top=-1");

            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => func.DfmGetEntitiesFunction(req, client, "-", "hub"));
        }

        [TestMethod]
        public async Task InvalidSkipIsABadRequest()
        {
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "$skip=not-a-number");

            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => func.DfmGetEntitiesFunction(req, client, "-", "hub"));
        }

        [TestMethod]
        public async Task InvalidUpdatedFromIsABadRequest()
        {
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "updatedFrom=not-a-date");

            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => func.DfmGetEntitiesFunction(req, client, "-", "hub"));
        }

        [TestMethod]
        public async Task InvalidUpdatedToIsABadRequest()
        {
            var client = new StubDurableTaskClient();
            var (func, req) = Setup(client, "updatedTo=not-a-date");

            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => func.DfmGetEntitiesFunction(req, client, "-", "hub"));
        }

        [TestMethod]
        public async Task TopIsClampedToTheMaximum()
        {
            // Arrange: 201 entities so the clamp (not the natural page) is what determines hasMore.
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = Enumerable.Range(0, 201)
                .Select(i => MakeSummary("counter", $"k{i:D3}"))
                .ToList();
            var (func, req) = Setup(client, "$top=100000");

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert: clamped to 200 (contracts section 6, GET /entities max $top).
            Assert.AreEqual(200, ((JArray)body["entities"]).Count);
            Assert.IsTrue(body["hasMore"].Value<bool>());
        }

        [TestMethod]
        public async Task DefaultTopIs50()
        {
            // Arrange
            var client = new StubDurableTaskClient();
            client.FakeEntities.ItemsToList = Enumerable.Range(0, 51)
                .Select(i => MakeSummary("counter", $"k{i:D3}"))
                .ToList();
            var (func, req) = Setup(client, string.Empty);

            // Act
            var resp = await func.DfmGetEntitiesFunction(req, client, "-", "hub");
            var body = await ReadJsonAsync(resp);

            // Assert
            Assert.AreEqual(50, ((JArray)body["entities"]).Count);
            Assert.IsTrue(body["hasMore"].Value<bool>());
        }

        private static (Entities func, FakeHttpRequestData req) Setup(DurableTaskClient client, string queryString)
        {
            var func = new Entities(new DfmSettings(), new DfmExtensionPoints(), new LoggerFactory());
            string url = string.IsNullOrEmpty(queryString)
                ? "http://localhost/a/p/i/--hub/entities"
                : $"http://localhost/a/p/i/--hub/entities?{queryString}";
            var req = new FakeHttpRequestData(new Uri(url));
            return (func, req);
        }

        private static EntityMetadata MakeSummary(string name, string key, DateTimeOffset? lastModified = null)
        {
            return new EntityMetadata(new EntityInstanceId(name, key), null)
            {
                LastModifiedTime = lastModified ?? DateTimeOffset.UtcNow
            };
        }

        private static async Task<JObject> ReadJsonAsync(Microsoft.Azure.Functions.Worker.Http.HttpResponseData resp)
        {
            resp.Body.Position = 0;
            string text = await new StreamReader(resp.Body).ReadToEndAsync();

            // DateParseHandling.None: otherwise JObject.Parse turns ISO date-shaped strings (lastUpdatedTime)
            // into DateTime tokens, and Value<string>() on those renders with the current culture instead of
            // returning the original JSON text.
            return (JObject)JsonConvert.DeserializeObject(text, new JsonSerializerSettings { DateParseHandling = DateParseHandling.None });
        }

        // Records the last query passed to GetAllEntitiesAsync, and lets a test script per-id GetEntityAsync
        // responses (including throwing, to simulate a state-fetch failure) or a blanket GetAllEntitiesAsync
        // failure (to simulate a provider that does not support Durable Entities at all). Everything else this
        // class never exercises throws, same as the Fake* client hierarchy elsewhere in this project.
        private class FakeDurableEntityClient : DurableEntityClient
        {
            public FakeDurableEntityClient() : base("FakeDurableEntityClient")
            {
            }

            public IReadOnlyList<EntityMetadata> ItemsToList { get; set; } = new List<EntityMetadata>();

            public EntityQuery LastFilter { get; private set; }

            public Func<EntityInstanceId, Task<EntityMetadata>> GetEntityHandler { get; set; }

            public Exception ThrowFromGetAllEntities { get; set; }

            public override AsyncPageable<EntityMetadata> GetAllEntitiesAsync(EntityQuery filter = null)
            {
                this.LastFilter = filter;

                return Pageable.Create<EntityMetadata>(async (continuationToken, cancellation) =>
                {
                    if (this.ThrowFromGetAllEntities != null)
                    {
                        throw this.ThrowFromGetAllEntities;
                    }

                    return new Page<EntityMetadata>(this.ItemsToList);
                });
            }

            public override Task<EntityMetadata> GetEntityAsync(EntityInstanceId id, bool includeState = true, CancellationToken cancellation = default)
            {
                if (this.GetEntityHandler != null)
                {
                    return this.GetEntityHandler(id);
                }

                return Task.FromResult(new EntityMetadata(id, new SerializedData("{}", null)));
            }

            public override Task<EntityMetadata<T>> GetEntityAsync<T>(EntityInstanceId id, bool includeState = true, CancellationToken cancellation = default)
                => throw new NotImplementedException();

            public override AsyncPageable<EntityMetadata<T>> GetAllEntitiesAsync<T>(EntityQuery filter = null)
                => throw new NotImplementedException();

            public override Task SignalEntityAsync(EntityInstanceId id, string operationName, object input = null, SignalEntityOptions options = null, CancellationToken cancellation = default)
                => throw new NotImplementedException();

            public override Task<CleanEntityStorageResult> CleanEntityStorageAsync(CleanEntityStorageRequest? request = null, bool continueUntilComplete = true, CancellationToken cancellation = default)
                => throw new NotImplementedException();
        }

        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public FakeDurableEntityClient FakeEntities { get; } = new FakeDurableEntityClient();

            public override DurableEntityClient Entities => this.FakeEntities;
        }
    }
}
