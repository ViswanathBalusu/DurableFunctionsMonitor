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
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// GET /storage, driven through a stubbed storage-health routine: the query parameters it forwards, the
    /// two facts the endpoint adds itself (provider and account name), the 'provider has no routine' branch
    /// and the AggregationCache behaviour (decision D10), including the separate entry per 'counts' value.
    ///
    /// What the routine actually reads is specified by StorageHealthParsingTests and the Azurite
    /// StorageHealthTests.
    /// </summary>
    [TestClass]
    public class StorageFunctionTests
    {
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private StorageHealthResult _healthToReturn;
        private int _routineCalls;
        private readonly List<(bool counts, string instanceId)> _routineArgs = new List<(bool, string)>();
        private string _hubName;

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            Environment.SetEnvironmentVariable(
                EnvVariableNames.AzureWebJobsStorage,
                "DefaultEndpointsProtocol=https;AccountName=mystorageaccount;AccountKey=abc==;EndpointSuffix=core.windows.net");

            TableClient.MockedTableClient = null;

            // Unique per test, so one test's cached result can never be served to another.
            this._hubName = "hub-" + Guid.NewGuid().ToString("N");

            this._settings = new DfmSettings { AggregationCacheSeconds = 30 };

            this._healthToReturn = new StorageHealthResult
            {
                TaskHub = new StorageTaskHubInfo { Name = this._hubName, PartitionCount = 4, Source = "taskhub.json" },
                Queues = new List<StorageQueueInfo>
                {
                    new StorageQueueInfo { Name = "hub-workitems", Kind = "workitems", ApproximateMessageCount = 3 }
                },
                Tables = new StorageTablesInfo { Instances = "hubInstances", History = "hubHistory" },
                LargeMessages = new StorageLargeMessagesInfo { Container = "hub-largemessages", Exists = true },
                Counts = new StorageCountsInfo(),
                GeneratedAt = DateTimeOffset.UtcNow,
                ElapsedMs = 7
            };

            this._routineCalls = 0;
            this._routineArgs.Clear();

            this._extensionPoints = new DfmExtensionPoints
            {
                GetStorageHealthRoutine = (connEnvVariableName, hubName, counts, instanceId, ct) =>
                {
                    Interlocked.Increment(ref this._routineCalls);
                    this._routineArgs.Add((counts, instanceId));
                    return Task.FromResult(this._healthToReturn);
                }
            };
        }

        [TestCleanup]
        public void TestCleanup()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage, string.Empty);

            // The clock is a static, process-wide hook: always put the real one back.
            AggregationCache.UtcNow = () => DateTime.UtcNow;
        }

        [TestMethod]
        public async Task ReturnsTheStorageHealthWithTheProviderAndAccountNameFilledIn()
        {
            // Act

            var response = await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            // The two facts the routine cannot know, added by the endpoint
            Assert.AreEqual("AzureStorage", result.Value<string>("provider"));
            Assert.AreEqual("mystorageaccount", result.Value<string>("accountName"));

            Assert.AreEqual(4, result["taskHub"].Value<int>("partitionCount"));
            Assert.AreEqual(3, ((JArray)result["queues"])[0].Value<int>("approximateMessageCount"));
            Assert.IsFalse(result.Value<bool>("cached"));
        }

        [TestMethod]
        public async Task DoesNotAskForTheRowCountsUnlessTheCallerDid()
        {
            // Act

            await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert

            Assert.IsFalse(this._routineArgs.Single().counts);
        }

        [TestMethod]
        public async Task ForwardsCountsAndInstanceIdToTheRoutine()
        {
            // Act

            await this.Function.DfmGetStorageFunction(this.Request("counts=true&instanceId=order-1"), "-", this._hubName);

            // Assert

            Assert.IsTrue(this._routineArgs.Single().counts);
            Assert.AreEqual("order-1", this._routineArgs.Single().instanceId);
        }

        [TestMethod]
        public async Task ReturnsBadRequestForANonBooleanCounts()
        {
            // Act

            var response = await this.Function.DfmGetStorageFunction(this.Request("counts=maybe"), "-", this._hubName);

            // Assert: a silent false would leave the caller wondering why the row counts never arrived

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "Invalid 'counts' value");
            Assert.AreEqual(0, this._routineCalls);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenTheProviderHasNoStorageHealthRoutine()
        {
            // Arrange: MSSQL and Netherite have none, and /about reports storageHealth == false for the same reason

            this._extensionPoints.GetStorageHealthRoutine = null;

            // Act

            var response = await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(
                DurableFunctionsMonitor.DotNetIsolated.Storage.ProviderNotSupportedMessage,
                await ReadBodyAsync(response));
        }

        [TestMethod]
        public async Task ReadsStorageOnlyOncePerTtlAndMarksTheSecondResponseAsCached()
        {
            // Act

            var first = await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);
            var second = await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert

            Assert.AreEqual(1, this._routineCalls);
            Assert.IsFalse((await ReadJsonAsync(first)).Value<bool>("cached"));
            Assert.IsTrue((await ReadJsonAsync(second)).Value<bool>("cached"));
        }

        [TestMethod]
        public async Task CountsTrueAndCountsFalseAreSeparateCacheEntries()
        {
            // Act

            await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);
            await this.Function.DfmGetStorageFunction(this.Request("counts=true"), "-", this._hubName);

            // Assert: the cheap call must never be answered with the expensive one's entry, or the other
            // way round - the two responses do not carry the same fields

            Assert.AreEqual(2, this._routineCalls);
            CollectionAssert.AreEqual(new[] { false, true }, this._routineArgs.Select(a => a.counts).ToArray());
        }

        [TestMethod]
        public async Task ADifferentInstanceIdIsADifferentCacheEntry()
        {
            // Act

            await this.Function.DfmGetStorageFunction(this.Request("instanceId=order-1"), "-", this._hubName);
            await this.Function.DfmGetStorageFunction(this.Request("instanceId=order-2"), "-", this._hubName);

            // Assert: the instance scopes the large-message numbers, so it changes the response

            Assert.AreEqual(2, this._routineCalls);
        }

        [TestMethod]
        public async Task ReadsStorageAgainAfterTheTtlExpired()
        {
            // Arrange

            var now = new DateTime(2026, 9, 4, 12, 0, 0, DateTimeKind.Utc);
            AggregationCache.UtcNow = () => now;

            // Act

            await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            now = now.AddSeconds(this._settings.AggregationCacheSeconds + 1);

            var afterTtl = await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert

            Assert.AreEqual(2, this._routineCalls);
            Assert.IsFalse((await ReadJsonAsync(afterTtl)).Value<bool>("cached"), "a re-read is not a cache hit");
        }

        [TestMethod]
        public async Task ACachedResponseDoesNotMutateTheCachedInstance()
        {
            // Act

            await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);
            await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert

            Assert.IsFalse(this._healthToReturn.Cached);
        }

        [TestMethod]
        public async Task AFailingRoutineIsAnInternalServerErrorAndIsNotCached()
        {
            // Arrange

            this._extensionPoints.GetStorageHealthRoutine = (connEnvVariableName, hubName, counts, instanceId, ct) =>
            {
                Interlocked.Increment(ref this._routineCalls);
                throw new DfmStorageException("The storage account is unreachable", inner: null);
            };

            // Act

            var first = await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);
            await this.Function.DfmGetStorageFunction(this.Request(string.Empty), "-", this._hubName);

            // Assert: a faulted factory must not poison the key for the rest of the TTL

            Assert.AreEqual(HttpStatusCode.InternalServerError, first.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(first), "The storage account is unreachable");
            Assert.AreEqual(2, this._routineCalls);
        }

        [TestMethod]
        public void IsMarkedAsAReadOperation()
        {
            // Arrange

            var method = typeof(DurableFunctionsMonitor.DotNetIsolated.Storage)
                .GetMethod(nameof(DurableFunctionsMonitor.DotNetIsolated.Storage.DfmGetStorageFunction));

            // Act

            var attribute = (OperationKindAttribute)method.GetCustomAttributes(typeof(OperationKindAttribute), false).Single();

            // Assert

            Assert.AreEqual(OperationKind.Read, attribute.Kind);
        }

        #region Fixture helpers

        private DurableFunctionsMonitor.DotNetIsolated.Storage Function
        {
            get { return new DurableFunctionsMonitor.DotNetIsolated.Storage(this._settings, this._extensionPoints, NullLoggerFactory.Instance); }
        }

        private FakeHttpRequestData Request(string queryString)
        {
            string url = string.IsNullOrEmpty(queryString)
                ? $"http://localhost/a/p/i/--{this._hubName}/storage"
                : $"http://localhost/a/p/i/--{this._hubName}/storage?{queryString}";

            return new FakeHttpRequestData(new Uri(url));
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
