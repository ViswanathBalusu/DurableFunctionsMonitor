// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// GET /id-suggestions(prefix='...'), which the Find instance field asks on every pause in the typing: the
    /// ids that start with what was typed. It answers with the first of them and stops reading there, because a
    /// short prefix on a large Task Hub is a great many instances, and the field shows six.
    /// </summary>
    [TestClass]
    public class IdSuggestionsFunctionTests
    {
        private const string HubName = "Hub";

        private static async Task<string[]> GetSuggestionsAsync(PagingClient client, string prefix)
        {
            var request = new FakeHttpRequestData(new Uri($"http://localhost/a/p/i/--{HubName}/id-suggestions(prefix='{prefix}')"));

            var response = await new IdSuggestions(new DfmSettings(), new DfmExtensionPoints())
                .DfmGetIdSuggestionsFunction(request, client, "-", HubName, prefix);

            Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

            response.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(response.Body))
            {
                return JArray.Parse(await reader.ReadToEndAsync()).Select(id => id.Value<string>()).ToArray();
            }
        }

        [TestMethod]
        public async Task AnswersWithTheIdsThatStartWithThePrefix()
        {
            var client = new PagingClient(new[] { "order-1", "order-2", "order-3" });

            var ids = await GetSuggestionsAsync(client, "order");

            CollectionAssert.AreEqual(new[] { "order-1", "order-2", "order-3" }, ids);

            // Asked for by its prefix, a page of them, and without the payloads nobody looks at here
            var query = client.Queries.Single();

            Assert.AreEqual("order", query.InstanceIdPrefix);
            Assert.AreEqual(IdSuggestions.MaxSuggestions, query.PageSize);
            Assert.IsFalse(query.FetchInputsAndOutputs);
        }

        [TestMethod]
        public async Task StopsAfterOnePageHoweverManyInstancesStartWithThePrefix()
        {
            // A prefix as short as the field allows, on a hub where that is a lot of instances
            var all = Enumerable.Range(0, 5000).Select(i => $"ab{i:D6}").ToArray();
            var client = new PagingClient(all);

            var ids = await GetSuggestionsAsync(client, "ab");

            // The first ones, in the order of the ids
            CollectionAssert.AreEqual(all.Take(IdSuggestions.MaxSuggestions).ToArray(), ids);

            // One request for one page: not the hundred it takes to read them all
            Assert.AreEqual(1, client.PagesRead, "the query went on after the page that was returned");
        }

        [TestMethod]
        public async Task ReadsOnOnlyWhenAPageComesBackShort()
        {
            // A storage provider may hand out less than a page at a time; the answer is still filled up
            var all = Enumerable.Range(0, 200).Select(i => $"ab{i:D6}").ToArray();
            var client = new PagingClient(all) { ProviderPageSize = 20 };

            var ids = await GetSuggestionsAsync(client, "ab");

            CollectionAssert.AreEqual(all.Take(IdSuggestions.MaxSuggestions).ToArray(), ids);
            Assert.AreEqual(3, client.PagesRead);
        }

        [TestMethod]
        public async Task AnswersWithNothingWhenNothingStartsWithThePrefix()
        {
            var client = new PagingClient(Array.Empty<string>());

            var ids = await GetSuggestionsAsync(client, "zz");

            Assert.AreEqual(0, ids.Length);
        }

        /// <summary>A DurableTaskClient that lists its instances a page at a time, and counts the pages it was asked for.</summary>
        private class PagingClient : FakeDurableTaskClient
        {
            public PagingClient(IReadOnlyList<string> instanceIds)
            {
                this._instanceIds = instanceIds;
            }

            /// <summary>The most instances the "storage" puts into a page, whatever the query asks for.</summary>
            public int ProviderPageSize { get; set; } = int.MaxValue;

            public int PagesRead { get; private set; }

            public List<OrchestrationQuery> Queries { get; } = new List<OrchestrationQuery>();

            public override Microsoft.DurableTask.AsyncPageable<OrchestrationMetadata> GetAllInstancesAsync(OrchestrationQuery filter = null)
            {
                this.Queries.Add(filter);

                int pageSize = Math.Min(filter.PageSize, this.ProviderPageSize);

                return Microsoft.DurableTask.Pageable.Create((continuation, cancellation) =>
                {
                    this.PagesRead++;

                    int from = continuation == null ? 0 : int.Parse(continuation);

                    var page = this._instanceIds
                        .Skip(from)
                        .Take(pageSize)
                        .Select(id => new OrchestrationMetadata("SomeOrchestrator", id))
                        .ToList();

                    string next = from + page.Count < this._instanceIds.Count ? (from + page.Count).ToString() : null;

                    return Task.FromResult(new Microsoft.DurableTask.Page<OrchestrationMetadata>(page, next));
                });
            }

            private readonly IReadOnlyList<string> _instanceIds;
        }
    }
}
