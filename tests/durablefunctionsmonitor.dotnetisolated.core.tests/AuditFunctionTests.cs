// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
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
    /// GET /audit, driven through a stubbed reader: the query it builds (including the default range the
    /// Activity screen opens on), the mapping of a record onto the contracted row, and the 'auditing is
    /// off' answer, which is an empty page rather than an error.
    ///
    /// What the store actually reads is specified by the Azurite AuditStoreTests.
    /// </summary>
    [TestClass]
    public class AuditFunctionTests
    {
        private const string HubName = "TestHub";

        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private AuditPage _pageToReturn;
        private readonly List<AuditQuery> _queries = new List<AuditQuery>();

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            TableClient.MockedTableClient = null;

            this._settings = new DfmSettings { AuditEnabled = true };

            this._pageToReturn = new AuditPage
            {
                Rows = new List<AuditRecord>
                {
                    new AuditRecord
                    {
                        At = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero),
                        User = "alice@contoso.com",
                        Operation = "Terminate",
                        Kind = "Write",
                        InstanceId = "order-1",
                        Outcome = "failed",
                        Status = 409,
                        Message = "Instance is not running",
                        Route = "/a/p/i/--TestHub/orchestrations('order-1')/terminate"
                    }
                },
                HasMore = true
            };

            this._queries.Clear();

            this._extensionPoints = new DfmExtensionPoints
            {
                ReadAuditRecordsRoutine = (connEnvVariableName, hubName, query) =>
                {
                    this._queries.Add(query);
                    return Task.FromResult(this._pageToReturn);
                }
            };
        }

        [TestMethod]
        public async Task ReturnsTheRowsInTheContractedShape()
        {
            // Act

            var response = await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            CollectionAssert.AreEquivalent(new[] { "rows", "hasMore", "enabled" }, result.Properties().Select(p => p.Name).ToArray());

            var row = (JObject)((JArray)result["rows"]).Single();

            // Route stays in the store: it is for troubleshooting, not part of the contract
            CollectionAssert.AreEquivalent(
                new[] { "at", "user", "operation", "kind", "instanceId", "outcome", "status", "message" },
                row.Properties().Select(p => p.Name).ToArray());

            Assert.AreEqual("2026-09-04T12:00:00Z", row.Value<string>("at"));
            Assert.AreEqual("alice@contoso.com", row.Value<string>("user"));
            Assert.AreEqual("Terminate", row.Value<string>("operation"));
            Assert.AreEqual("Write", row.Value<string>("kind"));
            Assert.AreEqual("order-1", row.Value<string>("instanceId"));
            Assert.AreEqual("failed", row.Value<string>("outcome"));
            Assert.AreEqual(409, row.Value<int>("status"));
            Assert.AreEqual("Instance is not running", row.Value<string>("message"));

            Assert.IsTrue(result.Value<bool>("hasMore"));
            Assert.IsTrue(result.Value<bool>("enabled"));
        }

        [TestMethod]
        public async Task ReportsItselfDisabledWhenAuditingIsOff()
        {
            // Arrange

            this._settings.AuditEnabled = false;

            // Act

            var response = await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert: an empty page that says why, not a 400 - the UI shows its 'auditing is off' state

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);
            Assert.IsFalse(result.Value<bool>("enabled"));
            Assert.AreEqual(0, ((JArray)result["rows"]).Count);
            Assert.IsFalse(result.Value<bool>("hasMore"));

            Assert.AreEqual(0, this._queries.Count, "the store is not even asked");
        }

        [TestMethod]
        public async Task ReportsItselfDisabledWhenTheProviderCannotServeRecords()
        {
            // Arrange: MSSQL nulls the reader out

            this._extensionPoints.ReadAuditRecordsRoutine = null;

            // Act

            var response = await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert

            Assert.IsFalse((await ReadJsonAsync(response)).Value<bool>("enabled"));
        }

        [TestMethod]
        public async Task DefaultsToTheLastTwentyFourHours()
        {
            // Act

            await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert: the Activity screen opens on 'what happened recently'

            var query = this._queries.Single();
            Assert.IsTrue((DateTimeOffset.UtcNow - query.To).Duration() < TimeSpan.FromMinutes(1));
            Assert.AreEqual(DurableFunctionsMonitor.DotNetIsolated.Audit.DefaultRangeHours, (query.To - query.From).TotalHours, 0.01);
        }

        [TestMethod]
        public async Task DefaultsTopTo100AndSkipTo0()
        {
            // Act

            await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert

            var query = this._queries.Single();
            Assert.AreEqual(100, query.Top);
            Assert.AreEqual(0, query.Skip);
            Assert.IsNull(query.Operation);
        }

        [TestMethod]
        public async Task PassesTheGivenRangeOperationTopAndSkipToTheReader()
        {
            // Act

            await this.Function.DfmGetAuditFunction(
                Request($"from={FromText}&to={ToText}&operation=Terminate&$top=25&$skip=50"), "-", HubName);

            // Assert

            var query = this._queries.Single();
            Assert.AreEqual(From, query.From);
            Assert.AreEqual(To, query.To);
            Assert.AreEqual("Terminate", query.Operation);
            Assert.AreEqual(25, query.Top);
            Assert.AreEqual(50, query.Skip);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenOnlyOneEndOfTheRangeIsGiven()
        {
            // Act

            var response = await this.Function.DfmGetAuditFunction(Request($"from={FromText}"), "-", HubName);

            // Assert: a half-specified range is a mistake, not a default

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "'to' is required");
        }

        [TestMethod]
        public async Task ReturnsBadRequestForATopOutsideItsBounds()
        {
            // Act

            var response = await this.Function.DfmGetAuditFunction(Request("$top=501"), "-", HubName);

            // Assert: contracts section 6 caps $top at 500

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "'$top'");
        }

        [TestMethod]
        public async Task ReturnsBadRequestForARangeLongerThan92Days()
        {
            // Arrange

            string to = Uri.EscapeDataString(From.AddDays(93).ToString("o", CultureInfo.InvariantCulture));

            // Act

            var response = await this.Function.DfmGetAuditFunction(Request($"from={FromText}&to={to}"), "-", HubName);

            // Assert: the same rule /stats and /failures enforce, from the same RangeQuery helper

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "92 days");
        }

        [TestMethod]
        public async Task AReaderThatReturnsNothingIsAnEmptyPage()
        {
            // Arrange

            this._extensionPoints.ReadAuditRecordsRoutine = (connEnvVariableName, hubName, query) => Task.FromResult<AuditPage>(null);

            // Act

            var response = await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert

            var result = await ReadJsonAsync(response);
            Assert.AreEqual(0, ((JArray)result["rows"]).Count);

            // Enabled: the log is on, it simply has nothing to show
            Assert.IsTrue(result.Value<bool>("enabled"));
        }

        [TestMethod]
        public async Task AFailingReaderIsAnInternalServerError()
        {
            // Arrange

            this._extensionPoints.ReadAuditRecordsRoutine = (connEnvVariableName, hubName, query) =>
                throw new DfmStorageException("The audit table is unreachable", inner: null);

            // Act

            var response = await this.Function.DfmGetAuditFunction(Request(string.Empty), "-", HubName);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
        }

        [TestMethod]
        public void IsMarkedAsAReadOperation()
        {
            // Arrange

            var method = typeof(DurableFunctionsMonitor.DotNetIsolated.Audit)
                .GetMethod(nameof(DurableFunctionsMonitor.DotNetIsolated.Audit.DfmGetAuditFunction));

            // Act

            var attribute = (OperationKindAttribute)method.GetCustomAttributes(typeof(OperationKindAttribute), false).Single();

            // Assert: reading the log is a read, even though everything in it is a write

            Assert.AreEqual(OperationKind.Read, attribute.Kind);
        }

        #region Fixture helpers

        private static readonly DateTimeOffset From = new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
        private static readonly DateTimeOffset To = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);

        private static readonly string FromText = Uri.EscapeDataString(From.ToString("o", CultureInfo.InvariantCulture));
        private static readonly string ToText = Uri.EscapeDataString(To.ToString("o", CultureInfo.InvariantCulture));

        private DurableFunctionsMonitor.DotNetIsolated.Audit Function
        {
            get { return new DurableFunctionsMonitor.DotNetIsolated.Audit(this._settings, this._extensionPoints, NullLoggerFactory.Instance); }
        }

        private static FakeHttpRequestData Request(string queryString)
        {
            string url = string.IsNullOrEmpty(queryString)
                ? $"http://localhost/a/p/i/--{HubName}/audit"
                : $"http://localhost/a/p/i/--{HubName}/audit?{queryString}";

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
