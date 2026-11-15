// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// GET /orchestrations and where it gets its instances from: the storage provider's routine when there is
    /// one and it takes the query, the DurableTaskClient otherwise - and what it tells the routine about how
    /// much of the list it is going to read, because that is what decides whether reading ahead is a gain (a
    /// sorted list is read whole) or a scan of a table for a caller who wanted fifty rows of it.
    /// </summary>
    [TestClass]
    public class OrchestrationsFunctionTests
    {
        private const string HubName = "Hub";

        private static readonly DateTimeOffset T0 = new DateTimeOffset(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);

        private DfmExtensionPoints _extensionPoints;
        private ListingClient _client;
        private RecordingLog _log;

        // What the routine was asked, and how much of its answer was taken
        private List<(OrchestrationQuery query, bool readToEnd, string connEnvVariableName, string hubName)> _routineCalls;
        private int _taken;

        [TestInitialize]
        public void TestInit()
        {
            this._extensionPoints = new DfmExtensionPoints();
            this._client = new ListingClient();
            this._log = new RecordingLog();
            this._routineCalls = new List<(OrchestrationQuery, bool, string, string)>();
            this._taken = 0;
        }

        // An instance that was created so many minutes in, by an orchestrator that depends on that number
        private static OrchestrationMetadata Instance(int minute, OrchestrationRuntimeStatus status = OrchestrationRuntimeStatus.Completed)
        {
            return new OrchestrationMetadata($"Orchestrator{minute % 3}", $"instance-{minute:D5}")
            {
                CreatedAt = T0.AddMinutes(minute),
                LastUpdatedAt = T0.AddMinutes(minute).AddSeconds(30),
                RuntimeStatus = status
            };
        }

        // The storage provider's routine: a list that is read only as far as it is enumerated
        private void TheRoutineLists(IEnumerable<OrchestrationMetadata> instances)
        {
            this._extensionPoints.ListInstancesRoutine = (client, connEnvVariableName, hubName, query, readToEnd) =>
            {
                this._routineCalls.Add((query, readToEnd, connEnvVariableName, hubName));

                return this.Lazily(instances);
            };
        }

        private async IAsyncEnumerable<OrchestrationMetadata> Lazily(IEnumerable<OrchestrationMetadata> instances)
        {
            foreach (var instance in instances)
            {
                // A real one waits for its storage here
                await Task.Yield();

                this._taken++;

                yield return instance;
            }
        }

        // A routine whose list fails once so many instances of it have been taken
        private void TheRoutineFailsAfter(IEnumerable<OrchestrationMetadata> instances, Exception failure)
        {
            this._extensionPoints.ListInstancesRoutine = (client, connEnvVariableName, hubName, query, readToEnd) =>
            {
                this._routineCalls.Add((query, readToEnd, connEnvVariableName, hubName));

                return this.LazilyAndThenFail(instances, failure);
            };
        }

        private async IAsyncEnumerable<OrchestrationMetadata> LazilyAndThenFail(IEnumerable<OrchestrationMetadata> instances, Exception failure)
        {
            await foreach (var instance in this.Lazily(instances))
            {
                yield return instance;
            }

            await Task.Yield();

            throw failure;
        }

        private async Task<string[]> GetIdsAsync(string queryString)
        {
            var request = new FakeHttpRequestData(new Uri($"http://localhost/a/p/i/--{HubName}/orchestrations{queryString}"));

            var response = await new Orchestrations(new DfmSettings(), this._extensionPoints, this._log)
                .DfmGetOrchestrationsFunction(request, this._client, "-", HubName);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            return JArray.Parse(await ReadBodyAsync(response)).Select(instance => instance.Value<string>("instanceId")).ToArray();
        }

        private static async Task<string> ReadBodyAsync(HttpResponseData response)
        {
            response.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(response.Body))
            {
                return await reader.ReadToEndAsync();
            }
        }

        [TestMethod]
        public async Task ASortedPageIsReadFromTheWholeListAndSaysSo()
        {
            this.TheRoutineLists(Enumerable.Range(0, 2500).Select(i => Instance(i)));

            // What the Instances screen opens with
            var ids = await this.GetIdsAsync("?$top=50&$skip=0&$orderby=createdTime desc&hidden-columns=input|output");

            // The fifty newest, which are the last fifty of the list
            CollectionAssert.AreEqual(Enumerable.Range(0, 50).Select(i => $"instance-{2499 - i:D5}").ToArray(), ids);

            var call = this._routineCalls.Single();

            Assert.IsTrue(call.readToEnd, "a sorted list is read to its end, and the routine should know");
            Assert.AreEqual(2500, this._taken);

            // The routine did the listing, and not the client next to it
            Assert.AreEqual(0, this._client.Queries.Count);
        }

        [TestMethod]
        public async Task AnUnsortedPageStopsWhereItStopsAskingAndSaysSo()
        {
            this.TheRoutineLists(Enumerable.Range(0, 5000).Select(i => Instance(i)));

            // What the Histogram view walks the list with
            var ids = await this.GetIdsAsync("?$top=1000&$skip=1000&hidden-columns=input|output|customStatus");

            CollectionAssert.AreEqual(Enumerable.Range(1000, 1000).Select(i => $"instance-{i:D5}").ToArray(), ids);

            var call = this._routineCalls.Single();

            Assert.IsFalse(call.readToEnd, "this request may stop early, and the routine should know not to read ahead");

            // It took the two thousand it needed (in batches of a thousand), and left the other three thousand alone
            Assert.IsTrue(this._taken >= 2000 && this._taken <= 3000, $"{this._taken} of 5000 instances were taken for the second thousand");
        }

        [TestMethod]
        public async Task ARequestForAllOfItReadsToTheEndAndSaysSo()
        {
            this.TheRoutineLists(Enumerable.Range(0, 1200).Select(i => Instance(i)));

            var ids = await this.GetIdsAsync("?hidden-columns=input|output");

            Assert.AreEqual(1200, ids.Length);
            Assert.IsTrue(this._routineCalls.Single().readToEnd);
        }

        [TestMethod]
        public async Task TheRoutineIsGivenTheQueryTheClientWouldHaveBeenGiven()
        {
            this.TheRoutineLists(new[] { Instance(5, OrchestrationRuntimeStatus.Failed), Instance(6, OrchestrationRuntimeStatus.Running) });

            await this.GetIdsAsync(
                "?$top=50&$skip=0" +
                "&$filter=createdTime ge '2026-11-14T10:00:00.000Z' and createdTime le '2026-11-14T11:30:00.500Z' and runtimeStatus in ('Failed','Running','DurableEntities')" +
                "&$orderby=createdTime desc&hidden-columns=input|output");

            var call = this._routineCalls.Single();

            Assert.AreEqual(T0, call.query.CreatedFrom);
            Assert.AreEqual(T0.AddMinutes(90).AddMilliseconds(500), call.query.CreatedTo);

            // The statuses an orchestration can have; the entities are another list
            CollectionAssert.AreEqual(
                new[] { OrchestrationRuntimeStatus.Failed, OrchestrationRuntimeStatus.Running },
                call.query.Statuses.ToArray());

            Assert.IsFalse(call.query.FetchInputsAndOutputs);

            // And where to look: the connection of the request, and its hub
            Assert.AreEqual(Globals.GetFullConnectionStringEnvVariableName("-"), call.connEnvVariableName);
            Assert.AreEqual(HubName, call.hubName);
        }

        [TestMethod]
        public async Task AListThatShowsItsInputsAsksForThem()
        {
            this.TheRoutineLists(new[] { Instance(1) });

            await this.GetIdsAsync("?$top=50&$skip=0&$orderby=createdTime desc&hidden-columns=output");

            Assert.IsTrue(this._routineCalls.Single().query.FetchInputsAndOutputs);
        }

        [TestMethod]
        public async Task AQueryTheRoutineDoesNotTakeIsTheClients()
        {
            // 'Not mine' is a null
            this._extensionPoints.ListInstancesRoutine = (client, connEnvVariableName, hubName, query, readToEnd) =>
            {
                this._routineCalls.Add((query, readToEnd, connEnvVariableName, hubName));

                return null;
            };

            this._client.Instances = new[] { Instance(3), Instance(1), Instance(2) };

            var ids = await this.GetIdsAsync("?$top=50&$skip=0&$orderby=createdTime asc");

            CollectionAssert.AreEqual(new[] { "instance-00001", "instance-00002", "instance-00003" }, ids);

            // Asked once, and the same query then went to the client
            Assert.AreEqual(1, this._routineCalls.Count);
            Assert.AreSame(this._routineCalls[0].query, this._client.Queries.Single());
        }

        [TestMethod]
        public async Task WithoutARoutineTheClientLists()
        {
            // What a storage provider without a table of instances sets
            this._extensionPoints.ListInstancesRoutine = null;

            this._client.Instances = new[] { Instance(2), Instance(1) };

            var ids = await this.GetIdsAsync("?$top=50&$skip=0&$orderby=createdTime desc");

            CollectionAssert.AreEqual(new[] { "instance-00002", "instance-00001" }, ids);
            Assert.AreEqual(1, this._client.Queries.Count);
        }

        [TestMethod]
        [DataRow("?$top=50&$skip=0&$orderby=createdTime asc")]
        [DataRow("?$top=50&$skip=0")]
        public async Task ARoutineThatCannotGetAtItsStorageIsReplacedByTheClient(string queryString)
        {
            // What the default routine is for a Task Hub that is not kept in Azure Storage tables, when the
            // setup of its storage provider did not take the routine out: its first request has no table to read
            var noSuchTable = new Azure.RequestFailedException(404, "The table specified does not exist.");

            this.TheRoutineFailsAfter(Array.Empty<OrchestrationMetadata>(), noSuchTable);

            this._client.Instances = new[] { Instance(1), Instance(2) };

            var ids = await this.GetIdsAsync(queryString);

            // The list is the client's, as it was before there was a routine
            CollectionAssert.AreEqual(new[] { "instance-00001", "instance-00002" }, ids);

            Assert.AreSame(this._routineCalls.Single().query, this._client.Queries.Single());

            // And the log says what happened, and what to do about it
            var warning = this._log.Warnings.Single(w => w.message.Contains(nameof(DfmExtensionPoints.ListInstancesRoutine)));

            StringAssert.Contains(warning.message, HubName);
            Assert.AreSame(noSuchTable, warning.exception);
        }

        [TestMethod]
        public async Task ARoutineThatFailsHalfwayFailsTheRequest()
        {
            // Instances of it have been returned by then: the client's list would return them again
            this.TheRoutineFailsAfter(Enumerable.Range(0, 3).Select(i => Instance(i)), new InvalidOperationException("the storage went away"));

            this._client.Instances = new[] { Instance(1), Instance(2) };

            var failure = await Assert.ThrowsAsync<Exception>(() => this.GetIdsAsync("?$top=50&$skip=0&$orderby=createdTime asc"));

            Assert.IsInstanceOfType<InvalidOperationException>(failure.GetBaseException());
            Assert.AreEqual("the storage went away", failure.GetBaseException().Message);

            Assert.AreEqual(0, this._client.Queries.Count);
            Assert.IsFalse(this._log.Warnings.Any(w => w.message.Contains(nameof(DfmExtensionPoints.ListInstancesRoutine))));
        }

        [TestMethod]
        public async Task AnEmptyListFromTheRoutineIsAnAnswer()
        {
            // No instances is not 'could not list them'
            this.TheRoutineLists(Array.Empty<OrchestrationMetadata>());

            this._client.Instances = new[] { Instance(1) };

            var ids = await this.GetIdsAsync("?$top=50&$skip=0&$orderby=createdTime desc");

            Assert.AreEqual(0, ids.Length);
            Assert.AreEqual(0, this._client.Queries.Count);
        }

        [TestMethod]
        [DataRow("$top=50&$skip=0&$orderby=createdTime desc", true)]
        [DataRow("$top=50&$orderby=name", true)]
        [DataRow("$orderby=createdTime asc", true)]
        // No $top: all of it is returned
        [DataRow("$skip=100", true)]
        [DataRow("", true)]
        [DataRow("$top=&$skip=0", true)]
        // A page of the list as it comes
        [DataRow("$top=50&$skip=0", false)]
        [DataRow("$top=1000&$skip=5000&hidden-columns=input|output", false)]
        [DataRow("$top=50&$orderby=", false)]
        [DataRow("$top=1", false)]
        public void OnlyASortedListOrAllOfItIsReadToTheEnd(string queryString, bool expected)
        {
            NameValueCollection query = System.Web.HttpUtility.ParseQueryString(queryString);

            Assert.AreEqual(expected, query.ReadsTheListToItsEnd());
        }

        /// <summary>The log of the function, kept: what it warns about is part of what it does.</summary>
        private sealed class RecordingLog : ILoggerFactory, ILogger
        {
            private readonly List<(string message, Exception exception)> _warnings = new List<(string, Exception)>();

            public IReadOnlyList<(string message, Exception exception)> Warnings
            {
                get { lock (this._warnings) { return this._warnings.ToList(); } }
            }

            public void AddProvider(ILoggerProvider provider) { }

            public ILogger CreateLogger(string categoryName) => this;

            public void Dispose() { }

            public IDisposable BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception exception, Func<TState, Exception, string> formatter)
            {
                if (logLevel == LogLevel.Warning)
                {
                    lock (this._warnings) { this._warnings.Add((formatter(state, exception), exception)); }
                }
            }
        }

        /// <summary>A DurableTaskClient that lists what it was given, and remembers what it was asked.</summary>
        private class ListingClient : FakeDurableTaskClient
        {
            public IReadOnlyList<OrchestrationMetadata> Instances { get; set; } = Array.Empty<OrchestrationMetadata>();

            public List<OrchestrationQuery> Queries { get; } = new List<OrchestrationQuery>();

            public override Microsoft.DurableTask.AsyncPageable<OrchestrationMetadata> GetAllInstancesAsync(OrchestrationQuery filter = null)
            {
                this.Queries.Add(filter);

                return Microsoft.DurableTask.Pageable.Create((continuation, cancellation) =>
                    Task.FromResult(new Microsoft.DurableTask.Page<OrchestrationMetadata>(this.Instances)));
            }
        }
    }
}
