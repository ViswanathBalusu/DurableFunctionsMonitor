// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// GET /failures, driven through a stubbed failures routine: the range parsing it shares with /stats
    /// (RangeQuery), the 'provider has no routine' branch and the AggregationCache behaviour (decision D10).
    ///
    /// The groups themselves are specified by FailuresAggregatorTests and the Azurite FailuresTests.
    ///
    /// Every test uses its own hub name: AggregationCache is a static dictionary shared by the whole
    /// process, and the hub name is part of the cache key.
    /// </summary>
    [TestClass]
    public class FailuresFunctionTests
    {
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private FailuresResult _failuresToReturn;
        private int _routineCalls;
        private readonly List<FailuresQuery> _queries = new List<FailuresQuery>();
        private string _hubName;

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            TableClient.MockedTableClient = null;

            this._hubName = "hub-" + Guid.NewGuid().ToString("N");

            this._settings = new DfmSettings { AggregationCacheSeconds = 30, StatsScanCap = 12345 };

            this._failuresToReturn = new FailuresResult
            {
                Groups = new List<FailureGroup>
                {
                    new FailureGroup
                    {
                        Key = "ProcessOrderOrchestrator|InventoryUnavailable: SKU-* has * units in warehouse-*",
                        Name = "ProcessOrderOrchestrator",
                        Signature = "InventoryUnavailable: SKU-* has * units in warehouse-*",
                        Count = 6,
                        LastSeenAt = new DateTimeOffset(2026, 9, 4, 11, 0, 0, TimeSpan.Zero),
                        SampleIds = new List<string> { "order-1" },
                        Instances = new List<FailureInstance>
                        {
                            new FailureInstance
                            {
                                InstanceId = "order-1",
                                CreatedTime = new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero),
                                CompletedTime = new DateTimeOffset(2026, 9, 4, 10, 0, 20, TimeSpan.Zero),
                                DurationMs = 20000,
                                Reason = "InventoryUnavailable: SKU-4471 has 0 units in warehouse-07"
                            }
                        }
                    }
                },
                TotalFailed = 6,
                Scanned = 9,
                Partial = false,
                Cap = 12345
            };

            this._routineCalls = 0;
            this._queries.Clear();

            this._extensionPoints = new DfmExtensionPoints
            {
                GetFailuresRoutine = (client, connEnvVariableName, hubName, query, ct) =>
                {
                    Interlocked.Increment(ref this._routineCalls);
                    this._queries.Add(query);
                    return Task.FromResult(this._failuresToReturn);
                }
            };
        }

        [TestCleanup]
        public void TestCleanup()
        {
            // The clock is a static, process-wide hook: always put the real one back.
            AggregationCache.UtcNow = () => DateTime.UtcNow;
        }

        [TestMethod]
        public async Task ReturnsTheFailureGroupsInTheContractedShape()
        {
            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            CollectionAssert.AreEquivalent(
                new[] { "groups", "totalFailed", "scanned", "partial", "cap", "elapsedMs", "generatedAt", "cached" },
                result.Properties().Select(p => p.Name).ToArray());

            var group = (JObject)((JArray)result["groups"]).Single();
            CollectionAssert.AreEquivalent(
                new[] { "key", "name", "signature", "count", "lastSeenAt", "sampleIds", "instances" },
                group.Properties().Select(p => p.Name).ToArray());

            var instance = (JObject)((JArray)group["instances"]).Single();
            CollectionAssert.AreEquivalent(
                new[] { "instanceId", "createdTime", "completedTime", "durationMs", "reason" },
                instance.Properties().Select(p => p.Name).ToArray());

            Assert.AreEqual(6, group.Value<int>("count"));
            Assert.AreEqual(6, result.Value<int>("totalFailed"));
            Assert.AreEqual(9, result.Value<int>("scanned"));
            Assert.AreEqual(12345, result.Value<int>("cap"));

            // This request did the scan itself, so it is not a cache hit
            Assert.IsFalse(result.Value<bool>("cached"));
            Assert.IsNotNull(result["generatedAt"]);
            Assert.IsTrue(result.Value<long>("elapsedMs") >= 0);
        }

        [TestMethod]
        public async Task PassesTheParsedRangeAndTheSettingsCapToTheRoutine()
        {
            // Act

            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            var query = this._queries.Single();
            Assert.AreEqual(From, query.From);
            Assert.AreEqual(To, query.To);
            Assert.AreEqual(12345, query.Cap);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenFromIsMissing()
        {
            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "'from' is required");
            Assert.AreEqual(0, this._routineCalls);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenToIsMissing()
        {
            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "'to' is required");
        }

        [TestMethod]
        public async Task ReturnsBadRequestForAnUnparsableDate()
        {
            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"from=yesterday&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "Invalid 'from' value");
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenToIsNotLaterThanFrom()
        {
            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"from={ToText}&to={FromText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "must be later than");
        }

        [TestMethod]
        public async Task ReturnsBadRequestForARangeLongerThan92Days()
        {
            // Arrange

            string to = Uri.EscapeDataString(From.AddDays(93).ToString("o", CultureInfo.InvariantCulture));

            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={to}"), Client, "-", this._hubName);

            // Assert: the same rule /stats enforces, from the same RangeQuery helper

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "92 days");
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenTheProviderHasNoFailuresRoutine()
        {
            // Arrange: MSSQL and Netherite have none, and /about reports failures == false for the same reason

            this._extensionPoints.GetFailuresRoutine = null;

            // Act

            var response = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(
                DurableFunctionsMonitor.DotNetIsolated.Failures.ProviderNotSupportedMessage,
                await ReadBodyAsync(response));
        }

        [TestMethod]
        public async Task ScansOnlyOncePerTtlAndMarksTheSecondResponseAsCached()
        {
            // Act

            var first = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            var second = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(1, this._routineCalls, "the second call within the TTL must not scan storage again");
            Assert.IsFalse((await ReadJsonAsync(first)).Value<bool>("cached"));
            Assert.IsTrue((await ReadJsonAsync(second)).Value<bool>("cached"));
        }

        [TestMethod]
        public async Task AQueryThatDiffersOnlyInSecondsHitsTheSameCacheEntry()
        {
            // Arrange

            string toWithSeconds = Uri.EscapeDataString(To.AddSeconds(37).ToString("o", CultureInfo.InvariantCulture));

            // Act

            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={toWithSeconds}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(1, this._routineCalls);
        }

        [TestMethod]
        public async Task ScansAgainAfterTheTtlExpired()
        {
            // Arrange

            var now = new DateTime(2026, 9, 4, 12, 0, 0, DateTimeKind.Utc);
            AggregationCache.UtcNow = () => now;

            // Act

            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            now = now.AddSeconds(this._settings.AggregationCacheSeconds + 1);

            var afterTtl = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(2, this._routineCalls);
            Assert.IsFalse((await ReadJsonAsync(afterTtl)).Value<bool>("cached"), "a re-scan is not a cache hit");
        }

        [TestMethod]
        public async Task ACachedResponseDoesNotMutateTheCachedInstance()
        {
            // Act

            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.IsFalse(this._failuresToReturn.Cached);
            Assert.AreEqual(1, this._routineCalls);
        }

        [TestMethod]
        public async Task AFailingRoutineIsAnInternalServerErrorAndIsNotCached()
        {
            // Arrange

            this._extensionPoints.GetFailuresRoutine = (client, connEnvVariableName, hubName, query, ct) =>
            {
                Interlocked.Increment(ref this._routineCalls);
                throw new DfmStorageException("Table Instances is unavailable", inner: null);
            };

            // Act

            var first = await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetFailuresFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, first.StatusCode);
            Assert.AreEqual(2, this._routineCalls);
        }

        [TestMethod]
        public void IsMarkedAsAReadOperation()
        {
            // Arrange

            var method = typeof(DurableFunctionsMonitor.DotNetIsolated.Failures)
                .GetMethod(nameof(DurableFunctionsMonitor.DotNetIsolated.Failures.DfmGetFailuresFunction));

            // Act

            var attribute = (OperationKindAttribute)method.GetCustomAttributes(typeof(OperationKindAttribute), false).Single();

            // Assert

            Assert.AreEqual(OperationKind.Read, attribute.Kind);
        }

        #region Fixture helpers

        private static readonly DateTimeOffset From = new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
        private static readonly DateTimeOffset To = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);

        private static readonly string FromText = Uri.EscapeDataString(From.ToString("o", CultureInfo.InvariantCulture));
        private static readonly string ToText = Uri.EscapeDataString(To.ToString("o", CultureInfo.InvariantCulture));

        private DurableFunctionsMonitor.DotNetIsolated.Failures Function
        {
            get { return new DurableFunctionsMonitor.DotNetIsolated.Failures(this._settings, this._extensionPoints, NullLoggerFactory.Instance); }
        }

        // The endpoint never touches the Durable client itself, it only forwards it to the routine.
        private static DurableTaskClient Client
        {
            get { return new FakeDurableTaskClient(); }
        }

        private FakeHttpRequestData Request(string queryString)
        {
            return new FakeHttpRequestData(new Uri($"http://localhost/a/p/i/--{this._hubName}/failures?{queryString}"));
        }

        private static async Task<string> ReadBodyAsync(HttpResponseData response)
        {
            response.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(response.Body))
            {
                return await reader.ReadToEndAsync();
            }
        }

        private static async Task<JObject> ReadJsonAsync(HttpResponseData response)
        {
            // DateParseHandling.None keeps the ISO strings as strings, so their exact precision can be asserted
            using (var reader = new JsonTextReader(new StringReader(await ReadBodyAsync(response))) { DateParseHandling = DateParseHandling.None })
            {
                return JObject.Load(reader);
            }
        }

        #endregion
    }
}
