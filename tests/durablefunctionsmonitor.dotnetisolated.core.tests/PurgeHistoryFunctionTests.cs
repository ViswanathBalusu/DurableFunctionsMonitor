// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// <see cref="PurgeHistory.DfmPurgeHistoryFunction"/>: the filter it passes to the Durable client and
    /// the shape of what it answers with. The count is the whole report of a purge - it cannot be counted
    /// beforehand and cannot be undone - so the field name the client reads is load bearing.
    /// </summary>
    [TestClass]
    public class PurgeHistoryFunctionTests
    {
        private const string HubName = "TestHub";

        private StubDurableTaskClient _durableClient;

        [TestInitialize]
        public void TestInit()
        {
            this._durableClient = new StubDurableTaskClient();
        }

        [TestMethod]
        public async Task ReportsTheCountAsInstancesDeleted()
        {
            this._durableClient.PurgedInstanceCount = 412;

            var body = Body("2026-09-04T12:00:00Z", "2026-09-05T12:00:00Z", "\"Completed\", \"Failed\"");

            var response = await this.Function.DfmPurgeHistoryFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            var json = ReadJson(response);

            // contracts §6: `{ instancesDeleted }`. PurgeResult calls it PurgedInstanceCount, which is a
            // field no client of this API has ever read.
            Assert.AreEqual(412, (int)json["instancesDeleted"]);
            Assert.IsNull(json["purgedInstanceCount"]);
        }

        [TestMethod]
        public async Task PassesTheWindowAndTheStatusesToTheClient()
        {
            var body = Body("2026-09-04T12:00:00Z", "2026-09-05T12:00:00Z", "\"Terminated\"");

            await this.Function.DfmPurgeHistoryFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            var filter = this._durableClient.LastFilter;

            Assert.IsNotNull(filter);
            Assert.AreEqual(DateTimeOffset.Parse("2026-09-04T12:00:00Z"), filter.CreatedFrom);
            Assert.AreEqual(DateTimeOffset.Parse("2026-09-05T12:00:00Z"), filter.CreatedTo);
            CollectionAssert.AreEqual(
                new[] { OrchestrationRuntimeStatus.Terminated },
                new System.Collections.Generic.List<OrchestrationRuntimeStatus>(filter.Statuses));
        }

        [TestMethod]
        public async Task RefusesEntitiesRatherThanPurgingOrchestrationsInstead()
        {
            var body = "{ \"timeFrom\": \"2026-09-04T12:00:00Z\", \"timeTill\": \"2026-09-05T12:00:00Z\", " +
                "\"statuses\": [\"Completed\"], \"entityType\": \"DurableEntity\" }";

            var response = await this.Function.DfmPurgeHistoryFunction(new FakeJsonRequest(body), this._durableClient, "-", HubName);

            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.IsNull(this._durableClient.LastFilter);
        }

        private PurgeHistory Function => new PurgeHistory(new DfmSettings(), new DfmExtensionPoints());

        private static string Body(string timeFrom, string timeTill, string statuses)
        {
            return $"{{ \"timeFrom\": \"{timeFrom}\", \"timeTill\": \"{timeTill}\", \"statuses\": [{statuses}], " +
                "\"entityType\": \"Orchestration\" }";
        }

        private static JObject ReadJson(Microsoft.Azure.Functions.Worker.Http.HttpResponseData response)
        {
            response.Body.Position = 0;
            return JObject.Parse(new StreamReader(response.Body).ReadToEnd());
        }

        private class FakeJsonRequest : FakeHttpRequestData
        {
            private readonly MemoryStream _body;

            public FakeJsonRequest(string body) : base(new Uri("http://localhost"))
            {
                this._body = new MemoryStream(Encoding.UTF8.GetBytes(body ?? string.Empty));
            }

            public override Stream Body => this._body;
        }

        private class StubDurableTaskClient : FakeDurableTaskClient
        {
            public int PurgedInstanceCount { get; set; }

            public PurgeInstancesFilter LastFilter { get; private set; }

            // The two-argument overload the endpoint calls is not virtual: it forwards to this one
            public override Task<PurgeResult> PurgeAllInstancesAsync(
                PurgeInstancesFilter filter, PurgeInstanceOptions options, CancellationToken cancellation = default)
            {
                this.LastFilter = filter;
                return Task.FromResult(new PurgeResult(this.PurgedInstanceCount));
            }
        }
    }
}
