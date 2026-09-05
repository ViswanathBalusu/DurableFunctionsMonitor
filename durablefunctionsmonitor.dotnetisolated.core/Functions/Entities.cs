// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Globalization;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.DurableTask.Client.Entities;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    public class Entities : DfmFunctionBase
    {
        public Entities(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Entities>();
        }

        // Lists Durable Entities, with their state parsed and summarized (contracts section 6, EntitiesResponse).
        // GET /a/p/i/{connName}-{hubName}/entities?name&keyPrefix&updatedFrom&updatedTo&$top&$skip
        [Function(nameof(DfmGetEntitiesFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetEntitiesFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/entities")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName)
        {
            string name = req.Query["name"];
            string keyPrefix = req.Query["keyPrefix"];

            DateTimeOffset? updatedFrom = ParseDate(req.Query["updatedFrom"], "updatedFrom");
            DateTimeOffset? updatedTo = ParseDate(req.Query["updatedTo"], "updatedTo");
            int top = ParseBoundedInt(req.Query["$top"], "$top", DefaultTop, MaxTop);
            int skip = ParseBoundedInt(req.Query["$skip"], "$skip", 0, int.MaxValue);

            var filter = new EntityQuery
            {
                // Entity ids are "@name@key". Giving InstanceIdStartsWith "@name@" (name, no keyPrefix) or
                // "@name@keyPrefix" pushes the filter down to the provider; see EntityQuery.InstanceIdStartsWith.
                InstanceIdStartsWith = string.IsNullOrEmpty(name) ? null : $"@{name.ToLowerInvariant()}@{keyPrefix}",
                LastModifiedFrom = updatedFrom,
                LastModifiedTo = updatedTo,
                IncludeState = false,
                IncludeTransient = true,
                PageSize = EntityListPageSize
            };

            // A keyPrefix without a name cannot be pushed down (InstanceIdStartsWith needs the name first),
            // so it is applied client-side while paging through the (otherwise unfiltered) result.
            bool needsClientSideKeyFilter = string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(keyPrefix);

            var page = new List<EntityMetadata>(top);
            bool hasMore = false;
            int skipped = 0;
            int scanned = 0;

            try
            {
                await foreach (var entity in durableClient.Entities.GetAllEntitiesAsync(filter))
                {
                    scanned++;
                    if (scanned > MaxEntitiesToScan)
                    {
                        // Hard bound, so a keyPrefix-only filter (or a very large $skip) that matches
                        // little to nothing cannot turn into an unbounded scan of the whole hub.
                        break;
                    }

                    if (needsClientSideKeyFilter && !(entity.Id.Key ?? string.Empty).StartsWith(keyPrefix, StringComparison.Ordinal))
                    {
                        continue;
                    }

                    if (skipped < skip)
                    {
                        skipped++;
                        continue;
                    }

                    if (page.Count >= top)
                    {
                        // Reading one item past the page: its mere existence is enough to answer hasMore.
                        hasMore = true;
                        break;
                    }

                    page.Add(entity);
                }
            }
            catch (Exception ex)
            {
                // Same defensive behaviour as Orchestrations.ListDurableEntities: some providers throw when
                // Durable Entities are not supported at all (or not yet, on a brand-new task hub). Treat that
                // the same as "no entities" rather than failing the whole request.
                this._logger.LogWarning(ex, "Failed to list Durable Entities");
            }

            var rows = new EntityRow[page.Count];
            using (var semaphore = new SemaphoreSlim(MaxParallelStateFetches))
            {
                await Task.WhenAll(Enumerable.Range(0, page.Count).Select(async i =>
                {
                    await semaphore.WaitAsync();
                    try
                    {
                        rows[i] = await this.ToRowAsync(durableClient, page[i]);
                    }
                    finally
                    {
                        semaphore.Release();
                    }
                }));
            }

            return await req.ReturnJson(new EntitiesResponse
            {
                Entities = rows,
                HasMore = hasMore
            });
        }

        private async Task<EntityRow> ToRowAsync(DurableTaskClient durableClient, EntityMetadata summary)
        {
            JToken state = null;
            string stateSummary = null;
            string stateError = null;

            try
            {
                // Fetched one entity at a time (rather than IncludeState=true on the listing query above):
                // a single oversized entity's state fails this call outright (large states fail this call
                // today, see Orchestrations.cs's ListDurableEntities comment on the message-size limit), so
                // fetching per-row means one oversized entity only loses its own state, never the whole page.
                var withState = await durableClient.Entities.GetEntityAsync(summary.Id, includeState: true);
                if (withState != null && withState.IncludesState)
                {
                    state = EntityState.Parse(withState.State.Value);
                    stateSummary = EntityState.Summarize(state);
                }
            }
            catch (Exception ex)
            {
                stateError = ex.Message;
            }

            return new EntityRow
            {
                InstanceId = summary.Id.ToString(),
                EntityName = summary.Id.Name,
                Key = summary.Id.Key,
                State = state,
                StateSummary = stateSummary,
                StateError = stateError,
                LastUpdatedTime = summary.LastModifiedTime,
                RuntimeStatus = OrchestrationRuntimeStatus.Running
            };
        }

        private static DateTimeOffset? ParseDate(string raw, string paramName)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return null;
            }

            if (!DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value))
            {
                throw new DfmBadRequestException($"Invalid '{paramName}' value: '{raw}'");
            }

            return value;
        }

        private static int ParseBoundedInt(string raw, string paramName, int defaultValue, int max)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return defaultValue;
            }

            if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value) || value < 0)
            {
                throw new DfmBadRequestException($"Invalid '{paramName}' value: '{raw}'");
            }

            return Math.Min(value, max);
        }

        // Default/max page size for $top (contracts section 6, GET /entities).
        private const int DefaultTop = 50;
        private const int MaxTop = 200;

        // Page size asked of the underlying GetAllEntitiesAsync query - independent of $top/$skip, which are
        // applied on top of it as we page through the (possibly multi-page) result.
        private const int EntityListPageSize = 200;

        // How many per-row state-fetch calls (GetEntityAsync) may be in flight at once.
        private const int MaxParallelStateFetches = 8;

        private const int MaxEntitiesToScan = 5000;

        private readonly ILogger _logger;
    }

    /// <summary>
    /// A single row of the /entities listing (contracts section 6, EntityRow).
    /// </summary>
    public class EntityRow
    {
        public string InstanceId { get; set; }
        public string EntityName { get; set; }
        public string Key { get; set; }
        public JToken State { get; set; }
        public string StateSummary { get; set; }
        public string StateError { get; set; }
        public DateTimeOffset LastUpdatedTime { get; set; }
        public OrchestrationRuntimeStatus RuntimeStatus { get; set; }
    }

    /// <summary>
    /// The response of GET /entities (contracts section 6, EntitiesResponse).
    /// </summary>
    public class EntitiesResponse
    {
        public IReadOnlyList<EntityRow> Entities { get; set; } = new List<EntityRow>();
        public bool HasMore { get; set; }
    }
}
