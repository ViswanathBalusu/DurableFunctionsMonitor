// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.DurableTask.Client.Entities;
using Microsoft.DurableTask.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// <see cref="OrchestrationActions.ExecuteAsync"/>, the code shared by the single-instance endpoint
    /// (<see cref="Orchestration.DfmPostOrchestrationFunction"/>) and (from B3-S3-T2 on) the batch endpoint - and,
    /// through the end-to-end tests below, proof that extracting it did not change what the single-instance
    /// endpoint asks the Durable Task client (or the Instances table) to do for any of the eight actions.
    /// </summary>
    [TestClass]
    public class OrchestrationActionsTests
    {
        private const string InstanceId = "my-instance";
        private const string HubName = "TestHub";

        private StubDurableTaskClient _durableClient;

        [TestInitialize]
        public void TestInit()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            this._durableClient = new StubDurableTaskClient();
        }

        // ------------------------------------------------------------------
        // Direct tests of OrchestrationActions.ExecuteAsync
        // ------------------------------------------------------------------

        [TestMethod]
        public async Task SuspendPassesTheReasonThrough()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Suspend, Payload(("reason", "taking a break")));

            CollectionAssert.Contains(this._durableClient.Calls, $"Suspend:{InstanceId}:taking a break");
        }

        [TestMethod]
        public async Task ResumePassesTheReasonThrough()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Resume, Payload(("reason", "back now")));

            CollectionAssert.Contains(this._durableClient.Calls, $"Resume:{InstanceId}:back now");
        }

        [TestMethod]
        public async Task PurgeIgnoresThePayload()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Purge, null);

            CollectionAssert.Contains(this._durableClient.Calls, $"Purge:{InstanceId}");
        }

        [TestMethod]
        public async Task RewindPassesTheReasonThrough()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Rewind, Payload(("reason", "retry please")));

            CollectionAssert.Contains(this._durableClient.Calls, $"Rewind:{InstanceId}:retry please");
        }

        [TestMethod]
        public async Task TerminatePassesTheReasonThrough()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Terminate, Payload(("reason", "stop it")));

            CollectionAssert.Contains(this._durableClient.Calls, $"Terminate:{InstanceId}:stop it");
        }

        [TestMethod]
        public async Task RaiseEventGoesToTheOrchestrationClientForAnOrchestration()
        {
            var payload = new JsonObject { ["name"] = "Approval", ["data"] = JsonNode.Parse("{\"ok\":true}") };

            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.RaiseEvent, payload);

            CollectionAssert.Contains(this._durableClient.Calls, $"Raise:{InstanceId}:Approval");
            Assert.AreEqual(0, this._durableClient.FakeEntities.Calls.Count);
        }

        [TestMethod]
        public async Task RaiseEventSignalsTheEntityClientForAnEntity()
        {
            const string entityInstanceId = "@counter@my-key";
            var payload = new JsonObject { ["name"] = "add", ["data"] = 1 };

            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", entityInstanceId, OrchestrationActionNames.RaiseEvent, payload);

            CollectionAssert.Contains(this._durableClient.FakeEntities.Calls, $"Signal:@counter@my-key:add");
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task RaiseEventWithoutNameIsABadRequest()
        {
            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.RaiseEvent, new JsonObject()));

            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task RestartPassesTheFlagThrough()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Restart, Payload(("restartWithNewInstanceId", true)));

            CollectionAssert.Contains(this._durableClient.Calls, $"Restart:{InstanceId}:True");
        }

        [TestMethod]
        public async Task RestartDefaultsTheFlagToFalse()
        {
            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Restart, new JsonObject());

            CollectionAssert.Contains(this._durableClient.Calls, $"Restart:{InstanceId}:False");
        }

        [TestMethod]
        public async Task SetCustomStatusStoresTheFormattedValue()
        {
            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);
            var tableName = $"{this._durableClient.Name}Instances";
            var entity = new TableEntity(InstanceId, string.Empty);

            tableClient.Setup(c => c.GetEntityAsync(tableName, InstanceId, string.Empty)).ReturnsAsync(entity);
            tableClient.Setup(c => c.ReplaceEntityAsync(tableName, entity)).Returns(Task.CompletedTask);
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            var payload = new JsonObject { ["customStatus"] = JsonNode.Parse("{\"step\":2}") };

            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.SetCustomStatus, payload);

            // Exactly what the pre-refactor code stored: JObject.Parse(bodyString).ToString() (Newtonsoft, indented)
            string expected = JObject.Parse("{\"step\":2}").ToString();
            Assert.AreEqual(expected, entity["CustomStatus"]);
            tableClient.VerifyAll();
        }

        [TestMethod]
        public async Task SetCustomStatusWithNoCustomStatusRemovesTheColumn()
        {
            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);
            var tableName = $"{this._durableClient.Name}Instances";
            var entity = new TableEntity(InstanceId, string.Empty) { ["CustomStatus"] = "{}" };

            tableClient.Setup(c => c.GetEntityAsync(tableName, InstanceId, string.Empty)).ReturnsAsync(entity);
            tableClient.Setup(c => c.ReplaceEntityAsync(tableName, entity)).Returns(Task.CompletedTask);
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.SetCustomStatus, new JsonObject());

            Assert.IsFalse(entity.ContainsKey("CustomStatus"));
            tableClient.VerifyAll();
        }

        [TestMethod]
        public async Task SetCustomStatusBumpsLastUpdatedTime()
        {
            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);
            var tableName = $"{this._durableClient.Name}Instances";
            var before = DateTime.UtcNow.AddMinutes(-5);
            var entity = new TableEntity(InstanceId, string.Empty) { ["LastUpdatedTime"] = before };

            tableClient.Setup(c => c.GetEntityAsync(tableName, InstanceId, string.Empty)).ReturnsAsync(entity);
            tableClient.Setup(c => c.ReplaceEntityAsync(tableName, entity)).Returns(Task.CompletedTask);
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            var payload = new JsonObject { ["customStatus"] = JsonNode.Parse("{\"step\":2}") };

            await OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.SetCustomStatus, payload);

            // The details endpoint's ETag is LastUpdatedTime plus the runtime status: without this bump
            // a conditional GET answers 304 and serves the caller the custom status it just replaced.
            Assert.IsTrue(entity.GetDateTime("LastUpdatedTime") > before);
            tableClient.VerifyAll();
        }

        [TestMethod]
        public async Task UnknownActionIsABadRequest()
        {
            await Assert.ThrowsExactlyAsync<DfmBadRequestException>(
                () => OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, "frobnicate", null));

            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        [TestMethod]
        public async Task InvalidOperationExceptionFromTheClientBecomesAConflict()
        {
            this._durableClient.RewindException = new InvalidOperationException("wrong runtime status");

            var ex = await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Rewind, Payload(("reason", "retry"))));

            StringAssert.Contains(ex.Message, "wrong runtime status");
        }

        [TestMethod]
        public async Task InvalidOperationExceptionFromRestartBecomesAConflict()
        {
            this._durableClient.RestartException = new InvalidOperationException("instance is not in a terminal state");

            await Assert.ThrowsExactlyAsync<DfmConflictException>(
                () => OrchestrationActions.ExecuteAsync(this._durableClient, "-", InstanceId, OrchestrationActionNames.Restart, new JsonObject()));
        }

        // ------------------------------------------------------------------
        // End-to-end: DfmPostOrchestrationFunction with the same request bodies it always took,
        // proving the extraction changed nothing about what each of the eight actions asks for.
        // ------------------------------------------------------------------

        [TestMethod]
        public async Task EndToEnd_Suspend_PlainTextReasonBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("taking a break"), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.Suspend);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Suspend:{InstanceId}:taking a break");
        }

        [TestMethod]
        public async Task EndToEnd_Resume_PlainTextReasonBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("back now"), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.Resume);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Resume:{InstanceId}:back now");
        }

        [TestMethod]
        public async Task EndToEnd_Purge_EmptyBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest(string.Empty), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.Purge);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Purge:{InstanceId}");
        }

        [TestMethod]
        public async Task EndToEnd_Rewind_PlainTextReasonBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("retry please"), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.Rewind);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Rewind:{InstanceId}:retry please");
        }

        [TestMethod]
        public async Task EndToEnd_Terminate_PlainTextReasonBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("stop it"), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.Terminate);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Terminate:{InstanceId}:stop it");
        }

        [TestMethod]
        public async Task EndToEnd_RaiseEvent_NameAndDataJsonBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("{ \"name\": \"Approval\", \"data\": { \"ok\": true } }"), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.RaiseEvent);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Raise:{InstanceId}:Approval");
        }

        [TestMethod]
        public async Task EndToEnd_RaiseEvent_SignalsAnEntity()
        {
            const string entityInstanceId = "@counter@my-key";

            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("{ \"name\": \"add\", \"data\": 1 }"), this._durableClient, "-", HubName, entityInstanceId, OrchestrationActionNames.RaiseEvent);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.FakeEntities.Calls, "Signal:@counter@my-key:add");
        }

        [TestMethod]
        public async Task EndToEnd_SetCustomStatus_ArbitraryJsonBody()
        {
            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);
            var tableName = $"{this._durableClient.Name}Instances";
            var entity = new TableEntity(InstanceId, string.Empty);

            tableClient.Setup(c => c.GetEntityAsync(tableName, InstanceId, string.Empty)).ReturnsAsync(entity);
            tableClient.Setup(c => c.ReplaceEntityAsync(tableName, entity)).Returns(Task.CompletedTask);
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            string body = "{\"step\":2,\"note\":\"halfway\"}";
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest(body), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.SetCustomStatus);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            // Byte-for-byte what the pre-refactor code stored
            string expected = JObject.Parse(body).ToString();
            Assert.AreEqual(expected, entity["CustomStatus"]);
        }

        [TestMethod]
        public async Task EndToEnd_SetCustomStatus_EmptyBodyRemovesTheColumn()
        {
            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);
            var tableName = $"{this._durableClient.Name}Instances";
            var entity = new TableEntity(InstanceId, string.Empty) { ["CustomStatus"] = "{}" };

            tableClient.Setup(c => c.GetEntityAsync(tableName, InstanceId, string.Empty)).ReturnsAsync(entity);
            tableClient.Setup(c => c.ReplaceEntityAsync(tableName, entity)).Returns(Task.CompletedTask);
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest(string.Empty), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.SetCustomStatus);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.IsFalse(entity.ContainsKey("CustomStatus"));
        }

        [TestMethod]
        public async Task EndToEnd_Restart_FlagJsonBody()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest("{ \"restartWithNewInstanceId\": true }"), this._durableClient, "-", HubName, InstanceId, OrchestrationActionNames.Restart);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            CollectionAssert.Contains(this._durableClient.Calls, $"Restart:{InstanceId}:True");
        }

        [TestMethod]
        public async Task EndToEnd_UnknownActionIsStillNotFound()
        {
            var response = await this.Function.DfmPostOrchestrationFunction(new FakeTextRequest(string.Empty), this._durableClient, "-", HubName, InstanceId, "frobnicate");

            // Unchanged: the single-instance route never delegates a genuinely unknown action to
            // OrchestrationActions (whose own 'unknown action' branch only the batch endpoint can reach)
            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
            Assert.AreEqual(0, this._durableClient.Calls.Count);
        }

        private Orchestration Function => new Orchestration(new DfmSettings(), new DfmExtensionPoints(), NullLoggerFactory.Instance);

        private static JsonObject Payload(params (string Name, object Value)[] properties)
        {
            var result = new JsonObject();
            foreach (var (name, value) in properties)
            {
                result[name] = value switch
                {
                    null => null,
                    bool b => JsonValue.Create(b),
                    string s => JsonValue.Create(s),
                    _ => JsonValue.Create(value)
                };
            }

            return result;
        }

        // A request with a plain-text or JSON body, same shape as the pre-refactor bodies
        private class FakeTextRequest : FakeHttpRequestData
        {
            private readonly MemoryStream _body;

            public FakeTextRequest(string body) : base(new Uri("http://localhost"))
            {
                this._body = new MemoryStream(Encoding.UTF8.GetBytes(body ?? string.Empty));
            }

            public override Stream Body => this._body;
        }

        // Records what the endpoints ask the Durable Task client (and its Entities client) to do, in order
        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public List<string> Calls { get; } = new List<string>();

            public FakeDurableEntityClient FakeEntities { get; } = new FakeDurableEntityClient();

            public Exception RewindException { get; set; }
            public Exception RestartException { get; set; }

            public override DurableEntityClient Entities => this.FakeEntities;

            public override Task SuspendInstanceAsync(string instanceId, string reason = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Suspend:{instanceId}:{reason}");
                return Task.CompletedTask;
            }

            public override Task ResumeInstanceAsync(string instanceId, string reason = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Resume:{instanceId}:{reason}");
                return Task.CompletedTask;
            }

            // The single-argument call from OrchestrationActions binds to this overload
            public override Task<PurgeResult> PurgeInstanceAsync(string instanceId, PurgeInstanceOptions options, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Purge:{instanceId}");
                return Task.FromResult(new PurgeResult(1));
            }

            public override Task<PurgeResult> PurgeInstanceAsync(string instanceId, CancellationToken cancellation = default)
            {
                return this.PurgeInstanceAsync(instanceId, null, cancellation);
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

            // The single-argument-plus-reason call from OrchestrationActions binds to this overload (object output)
            public override Task TerminateInstanceAsync(string instanceId, object output = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Terminate:{instanceId}:{output}");
                return Task.CompletedTask;
            }

            public override Task RaiseEventAsync(string instanceId, string eventName, object eventPayload = null, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Raise:{instanceId}:{eventName}");
                return Task.CompletedTask;
            }

            public override Task<string> RestartAsync(string instanceId, bool restartWithNewInstanceId = false, CancellationToken cancellation = default)
            {
                this.Calls.Add($"Restart:{instanceId}:{restartWithNewInstanceId}");

                if (this.RestartException != null)
                {
                    throw this.RestartException;
                }

                return Task.FromResult(instanceId);
            }
        }

        // A minimal Entities client that only records SignalEntityAsync calls; everything else this class
        // never exercises throws, same as the rest of the Fake* client hierarchy.
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
