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
    /// GET orchestrations('{id}')/spans, driven through a stub Durable client and stubbed storage routines:
    /// the SpansResponse shape of contracts section 6, every validation branch (unknown instance, entity id,
    /// routines that are null or return null), the history-size estimate and the conditional GET.
    ///
    /// The span rules themselves are specified by SpanBuilderTests; this only checks that the endpoint
    /// composes the loader, the markers and the builder and reports them under the contracted names.
    /// </summary>
    [TestClass]
    public class SpansFunctionTests
    {
        private const string InstanceId = "my-instance";
        private const string HubName = "TestHub";

        private StubDurableTaskClient _durableClient;
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private List<HistoryEvent> _history;
        private List<EpisodeMarker> _markers;
        private InstanceRowInfo _rowInfo;

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            TableClient.MockedTableClient = null;

            this._durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Completed,
                    LastUpdatedAt = T("14:02:20")
                }
            };

            this._settings = new DfmSettings();

            // Started, one activity that completed, then completed
            this._history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("14:02:00"), name: "MyOrchestrator", sequenceNumber: 0, input: "{\"a\":1}"),
                Event("TaskCompleted", T("14:02:10"), name: "Reserve", sequenceNumber: 3, scheduledTime: T("14:02:02"), result: "\"ok\""),
                Event("ExecutionCompleted", T("14:02:20"), sequenceNumber: 7, result: "\"done\"")
            };

            this._markers = new List<EpisodeMarker>
            {
                new EpisodeMarker { Start = T("14:02:00"), End = T("14:02:01") },
                new EpisodeMarker { Start = T("14:02:10"), End = T("14:02:11") }
            };

            this._rowInfo = new InstanceRowInfo
            {
                ExecutionId = "1e6b0f4a",
                Generation = 2,

                // Never filled by any provider, on purpose: the endpoint estimates the size itself
                HistoryBytesEstimate = null
            };

            this._extensionPoints = new DfmExtensionPoints
            {
                GetInstanceHistoryRoutine = (client, connName, hubName, instanceId) =>
                {
                    // Counted, so that the conditional-GET test can prove the history was not loaded at all
                    this._historyLoads++;
                    return Task.FromResult<IEnumerable<HistoryEvent>>(this._history);
                },
                GetEpisodeMarkersRoutine = (client, connName, hubName, instanceId) => Task.FromResult<IReadOnlyList<EpisodeMarker>>(this._markers),
                GetInstanceRowInfoRoutine = (client, connName, hubName, instanceId) => Task.FromResult(this._rowInfo)
            };
        }

        [TestMethod]
        public async Task ReturnsTheSpansOfTheInstanceInTheContractedShape()
        {
            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            // Every field of contracts section 6 SpansResponse, camelCase, none missing
            CollectionAssert.AreEquivalent(
                new[]
                {
                    "instanceId", "executionId", "generation", "executionStartedAt", "executionEndedAt",
                    "now", "spans", "totals", "historyRows", "historyBytes", "largeMessageBlobs"
                },
                result.Properties().Select(p => p.Name).ToArray());

            Assert.AreEqual(InstanceId, result.Value<string>("instanceId"));
            Assert.AreEqual("1e6b0f4a", result.Value<string>("executionId"));
            Assert.AreEqual(2, result.Value<int>("generation"));
            Assert.AreEqual("2026-09-04T14:02:00.000Z", result.Value<string>("executionStartedAt"));
            Assert.AreEqual("2026-09-04T14:02:20.000Z", result.Value<string>("executionEndedAt"));
            Assert.AreEqual(3, result.Value<int>("historyRows"));
            Assert.IsNull(result["largeMessageBlobs"].Value<long?>());

            // Two episodes plus the one activity
            var spans = (JArray)result["spans"];
            Assert.AreEqual(3, spans.Count);

            var activity = spans.Single(s => s.Value<string>("kind") == "activity");
            Assert.AreEqual("Reserve", activity.Value<string>("name"));
            Assert.AreEqual("completed", activity.Value<string>("status"));
            Assert.AreEqual(1, activity.Value<int>("attempt"));
            Assert.AreEqual("2026-09-04T14:02:02.000Z", activity.Value<string>("start"));
            Assert.AreEqual("2026-09-04T14:02:10.000Z", activity.Value<string>("end"));
            Assert.AreEqual(8000d, activity.Value<double>("durationMs"));
            CollectionAssert.AreEqual(new long[] { 3 }, activity["sequenceNumbers"].Values<long>().ToArray());

            Assert.AreEqual(2, spans.Count(s => s.Value<string>("kind") == "orchestrator"));

            var totals = result["totals"];
            Assert.AreEqual(8000d, totals.Value<double>("activitiesMs"));
            Assert.AreEqual(0d, totals.Value<double>("subOrchestrationsMs"));
            Assert.AreEqual(0d, totals.Value<double>("timersMs"));
            Assert.AreEqual(0d, totals.Value<double>("externalEventWaitMs"));
            Assert.AreEqual(2000d, totals.Value<double>("orchestratorMs"));
            Assert.AreEqual(20000d, totals.Value<double>("totalMs"));
        }

        [TestMethod]
        public async Task ReturnsNowWithMillisecondPrecision()
        {
            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            var result = await ReadJsonAsync(response);

            // The very same converter the spans use: whole seconds would misplace a live bar by up to a second
            string now = result.Value<string>("now");
            StringAssert.Matches(now, new System.Text.RegularExpressions.Regex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"));

            var parsed = DateTimeOffset.Parse(now, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal);
            Assert.IsTrue((DateTimeOffset.UtcNow - parsed).Duration() < TimeSpan.FromMinutes(1));
        }

        [TestMethod]
        public async Task ReturnsNotFoundWhenTheInstanceDoesNotExist()
        {
            // Arrange

            this._durableClient.Metadata = null;

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), InstanceId);
        }

        [TestMethod]
        public async Task ReturnsAnEmptySpanListForAnEntityInstance()
        {
            // Arrange

            const string EntityId = "@mycounter@key1";

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, EntityId);

            // Assert

            // An entity has no orchestrator, no activities and no timers, so it has an empty timeline
            // rather than an error: the peek panel and the Timeline tab open for entities too
            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            Assert.AreEqual(EntityId, result.Value<string>("instanceId"));
            Assert.AreEqual(0, ((JArray)result["spans"]).Count);
            Assert.AreEqual(0, result.Value<int>("historyRows"));
            Assert.IsNull(result["historyBytes"].Value<long?>());
            Assert.IsNull(result["executionId"].Value<string>());
            Assert.IsNull(result["generation"].Value<int?>());
            Assert.IsNull(result["totals"]["orchestratorMs"].Value<double?>());
            Assert.AreEqual(0d, result["totals"].Value<double>("totalMs"));

            // The instance itself was never looked up, and neither was storage
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task ReportsNoOrchestratorSpansWhenTheProviderHasNoEpisodeMarkers()
        {
            // Arrange

            // Netherite: the routine is null
            this._extensionPoints.GetEpisodeMarkersRoutine = null;

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            var result = await ReadJsonAsync(response);

            Assert.AreEqual(0, ((JArray)result["spans"]).Count(s => s.Value<string>("kind") == "orchestrator"));
            Assert.IsNull(result["totals"]["orchestratorMs"].Value<double?>());
        }

        [TestMethod]
        public async Task ReportsNullExecutionIdAndGenerationWhenTheProviderHasNoInstanceRowInfo()
        {
            // Arrange

            // Netherite: the routine is null
            this._extensionPoints.GetInstanceRowInfoRoutine = null;

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            var result = await ReadJsonAsync(response);

            Assert.IsNull(result["executionId"].Value<string>());
            Assert.IsNull(result["generation"].Value<int?>());

            // The spans themselves are unaffected
            Assert.AreEqual(3, ((JArray)result["spans"]).Count);
        }

        [TestMethod]
        public async Task ReportsNullExecutionIdAndGenerationWhenTheInstanceRowIsGone()
        {
            // Arrange

            // GetInstanceRowInfoAsync returns null when the Instances row was purged
            this._rowInfo = null;

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            Assert.IsNull(result["executionId"].Value<string>());
            Assert.IsNull(result["generation"].Value<int?>());
        }

        [TestMethod]
        public async Task EstimatesHistoryBytesFromTheLoadedPayloads()
        {
            // Arrange

            this._history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("14:02:00"), name: "MyOrchestrator", sequenceNumber: 0, input: "12345"),
                Event("TaskFailed", T("14:02:10"), name: "Reserve", sequenceNumber: 3, scheduledTime: T("14:02:02"), details: "123")
            };

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            var result = await ReadJsonAsync(response);

            // UTF-16: two bytes per char of every Input/Result/Details string
            Assert.AreEqual(2, result.Value<int>("historyRows"));
            Assert.AreEqual(16L, result.Value<long>("historyBytes"));
        }

        [TestMethod]
        public async Task ReportsNullHistoryBytesForAnEmptyHistory()
        {
            // Arrange

            this._history = new List<HistoryEvent>();

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            Assert.AreEqual(0, result.Value<int>("historyRows"));
            Assert.IsNull(result["historyBytes"].Value<long?>());
            Assert.AreEqual(0, ((JArray)result["spans"]).Count(s => s.Value<string>("kind") != "orchestrator"));
            Assert.IsNull(result["executionStartedAt"].Value<string>());
        }

        [TestMethod]
        public async Task ReturnsTheSameETagAsTheDetailsEndpoint()
        {
            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(
                ConditionalGet.ComputeETag(this._durableClient.Metadata),
                response.Headers.GetValues("ETag").Single());
        }

        [TestMethod]
        public async Task ReturnsNotModifiedWhenTheInstanceHasNotChanged()
        {
            // Arrange

            var request = Request();
            request.Headers.Add("If-None-Match", ConditionalGet.ComputeETag(this._durableClient.Metadata));

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.NotModified, response.StatusCode);
            Assert.AreEqual(string.Empty, await ReadBodyAsync(response));

            // The history was never loaded
            Assert.AreEqual(0, this._historyLoads);
        }

        [TestMethod]
        public async Task ReturnsInternalServerErrorWhenStorageCannotBeRead()
        {
            // Arrange

            this._extensionPoints.GetInstanceHistoryRoutine = (client, connName, hubName, instanceId)
                => throw new DfmStorageException("History table is unreachable", new Exception("boom"));

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "History table is unreachable");
        }

        [TestMethod]
        public async Task ReturnsNotFoundWhenAStorageRoutineSaysSo()
        {
            // Arrange

            this._extensionPoints.GetInstanceHistoryRoutine = (client, connName, hubName, instanceId)
                => throw new DfmNotFoundException("No history for this instance");

            // Act

            var response = await this.Function.DfmGetOrchestrationSpansFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "No history for this instance");
        }

        [TestMethod]
        public void TheFunctionIsAReadOperation()
        {
            var attribute = typeof(DurableFunctionsMonitor.DotNetIsolated.Spans)
                .GetMethod(nameof(DurableFunctionsMonitor.DotNetIsolated.Spans.DfmGetOrchestrationSpansFunction))
                .GetCustomAttributes(typeof(OperationKindAttribute), false)
                .Cast<OperationKindAttribute>()
                .Single();

            Assert.AreEqual(OperationKind.Read, attribute.Kind);
        }

        #region Fixture helpers

        private int _historyLoads;

        private DurableFunctionsMonitor.DotNetIsolated.Spans Function
        {
            get { return new DurableFunctionsMonitor.DotNetIsolated.Spans(this._settings, this._extensionPoints, NullLoggerFactory.Instance); }
        }

        private static FakeHttpRequestData Request()
        {
            return new FakeHttpRequestData(new Uri($"http://localhost/a/p/i/--{HubName}/orchestrations('{InstanceId}')/spans"));
        }

        private static DateTimeOffset T(string timeOfDay)
        {
            return DateTimeOffset.Parse(
                "2026-09-04T" + timeOfDay + "Z",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal);
        }

        private static HistoryEvent Event(
            string eventType,
            DateTimeOffset timestamp,
            string name = null,
            long? sequenceNumber = null,
            DateTimeOffset? scheduledTime = null,
            string input = null,
            string result = null,
            string details = null)
        {
            return new HistoryEvent
            {
                SequenceNumber = sequenceNumber,
                Timestamp = timestamp,
                EventType = eventType,
                Name = name,
                ScheduledTime = scheduledTime,
                DurationInMs = scheduledTime == null ? 0 : (timestamp - scheduledTime.Value).TotalMilliseconds,
                Input = input,
                Result = result,
                Details = details
            };
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

        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public OrchestrationMetadata Metadata { get; set; }

            public List<string> Calls { get; } = new List<string>();

            public override Task<OrchestrationMetadata> GetInstancesAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Get:{instanceId}:{getInputsAndOutputs}");
                return Task.FromResult(this.Metadata);
            }
        }

        #endregion
    }
}
