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
    /// GET orchestrations('{id}')/children, driven through a stubbed children routine: the
    /// ChildrenResponse shape of contracts section 6 and every validation branch of B1-S3-T1
    /// (entity id, unknown instance, a provider without a children routine).
    ///
    /// How the children are actually found is per provider and is specified by the Azurite
    /// ChildrenTests (Azure Storage) and by the MSSQL package's own query.
    /// </summary>
    [TestClass]
    public class ChildrenFunctionTests
    {
        private const string InstanceId = "parent-instance";
        private const string HubName = "TestHub";

        private StubDurableTaskClient _durableClient;
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private ChildrenResult _childrenToReturn;
        private readonly List<string> _routineCalls = new List<string>();

        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            TableClient.MockedTableClient = null;

            this._durableClient = new StubDurableTaskClient
            {
                Metadata = new OrchestrationMetadata("ProcessOrderOrchestrator", InstanceId)
                {
                    RuntimeStatus = OrchestrationRuntimeStatus.Running
                }
            };

            this._settings = new DfmSettings();

            this._childrenToReturn = new ChildrenResult
            {
                Children = new List<ChildInstance>
                {
                    new ChildInstance
                    {
                        InstanceId = "exec-1:0",
                        Name = "ReserveInventory",
                        RuntimeStatus = "Completed",
                        CreatedTime = T("10:00:00"),
                        LastUpdatedTime = T("10:00:05")
                    }
                },
                Complete = false
            };

            this._routineCalls.Clear();

            this._extensionPoints = new DfmExtensionPoints
            {
                GetChildrenRoutine = (client, connEnvVariableName, hubName, instanceId) =>
                {
                    this._routineCalls.Add($"{connEnvVariableName}|{hubName}|{instanceId}");
                    return Task.FromResult(this._childrenToReturn);
                }
            };
        }

        [TestMethod]
        public async Task ReturnsTheChildrenInTheContractedShape()
        {
            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);

            // Every field of contracts section 6 ChildrenResponse, camelCase, none missing
            CollectionAssert.AreEquivalent(new[] { "children", "complete" }, result.Properties().Select(p => p.Name).ToArray());

            var child = (JObject)((JArray)result["children"]).Single();
            CollectionAssert.AreEquivalent(
                new[] { "instanceId", "name", "runtimeStatus", "createdTime", "lastUpdatedTime" },
                child.Properties().Select(p => p.Name).ToArray());

            Assert.AreEqual("exec-1:0", child.Value<string>("instanceId"));
            Assert.AreEqual("ReserveInventory", child.Value<string>("name"));
            Assert.AreEqual("Completed", child.Value<string>("runtimeStatus"));
            Assert.AreEqual("2026-09-04T10:00:00Z", child.Value<string>("createdTime"));
            Assert.AreEqual("2026-09-04T10:00:05Z", child.Value<string>("lastUpdatedTime"));

            // Azure Storage matches generated child ids, so it can never promise the list is exhaustive
            Assert.IsFalse(result.Value<bool>("complete"));
        }

        [TestMethod]
        public async Task PassesTheFullConnectionEnvVariableNameHubAndInstanceToTheRoutine()
        {
            // Act

            await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual($"AzureWebJobsStorage|{HubName}|{InstanceId}", this._routineCalls.Single());
        }

        [TestMethod]
        public async Task ReportsCompleteWhenTheProviderGuaranteesIt()
        {
            // Arrange: MSSQL reads the ParentInstanceID column, so it finds explicitly named children too

            this._childrenToReturn.Complete = true;

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.IsTrue((await ReadJsonAsync(response)).Value<bool>("complete"));
        }

        [TestMethod]
        public async Task AnInstanceWithoutChildrenIsAnEmptyList()
        {
            // Arrange

            this._childrenToReturn = new ChildrenResult();

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
            Assert.AreEqual(0, ((JArray)(await ReadJsonAsync(response))["children"]).Count);
        }

        [TestMethod]
        public async Task ARoutineThatReturnsNothingIsAnEmptyListToo()
        {
            // Arrange: a custom routine may answer null; that means 'no children', not 'crash'

            this._extensionPoints.GetChildrenRoutine = (client, connEnvVariableName, hubName, instanceId) => Task.FromResult<ChildrenResult>(null);

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var result = await ReadJsonAsync(response);
            Assert.AreEqual(0, ((JArray)result["children"]).Count);
            Assert.IsFalse(result.Value<bool>("complete"));
        }

        [TestMethod]
        public async Task ReturnsNotFoundWhenTheInstanceDoesNotExist()
        {
            // Arrange

            this._durableClient.Metadata = null;

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), InstanceId);
            Assert.AreEqual(0, this._routineCalls.Count);
        }

        [TestMethod]
        public async Task ReturnsBadRequestForAnEntityInstance()
        {
            // Arrange: an entity is not an orchestrator, it never starts a sub-orchestration (B1-S3-T1)

            const string EntityId = "@counter@warehouse-07";

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, EntityId);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), EntityId);
            Assert.AreEqual(0, this._routineCalls.Count);
        }

        [TestMethod]
        public async Task ReturnsBadRequestWhenTheProviderHasNoChildrenRoutine()
        {
            // Arrange: Netherite has none, and /about reports capabilities.children == false for the same reason

            this._extensionPoints.GetChildrenRoutine = null;

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "not supported for this storage provider");
        }

        [TestMethod]
        public async Task AFailingRoutineIsAnInternalServerError()
        {
            // Arrange

            this._extensionPoints.GetChildrenRoutine = (client, connEnvVariableName, hubName, instanceId) =>
                throw new DfmStorageException("Table Instances is unavailable", inner: null);

            // Act

            var response = await this.Function.DfmGetOrchestrationChildrenFunction(Request(), this._durableClient, "-", HubName, InstanceId);

            // Assert

            Assert.AreEqual(HttpStatusCode.InternalServerError, response.StatusCode);
            StringAssert.Contains(await ReadBodyAsync(response), "Table Instances is unavailable");
        }

        [TestMethod]
        public void IsMarkedAsAReadOperation()
        {
            // Arrange

            var method = typeof(DurableFunctionsMonitor.DotNetIsolated.Children)
                .GetMethod(nameof(DurableFunctionsMonitor.DotNetIsolated.Children.DfmGetOrchestrationChildrenFunction));

            // Act

            var attribute = (OperationKindAttribute)method.GetCustomAttributes(typeof(OperationKindAttribute), false).Single();

            // Assert

            Assert.AreEqual(OperationKind.Read, attribute.Kind);
        }

        #region Fixture helpers

        private DurableFunctionsMonitor.DotNetIsolated.Children Function
        {
            get { return new DurableFunctionsMonitor.DotNetIsolated.Children(this._settings, this._extensionPoints, NullLoggerFactory.Instance); }
        }

        private static FakeHttpRequestData Request()
        {
            return new FakeHttpRequestData(new Uri($"http://localhost/a/p/i/--{HubName}/orchestrations('{InstanceId}')/children"));
        }

        private static DateTimeOffset T(string timeOfDay)
        {
            return DateTimeOffset.Parse(
                "2026-09-04T" + timeOfDay + "Z",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal);
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

            public override Task<OrchestrationMetadata> GetInstancesAsync(string instanceId, bool getInputsAndOutputs = false, CancellationToken cancellation = default)
            {
                return Task.FromResult(this.Metadata);
            }
        }

        #endregion
    }
}
