// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Diagnostics;
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The /stats endpoint: every tile, chart and panel of the Overview screen reads this one response.
    ///
    /// It composes three things and adds nothing of its own to the numbers: the query parameters (parsed and
    /// validated here), the storage provider's stats routine (<see cref="DfmExtensionPoints.GetStatsRoutine"/>,
    /// Azure Storage and MSSQL have one, Netherite does not) and the shared <see cref="AggregationCache"/>
    /// (decision D10). The result is exactly the StatsResponse of
    /// docs/plans/svelte-rewrite/00-shared-contracts.md section 6, with 'cached', 'generatedAt' and 'elapsedMs'
    /// reported honestly: 'cached' is true only when this request did not scan storage itself, 'generatedAt'
    /// and 'elapsedMs' always describe the scan the numbers actually came from, not this request.
    /// </summary>
    public class Stats : DfmFunctionBase
    {
        public Stats(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Stats>();
        }

        // Returns Task Hub statistics over a time range: totals, time bins, per-orchestrator aggregates,
        // entity counts and the stuck/long-pending/suspended sets.
        // GET /a/p/i/{connName}-{hubName}/stats?from&to&bins&stuckAfterMinutes&pendingAfterMinutes
        [Function(nameof(DfmGetStatsFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetStatsFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/stats")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName)
        {
            try
            {
                // A null routine means the provider cannot produce statistics (Netherite). /about reports
                // capabilities.stats == false for exactly the same reason, so the UI never gets here.
                var statsRoutine = this.ExtensionPoints.GetStatsRoutine;
                if (statsRoutine == null)
                {
                    return await req.ReturnStatus(HttpStatusCode.BadRequest, ProviderNotSupportedMessage);
                }

                var query = ParseQuery(req, this.Settings.StatsScanCap);

                string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                // StatsQuery.CacheKey rounds From/To down to the minute, so an auto-refreshing Overview screen
                // keeps hitting the same entry instead of re-scanning the hub every few seconds.
                string cacheKey = $"stats|{connEnvVariableName}|{hubName}|{query.CacheKey}";

                // Set by the factory below, and only by it. It stays false both for a cache hit and for a
                // request that joined another request's still running scan - in both cases this request did
                // not read storage, which is what 'cached' tells the user.
                bool producedByThisRequest = false;

                var result = await AggregationCache.GetOrAddAsync(
                    cacheKey,
                    TimeSpan.FromSeconds(this.Settings.AggregationCacheSeconds),
                    async () =>
                    {
                        producedByThisRequest = true;

                        var startedAt = DateTimeOffset.UtcNow;
                        var stopwatch = Stopwatch.StartNew();

                        var produced = await statsRoutine(durableClient, connEnvVariableName, hubName, query, CancellationToken.None);

                        stopwatch.Stop();

                        if (produced == null)
                        {
                            // Never cache (nor dereference) nothing: an empty hub still produces a StatsResult.
                            throw new DfmStorageException($"The storage provider returned no statistics for task hub {hubName}", inner: null);
                        }

                        // The provider routines fill everything but these three - they cannot know how long the
                        // whole call took, nor anything about the cache. Set once, before the value is cached,
                        // so every later reader of this entry sees the numbers of the scan that produced it.
                        produced.ElapsedMs = stopwatch.ElapsedMilliseconds;
                        produced.GeneratedAt = startedAt;
                        produced.Cached = false;

                        return produced;
                    });

                // A cache hit must not mutate the cached instance: it stays in the cache for the rest of the
                // TTL and another request may be serializing it right now. So 'cached: true' goes onto a copy.
                return await req.ReturnJson(producedByThisRequest ? result : AsCached(result));
            }
            catch (DfmBadRequestException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmNotSupportedException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmStorageException ex)
            {
                this._logger.LogError(ex, "Failed to produce Task Hub statistics");
                return await req.ReturnStatus(HttpStatusCode.InternalServerError, ex.Message);
            }
        }

        /// <summary>
        /// What the endpoint answers when the storage provider has no stats routine.
        /// </summary>
        internal const string ProviderNotSupportedMessage = "Hub statistics are not supported for this storage provider";

        /// <summary>
        /// Parses and validates the query string into a <see cref="StatsQuery"/>, throwing
        /// <see cref="DfmBadRequestException"/> (400) for anything the aggregator could not make sense of.
        /// 'from' and 'to' are required; every other parameter has a default.
        /// </summary>
        internal static StatsQuery ParseQuery(HttpRequestData req, int cap)
        {
            // 'from', 'to' and the bounded integers are shared with /failures and /audit (RangeQuery), so
            // every aggregation endpoint accepts the same formats and answers the same 400s.
            var (from, to) = RangeQuery.Parse(req);

            return new StatsQuery
            {
                From = from,
                To = to,
                Bins = RangeQuery.ParseBoundedInt(req.Query["bins"], "bins", DefaultBins, MinBins, MaxBins),
                StuckAfterMinutes = RangeQuery.ParseBoundedInt(req.Query["stuckAfterMinutes"], "stuckAfterMinutes", DefaultStuckAfterMinutes, MinMinutes, MaxMinutes),
                PendingAfterMinutes = RangeQuery.ParseBoundedInt(req.Query["pendingAfterMinutes"], "pendingAfterMinutes", DefaultPendingAfterMinutes, MinMinutes, MaxMinutes),

                // The bound on the scan comes from settings (DFM_STATS_CAP), never from the client: it is a
                // protection of the storage account, not a user preference.
                Cap = cap
            };
        }

        /// <summary>
        /// A shallow copy of a cached result, marked as such. Shallow is enough: nothing mutates the
        /// collections of a <see cref="StatsResult"/> after the routine produced it.
        /// </summary>
        private static StatsResult AsCached(StatsResult result)
        {
            return new StatsResult
            {
                From = result.From,
                To = result.To,
                BinCount = result.BinCount,
                Totals = result.Totals,
                Bins = result.Bins,
                ByName = result.ByName,
                EntitiesByName = result.EntitiesByName,
                Stuck = result.Stuck,
                OldestPending = result.OldestPending,
                Suspended = result.Suspended,
                Scanned = result.Scanned,
                Partial = result.Partial,
                Cap = result.Cap,
                ElapsedMs = result.ElapsedMs,
                GeneratedAt = result.GeneratedAt,
                Cached = true
            };
        }

        // Defaults and bounds of contracts section 6 / B1-S2-T1: bins 48 (max 366, i.e. one per day over the
        // longest supported range), stuck 60 minutes, long-pending 10 minutes.
        private const int DefaultBins = 48;
        private const int MinBins = 1;
        private const int MaxBins = 366;
        private const int DefaultStuckAfterMinutes = 60;
        private const int DefaultPendingAfterMinutes = 10;
        private const int MinMinutes = 1;
        private const int MaxMinutes = 100000;

        private readonly ILogger _logger;
    }
}
