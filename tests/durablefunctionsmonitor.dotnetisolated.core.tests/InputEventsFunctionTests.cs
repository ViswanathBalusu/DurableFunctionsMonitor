// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The input-events endpoints, driven through a stub Durable client and stubbed storage routines:
    /// status codes for each validation branch, and the order of the storage and client calls.
    /// </summary>
    [TestClass]
    public class InputEventsFunctionTests
    {
        private const string InstanceId = "my-instance";
        private const string HubName = "TestHub";

        private StubDurableTaskClient _durableClient;
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private List<HistoryEvent> _history;

        // What the stubbed storage routines were asked to do
        private readonly List<string> _storageCalls = new List<string>();

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            TableClient.MockedTableClient = null;

            this._durableClient = new StubDurableTaskClient();
            this._settings = new DfmSettings { DangerousOperationsEnabled = true };

            // The default: started, one approval event, then failed
            this._history = new List<HistoryEvent>
            {
                Event(1, "ExecutionStarted", "MyOrchestrator", "{\"a\":1}"),
                Event(2, "TaskScheduled", "Activity1"),
                Event(5, "EventRaised", "Approval", "{\"ok\":true}"),
                Event(8, "TaskScheduled", "Activity2"),
                Event(11, "EventRaised", "Approval2", "{\"ok\":false}"),
                Event(14, "ExecutionCompleted")
            };

            this._extensionPoints = new DfmExtensionPoints
            {
                GetInstanceHistoryRoutine = (client, connName, hubName, instanceId) => Task.FromResult<IEnumerable<HistoryEvent>>(this._history),
                GetParentInstanceIdRoutine = (client, connName, hubName, instanceId) => Task.FromResult<string>(null),
                GetHistoryEventInputRoutine = (client, connName, hubName, instanceId, sequenceNumber) =>
                {
                    this._storageCalls.Add($"ReadInput:{sequenceNumber}");
                    return Task.FromResult(this._history.Single(e => e.SequenceNumber == sequenceNumber).Input);
                },
                UpdateHistoryEventInputRoutine = (client, connName, hubName, instanceId, sequenceNumber, inputJson) =>
                {
                    this._storageCalls.Add($"UpdateInput:{sequenceNumber}:{inputJson}");
                    return Task.CompletedTask;
                },
                TruncateHistoryRoutine = (client, connName, hubName, instanceId, sequenceNumber) =>
                {
                    this._storageCalls.Add($"Truncate:{sequenceNumber}");
                    return Task.FromResult(7);
                }
            };

            this.SetStatus(OrchestrationRuntimeStatus.Failed);
        }

        [TestMethod]
        public async Task GetInputEventsListsTheEventsWithTheirOperations()
        {
            // Act

            var response = await this.Function.DfmGetInputEventsFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            Assert.AreEqual(InstanceId, result.Value<string>("instanceId"));
            Assert.AreEqual("Failed", result.Value<string>("runtimeStatus"));
            Assert.IsTrue(result.Value<bool>("dangerousOperationsEnabled"));
            Assert.IsTrue(result["storageSupports"].Value<bool>("updateInput"));

            var events = (JArray)result["events"];
            Assert.AreEqual(3, events.Count);

            var lastEvent = events[2];
            Assert.AreEqual(11, lastEvent.Value<long>("sequenceNumber"));
            Assert.AreEqual("Approval2", lastEvent.Value<string>("name"));
            Assert.IsTrue(lastEvent.Value<bool>("isLast"));

            // The stored JSON comes back parsed, read through the storage routine
            Assert.IsFalse(lastEvent["input"].Value<bool>("ok"));
            CollectionAssert.Contains(this._storageCalls, "ReadInput:11");

            Assert.IsTrue(lastEvent["operations"]["update-input-and-rewind"].Value<bool>("allowed"));
            Assert.IsTrue(lastEvent["operations"]["replay"].Value<bool>("allowed"));
            Assert.IsFalse(lastEvent["operations"]["restart-in-place"].Value<bool>("allowed"));

            // Stored inputs stay out of the JSON, only the resolved value is returned
            Assert.IsNull(lastEvent["storedInput"]);
        }

        [TestMethod]
        public async Task GetInputEventsFallsBackToTheHistoryRecordWhenTheStorageRoutineFails()
        {
            // Arrange

            this._extensionPoints.GetHistoryEventInputRoutine = (client, connName, hubName, instanceId, sequenceNumber) => throw new InvalidOperationException("storage is down");

            // Act

            var response = await this.Function.DfmGetInputEventsFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);
            Assert.IsTrue(result["events"][0]["input"].Value<int>("a") == 1);

            // ...but says so, since the record may only hold the empty marker of an offloaded payload
            StringAssert.Contains(result["events"][0].Value<string>("inputError"), "storage is down");
        }

        [TestMethod]
        public async Task GetInputEventsStillAnswersWhenTheParentCannotBeDetermined()
        {
            // Arrange

            this._extensionPoints.GetParentInstanceIdRoutine = (client, connName, hubName, instanceId) => throw new TimeoutException("history scan timed out");

            // Act

            var response = await this.Function.DfmGetInputEventsFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        }

        [TestMethod]
        public async Task RestartInPlaceRefusesWhenTheStoredInputCannotBeRead()
        {
            // Arrange

            this.UseHistoryWithoutRaisedEvents();
            this._extensionPoints.GetHistoryEventInputRoutine = (client, connName, hubName, instanceId, sequenceNumber) => throw new InvalidOperationException("blob container is gone");

            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            // The purge would have deleted the very payload that could not be read
            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "Nothing was changed");
            CollectionAssert.DoesNotContain(this._durableClient.Calls, $"Purge:{InstanceId}");
        }

        [TestMethod]
        public async Task RestartInPlaceRefusesWhenTheParentCannotBeDetermined()
        {
            // Arrange

            this.UseHistoryWithoutRaisedEvents();
            this._extensionPoints.GetParentInstanceIdRoutine = (client, connName, hubName, instanceId) => throw new TimeoutException("history scan timed out");

            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            // A sub-orchestration re-created as a top-level instance would leave its parent waiting forever
            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "sub-orchestration");
            CollectionAssert.DoesNotContain(this._durableClient.Calls, $"Purge:{InstanceId}");
        }

        [TestMethod]
        public async Task ReplayRefusesWhenTheStoredInputCannotBeRead()
        {
            // Arrange

            this._extensionPoints.GetHistoryEventInputRoutine = (client, connName, hubName, instanceId, sequenceNumber) => throw new InvalidOperationException("blob container is gone");

            // Act

            var response = await this.Function.DfmReplayFunction(new FakeJsonRequest("{ \"sequenceNumber\": 11 }"), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
            CollectionAssert.DoesNotContain(this._storageCalls, "Truncate:11");
            CollectionAssert.DoesNotContain(this._durableClient.Calls, $"Raise:{InstanceId}:Approval2");
        }

        [TestMethod]
        public async Task UnknownInstancesAreNotFound()
        {
            // Arrange

            this._durableClient.Metadata = null;

            // Act

            var response = await this.Function.DfmGetInputEventsFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
        }

        [TestMethod]
        public async Task EntitiesAreRejected()
        {
            // Act

            var response = await this.Function.DfmGetInputEventsFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, "@counter@my-key");

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task RestartInPlacePurgesThenRecreatesWithTheEditedInput()
        {
            // Arrange

            this.UseHistoryWithoutRaisedEvents();
            var request = new FakeJsonRequest("{ \"input\": { \"a\": 2 } }");

            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            // Purge first, then schedule under the same id, nothing else touching the instance
            CollectionAssert.AreEqual(
                new[] { $"Get:{InstanceId}", $"Purge:{InstanceId}", $"Schedule:MyOrchestrator:{InstanceId}" },
                this._durableClient.Calls);

            Assert.AreEqual("{\"a\":2}", JsonSerializer.Serialize(this._durableClient.ScheduledInput));

            var result = await ReadJsonAsync(response);
            Assert.IsTrue(result.Value<bool>("purged"));
            Assert.AreEqual(2, result["input"].Value<int>("a"));
        }

        [TestMethod]
        public async Task RestartInPlaceReusesTheStoredInputWhenNoneIsGiven()
        {
            // Arrange

            this.UseHistoryWithoutRaisedEvents();

            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.AreEqual("{\"a\":1}", JsonSerializer.Serialize(this._durableClient.ScheduledInput));
            CollectionAssert.Contains(this._storageCalls, "ReadInput:1");
        }

        [TestMethod]
        public async Task RestartInPlaceRefusesInstancesThatReceivedEvents()
        {
            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "external events");
            CollectionAssert.DoesNotContain(this._durableClient.Calls, $"Purge:{InstanceId}");
        }

        [TestMethod]
        [DataRow(OrchestrationRuntimeStatus.Completed)]
        [DataRow(OrchestrationRuntimeStatus.Running)]
        [DataRow(OrchestrationRuntimeStatus.Terminated)]
        public async Task RestartInPlaceRefusesNonFailedInstances(OrchestrationRuntimeStatus status)
        {
            // Arrange

            this.UseHistoryWithoutRaisedEvents();
            this.SetStatus(status);

            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
            CollectionAssert.DoesNotContain(this._durableClient.Calls, $"Purge:{InstanceId}");
        }

        [TestMethod]
        public async Task RestartInPlaceReportsAPurgedButNotRecreatedInstance()
        {
            // Arrange

            this.UseHistoryWithoutRaisedEvents();
            this._durableClient.ScheduleException = new InvalidOperationException("orchestrator is disabled");

            // Act

            var response = await this.Function.DfmRestartInPlaceFunction(new FakeJsonRequest(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);

            // Everything needed to start the instance by hand is in the response
            var result = await ReadJsonAsync(response);
            StringAssert.Contains(result.Value<string>("error"), "orchestrator is disabled");
            Assert.AreEqual("MyOrchestrator", result.Value<string>("orchestratorName"));
            Assert.AreEqual(1, result["input"].Value<int>("a"));
        }

        [TestMethod]
        public async Task UpdateInputAndRewindUpdatesTheInputThenRewinds()
        {
            // Arrange

            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": { \"ok\": true }, \"reason\": \"fixed the payload\" }");

            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            CollectionAssert.AreEqual(new[] { "UpdateInput:11:{\"ok\":true}" }, this._storageCalls);
            CollectionAssert.AreEqual(new[] { $"Get:{InstanceId}", $"Rewind:{InstanceId}:fixed the payload" }, this._durableClient.Calls);

            var result = await ReadJsonAsync(response);
            Assert.IsTrue(result.Value<bool>("inputUpdated"));
            Assert.IsTrue(result.Value<bool>("rewound"));
        }

        [TestMethod]
        public async Task UpdateInputAndRewindAcceptsAJsonNullInput()
        {
            // Arrange

            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": null }");

            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.AreEqual(new[] { "UpdateInput:11:null" }, this._storageCalls);
        }

        [TestMethod]
        public async Task UpdateInputAndRewindRejectsAStaleSequenceNumber()
        {
            // Arrange

            // 5 is an earlier approval, not the last one
            var request = new FakeJsonRequest("{ \"sequenceNumber\": 5, \"input\": { \"ok\": true } }");

            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
            Assert.AreEqual(0, this._storageCalls.Count);
            CollectionAssert.DoesNotContain(this._durableClient.Calls, $"Rewind:{InstanceId}:");
        }

        [TestMethod]
        [DataRow("{ \"input\": { \"ok\": true } }", "sequenceNumber")]
        [DataRow("{ \"sequenceNumber\": 11 }", "input")]
        [DataRow("{ \"sequenceNumber\": \"eleven\", \"input\": 1 }", "integer")]
        [DataRow("[1, 2, 3]", "JSON object")]
        [DataRow("not json", "not valid JSON")]
        public async Task UpdateInputAndRewindRejectsMalformedBodies(string body, string expectedComplaint)
        {
            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), expectedComplaint);
            Assert.AreEqual(0, this._storageCalls.Count);
        }

        [TestMethod]
        public async Task UpdateInputAndRewindRequiresAFailedInstance()
        {
            // Arrange

            this.SetStatus(OrchestrationRuntimeStatus.Completed);
            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": { \"ok\": true } }");

            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
            Assert.AreEqual(0, this._storageCalls.Count);
        }

        [TestMethod]
        public async Task UpdateInputAndRewindAnswers400WhenTheProviderDoesNotSupportIt()
        {
            // Arrange

            this._extensionPoints.UpdateHistoryEventInputRoutine = null;
            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": { \"ok\": true } }");

            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "storage provider");
        }

        [TestMethod]
        public async Task UpdateInputAndRewindReportsAnUpdatedButNotRewoundInstance()
        {
            // Arrange

            this._durableClient.RewindException = new InvalidOperationException("The rewind operation is only supported on failed orchestration instances.");
            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": { \"ok\": true } }");

            // Act

            var response = await this.Function.DfmUpdateInputAndRewindFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);

            var result = await ReadJsonAsync(response);
            Assert.IsTrue(result.Value<bool>("inputUpdated"));
            Assert.IsFalse(result.Value<bool>("rewound"));
            StringAssert.Contains(result.Value<string>("error"), "Rewind button");
        }

        [TestMethod]
        public async Task ReplayTruncatesTheHistoryThenRaisesTheEventAgain()
        {
            // Arrange

            this.SetStatus(OrchestrationRuntimeStatus.Completed);
            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11 }");

            // Act

            var response = await this.Function.DfmReplayFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            // The stored input is read before the history is touched, and the event is raised only after the truncation
            CollectionAssert.AreEqual(new[] { "ReadInput:11", "Truncate:11" }, this._storageCalls);
            CollectionAssert.AreEqual(new[] { $"Get:{InstanceId}", $"Raise:{InstanceId}:Approval2" }, this._durableClient.Calls);
            Assert.AreEqual("{\"ok\":false}", JsonSerializer.Serialize(this._durableClient.RaisedPayload));

            var result = await ReadJsonAsync(response);
            Assert.AreEqual("Approval2", result.Value<string>("eventName"));
            Assert.AreEqual(7, result.Value<int>("deletedRows"));
            Assert.IsTrue(result.Value<bool>("raised"));
        }

        [TestMethod]
        public async Task ReplayRaisesTheEditedInput()
        {
            // Arrange

            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": { \"ok\": true, \"comment\": \"second try\" } }");

            // Act

            var response = await this.Function.DfmReplayFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.AreEqual("{\"ok\":true,\"comment\":\"second try\"}", JsonSerializer.Serialize(this._durableClient.RaisedPayload));
            CollectionAssert.DoesNotContain(this._storageCalls, "ReadInput:11");
        }

        [TestMethod]
        public async Task ReplayRefusesARunningInstanceUnlessAskedToTerminateIt()
        {
            // Arrange

            this.SetStatus(OrchestrationRuntimeStatus.Running);

            // Act

            var response = await this.Function.DfmReplayFunction(new FakeJsonRequest("{ \"sequenceNumber\": 11 }"), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "terminateIfRunning");
            CollectionAssert.DoesNotContain(this._storageCalls, "Truncate:11");
        }

        [TestMethod]
        public async Task ReplayTerminatesARunningInstanceFirstWhenAsked()
        {
            // Arrange

            this.SetStatus(OrchestrationRuntimeStatus.Running);
            var request = new FakeJsonRequest("{ \"sequenceNumber\": 11, \"terminateIfRunning\": true }");

            // Act

            var response = await this.Function.DfmReplayFunction(request, this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            CollectionAssert.AreEqual(
                new[] { $"Get:{InstanceId}", $"Terminate:{InstanceId}", $"Wait:{InstanceId}", $"Raise:{InstanceId}:Approval2" },
                this._durableClient.Calls);
            CollectionAssert.AreEqual(new[] { "ReadInput:11", "Truncate:11" }, this._storageCalls);
        }

        [TestMethod]
        public async Task ReplayRefusesTheInitialInput()
        {
            // Act

            var response = await this.Function.DfmReplayFunction(new FakeJsonRequest("{ \"sequenceNumber\": 1 }"), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "restart-in-place");
        }

        [TestMethod]
        public async Task ReplayAnswers400WhenTheProviderDoesNotSupportIt()
        {
            // Arrange

            this._extensionPoints.TruncateHistoryRoutine = null;

            // Act

            var response = await this.Function.DfmReplayFunction(new FakeJsonRequest("{ \"sequenceNumber\": 11 }"), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [TestMethod]
        public async Task ReplayReportsATruncatedButNotRaisedInstance()
        {
            // Arrange

            this._durableClient.RaiseEventException = new InvalidOperationException("instance is not running");

            // Act

            var response = await this.Function.DfmReplayFunction(new FakeJsonRequest("{ \"sequenceNumber\": 11 }"), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);

            var result = await ReadJsonAsync(response);
            Assert.IsFalse(result.Value<bool>("raised"));
            Assert.AreEqual("Approval2", result.Value<string>("eventName"));
            Assert.IsFalse(result["input"].Value<bool>("ok"));
        }

        [TestMethod]
        public async Task StorageConflictsSurfaceAs409AndPayloadSizeAs413()
        {
            // Arrange

            this._extensionPoints.UpdateHistoryEventInputRoutine = (client, connName, hubName, instanceId, sequenceNumber, inputJson) => throw new DfmConflictException("modified concurrently");
            this._extensionPoints.TruncateHistoryRoutine = (client, connName, hubName, instanceId, sequenceNumber) => throw new DfmPayloadTooLargeException("too large");

            // Act

            var updateResponse = await this.Function.DfmUpdateInputAndRewindFunction(new FakeJsonRequest("{ \"sequenceNumber\": 11, \"input\": 1 }"), this._durableClient, "-", HubName, InstanceId);
            var replayResponse = await this.Function.DfmReplayFunction(new FakeJsonRequest("{ \"sequenceNumber\": 11 }"), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.Conflict, updateResponse.StatusCode);
            Assert.AreEqual(HttpStatusCode.RequestEntityTooLarge, replayResponse.StatusCode);
        }

        private InputEvents Function => new InputEvents(this._settings, this._extensionPoints, NullLoggerFactory.Instance);

        private void SetStatus(OrchestrationRuntimeStatus status)
        {
            this._durableClient.Metadata = new OrchestrationMetadata("MyOrchestrator", InstanceId)
            {
                RuntimeStatus = status,
                SerializedInput = "{\"a\":1}"
            };
        }

        private void UseHistoryWithoutRaisedEvents()
        {
            this._history = new List<HistoryEvent>
            {
                Event(1, "ExecutionStarted", "MyOrchestrator", "{\"a\":1}"),
                Event(2, "TaskScheduled", "Activity1"),
                Event(5, "ExecutionCompleted")
            };
        }

        private static HistoryEvent Event(long sequenceNumber, string eventType, string name = null, string input = null)
        {
            return new HistoryEvent { SequenceNumber = sequenceNumber, EventType = eventType, Name = name, Input = input, Timestamp = DateTimeOffset.UtcNow };
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
            return JObject.Parse(await ReadBodyAsync(response));
        }

        // A request with a JSON body
        private class FakeJsonRequest : FakeHttpRequestData
        {
            private readonly MemoryStream _body;

            public FakeJsonRequest(string body = null) : base(new Uri("http://localhost"))
            {
                this._body = new MemoryStream(Encoding.UTF8.GetBytes(body ?? string.Empty));
            }

            public override Stream Body => this._body;
        }

        // Records what the endpoints ask the Durable client to do, in order
        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public OrchestrationMetadata Metadata { get; set; }

            public List<string> Calls { get; } = new List<string>();

            public object ScheduledInput { get; private set; }
            public object RaisedPayload { get; private set; }

            public Exception ScheduleException { get; set; }
            public Exception RewindException { get; set; }
            public Exception RaiseEventException { get; set; }

            public override Task<OrchestrationMetadata> GetInstancesAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Get:{instanceId}");
                return Task.FromResult(this.Metadata);
            }

            // The client's single-argument call binds to this overload
            public override Task<PurgeResult> PurgeInstanceAsync(string instanceId, PurgeInstanceOptions options, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Purge:{instanceId}");
                return Task.FromResult(new PurgeResult(1));
            }

            public override Task<PurgeResult> PurgeInstanceAsync(string instanceId, CancellationToken cancellation = default)
            {
                return this.PurgeInstanceAsync(instanceId, null, cancellation);
            }

            public override Task<string> ScheduleNewOrchestrationInstanceAsync(TaskName orchestratorName, object input = null, StartOrchestrationOptions options = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Schedule:{orchestratorName.Name}:{options?.InstanceId}");

                if (this.ScheduleException != null)
                {
                    throw this.ScheduleException;
                }

                this.ScheduledInput = input;
                return Task.FromResult(options?.InstanceId);
            }

            public override Task RaiseEventAsync(string instanceId, string eventName, object eventPayload = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Raise:{instanceId}:{eventName}");

                if (this.RaiseEventException != null)
                {
                    throw this.RaiseEventException;
                }

                this.RaisedPayload = eventPayload;
                return Task.CompletedTask;
            }

            public override Task TerminateInstanceAsync(string instanceId, object output = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Terminate:{instanceId}");
                return Task.CompletedTask;
            }

            public override Task<OrchestrationMetadata> WaitForInstanceCompletionAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Wait:{instanceId}");
                return Task.FromResult(this.Metadata);
            }

            public override Task RewindInstanceAsync(string instanceId, string reason, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Rewind:{instanceId}:{reason}");

                if (this.RewindException != null)
                {
                    throw this.RewindException;
                }

                return Task.CompletedTask;
            }
        }
    }
}
