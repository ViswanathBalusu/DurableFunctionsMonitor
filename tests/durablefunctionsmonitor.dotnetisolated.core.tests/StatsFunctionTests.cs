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
    /// GET /stats, driven through a stubbed stats routine: query parsing and its 400s, the
    /// "provider has no stats routine" branch, and the AggregationCache behaviour (decision D10) -
    /// one scan per hub and normalized query per TTL, 'cached' reported honestly.
    ///
    /// The numbers themselves are specified by StatsAggregatorTests and the Azurite StatsTests;
    /// this only checks that the endpoint validates, caches and reports them.
    ///
    /// Every test uses its own hub name: AggregationCache is a static dictionary shared by the whole
    /// process, and the hub name is part of the cache key.
    /// </summary>
    [TestClass]
    public class StatsFunctionTests
    {
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private StatsResult _statsToReturn;
        private int _routineCalls;
        private readonly List<StatsQuery> _queries = new List<StatsQuery>();
        private string _hubName;

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            TableClient.MockedTableClient = null;

            // Unique per test, so one test's cached result can never be served to another.
            this._hubName = "hub-" + Guid.NewGuid().ToString("N");

            this._settings = new DfmSettings { AggregationCacheSeconds = 30, StatsScanCap = 12345 };

            this._statsToReturn = new StatsResult
            {
                From = From,
                To = To,
                BinCount = 48,
                Totals = new StatusCounts(new Dictionary<string, int> { { "all", 3 }, { "Completed", 2 }, { "Failed", 1 } }),
                Scanned = 3,
                Partial = false,
                Cap = 12345
            };

            this._routineCalls = 0;
            this._queries.Clear();

            this._extensionPoints = new DfmExtensionPoints
            {
                GetStatsRoutine = (client, connEnvVariableName, hubName, query, ct) =>
                {
                    Interlocked.Increment(ref this._routineCalls);
                    this._queries.Add(query);
                    return Task.FromResult(this._statsToReturn);
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
        public async Task ReturnsTheStatsOfTheHubWithTheCacheFieldsFilledIn()
        {
            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            Assert.AreEqual(3, result["totals"].Value<int>("all"));
            Assert.AreEqual(3, result.Value<int>("scanned"));
            Assert.AreEqual(12345, result.Value<int>("cap"));
            Assert.IsFalse(result.Value<bool>("partial"));

            // This request did the scan itself, so it is not a cache hit and the two scan fields describe it
            Assert.IsFalse(result.Value<bool>("cached"));
            Assert.IsNotNull(result["generatedAt"]);
            Assert.IsTrue(result.Value<long>("elapsedMs") >= 0);
        }

        [TestMethod]
        public async Task DefaultsBinsStuckAndPendingWhenNotGiven()
        {
            // Act

            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert: the defaults of contracts section 6 / B1-S2-T1

            var query = this._queries.Single();
            Assert.AreEqual(48, query.Bins);
            Assert.AreEqual(60, query.StuckAfterMinutes);
            Assert.AreEqual(10, query.PendingAfterMinutes);
        }

        [TestMethod]
        public async Task PassesTheParsedParametersAndTheSettingsCapToTheRoutine()
        {
            // Act

            await this.Function.DfmGetStatsFunction(
                Request($"from={FromText}&to={ToText}&bins=24&stuckAfterMinutes=5&pendingAfterMinutes=2"), Client, "-", this._hubName);

            // Assert

            var query = this._queries.Single();
            Assert.AreEqual(From, query.From);
            Assert.AreEqual(To, query.To);
            Assert.AreEqual(24, query.Bins);
            Assert.AreEqual(5, query.StuckAfterMinutes);
            Assert.AreEqual(2, query.PendingAfterMinutes);

            // The cap protects the storage account, so it comes from settings and never from the client
            Assert.AreEqual(12345, query.Cap);
        }

        [TestMethod]
        public async Task ParsesLocalTimesIntoUtc()
        {
            // Act: same instant as From, written with an offset

            await this.Function.DfmGetStatsFunction(
                Request($"from={Uri.EscapeDataString("2026-09-04T02:00:00+02:00")}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(From, this._queries.Single().From);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenFromIsMissing()
        {
            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "'from' is required");
            Assert.AreEqual(0, this._routineCalls);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenToIsMissing()
        {
            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from={FromText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "'to' is required");
        }

        [TestMethod]
        public async Task ReturnsBadRequestForAnUnparsableDate()
        {
            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from=yesterday&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "Invalid 'from' value");
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenToIsNotLaterThanFrom()
        {
            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from={ToText}&to={FromText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "must be later than");
        }

        [TestMethod]
        public async Task ReturnsBadRequestForARangeLongerThan92Days()
        {
            // Arrange: 93 days, one more than a single scan may aggregate

            string to = Uri.EscapeDataString(From.AddDays(93).ToString("o", CultureInfo.InvariantCulture));

            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={to}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "92 days");
        }

        [TestMethod]
        [DataRow("bins=0")]
        [DataRow("bins=367")]
        [DataRow("bins=lots")]
        [DataRow("stuckAfterMinutes=0")]
        [DataRow("stuckAfterMinutes=100001")]
        [DataRow("pendingAfterMinutes=0")]
        [DataRow("pendingAfterMinutes=100001")]
        public async Task ReturnsBadRequestForAnOutOfRangeOrUnparsableNumber(string parameter)
        {
            // Act

            var response = await this.Function.DfmGetStatsFunction(
                Request($"from={FromText}&to={ToText}&{parameter}"), Client, "-", this._hubName);

            // Assert: out of range is rejected, never clamped - a chart drawn with the wrong bin count is silently wrong

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(0, this._routineCalls);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenTheProviderHasNoStatsRoutine()
        {
            // Arrange: Netherite has none, and /about reports capabilities.stats == false for the same reason

            this._extensionPoints.GetStatsRoutine = null;

            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(
                DurableFunctionsMonitor.DotNetIsolated.Stats.ProviderNotSupportedMessage,
                await ReadBodyAsync(response));
        }

        [TestMethod]
        public async Task ScansOnlyOncePerTtlAndMarksTheSecondResponseAsCached()
        {
            // Act

            var first = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            var second = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(1, this._routineCalls, "the second call within the TTL must not scan storage again");

            Assert.IsFalse((await ReadJsonAsync(first)).Value<bool>("cached"));
            Assert.IsTrue((await ReadJsonAsync(second)).Value<bool>("cached"));
        }

        [TestMethod]
        public async Task AQueryThatDiffersOnlyInSecondsHitsTheSameCacheEntry()
        {
            // Arrange: StatsQuery.CacheKey rounds From/To down to the minute, so an auto-refreshing
            // Overview screen (which sends "now" every few seconds) keeps hitting the same entry.

            string toWithSeconds = Uri.EscapeDataString(To.AddSeconds(37).ToString("o", CultureInfo.InvariantCulture));

            // Act

            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={toWithSeconds}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(1, this._routineCalls);
        }

        [TestMethod]
        public async Task ADifferentRangeIsADifferentCacheEntry()
        {
            // Arrange

            string otherTo = Uri.EscapeDataString(To.AddHours(1).ToString("o", CultureInfo.InvariantCulture));

            // Act

            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={otherTo}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(2, this._routineCalls);
        }

        [TestMethod]
        public async Task ScansAgainAfterTheTtlExpired()
        {
            // Arrange

            var now = new DateTime(2026, 9, 4, 12, 0, 0, DateTimeKind.Utc);
            AggregationCache.UtcNow = () => now;

            // Act

            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            now = now.AddSeconds(this._settings.AggregationCacheSeconds + 1);

            var afterTtl = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(2, this._routineCalls);
            Assert.IsFalse((await ReadJsonAsync(afterTtl)).Value<bool>("cached"), "a re-scan is not a cache hit");
        }

        [TestMethod]
        public async Task ACachedResponseDoesNotMutateTheCachedInstance()
        {
            // Act: three calls, so the third would see a mutated entry if the second had marked it

            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert: the object the routine produced is still the un-flagged one

            Assert.IsFalse(this._statsToReturn.Cached);
            Assert.AreEqual(1, this._routineCalls);
        }

        [TestMethod]
        public async Task AFailingRoutineIsAnInternalServerErrorAndIsNotCached()
        {
            // Arrange

            this._extensionPoints.GetStatsRoutine = (client, connEnvVariableName, hubName, query, ct) =>
            {
                Interlocked.Increment(ref this._routineCalls);
                throw new DfmStorageException("Table Instances is unavailable", inner: null);
            };

            // Act

            var first = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);
            await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert: a faulted factory must not poison the key for the rest of the TTL

            Assert.AreEqual(HttpStatusCode.InternalServerError, first.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(first), "Table Instances is unavailable");
            Assert.AreEqual(2, this._routineCalls);
        }

        [TestMethod]
        public async Task ARoutineThatReturnsNothingIsAnInternalServerError()
        {
            // Arrange

            this._extensionPoints.GetStatsRoutine = (client, connEnvVariableName, hubName, query, ct) => Task.FromResult<StatsResult>(null);

            // Act

            var response = await this.Function.DfmGetStatsFunction(Request($"from={FromText}&to={ToText}"), Client, "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
        }

        [TestMethod]
        public void IsMarkedAsAReadOperation()
        {
            // Arrange

            var method = typeof(DurableFunctionsMonitor.DotNetIsolated.Stats)
                .GetMethod(nameof(DurableFunctionsMonitor.DotNetIsolated.Stats.DfmGetStatsFunction));

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

        private DurableFunctionsMonitor.DotNetIsolated.Stats Function
        {
            get { return new DurableFunctionsMonitor.DotNetIsolated.Stats(this._settings, this._extensionPoints, NullLoggerFactory.Instance); }
        }

        // The endpoint never touches the Durable client itself, it only forwards it to the routine.
        private static DurableTaskClient Client
        {
            get { return new FakeDurableTaskClient(); }
        }

        private FakeHttpRequestData Request(string queryString)
        {
            return new FakeHttpRequestData(new Uri($"http://localhost/a/p/i/--{this._hubName}/stats?{queryString}"));
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
