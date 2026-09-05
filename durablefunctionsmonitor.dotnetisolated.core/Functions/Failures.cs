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
    /// The /failures endpoint: the failure groups the Failures screen lists, and the "needs attention"
    /// panel of the Overview reads.
    ///
    /// Like /stats it composes three things and adds nothing of its own to the numbers: the range
    /// parameters (parsed by the shared <see cref="RangeQuery"/>), the storage provider's failures routine
    /// (<see cref="DfmExtensionPoints.GetFailuresRoutine"/>) and the shared <see cref="AggregationCache"/>
    /// (decision D10). The result is exactly the FailuresResponse of
    /// docs/plans/svelte-rewrite/00-shared-contracts.md section 6.
    /// </summary>
    public class Failures : DfmFunctionBase
    {
        public Failures(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Failures>();
        }

        // Returns the failed instances of a time range, grouped by orchestrator and error signature.
        // GET /a/p/i/{connName}-{hubName}/failures?from&to
        [Function(nameof(DfmGetFailuresFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetFailuresFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/failures")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName)
        {
            try
            {
                // A null routine means the provider cannot list failures (MSSQL for now, Netherite always).
                // /about reports capabilities.failures == false for exactly the same reason.
                var failuresRoutine = this.ExtensionPoints.GetFailuresRoutine;
                if (failuresRoutine == null)
                {
                    return await req.ReturnStatus(HttpStatusCode.BadRequest, ProviderNotSupportedMessage);
                }

                var (from, to) = RangeQuery.Parse(req);

                var query = new FailuresQuery
                {
                    From = from,
                    To = to,

                    // The bound on the scan comes from settings (DFM_STATS_CAP), never from the client: it is
                    // a protection of the storage account, not a user preference.
                    Cap = this.Settings.StatsScanCap
                };

                string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                // FailuresQuery.CacheKey rounds From/To down to the minute, so an auto-refreshing screen
                // keeps hitting the same entry instead of re-scanning the hub every few seconds.
                string cacheKey = $"failures|{connEnvVariableName}|{hubName}|{query.CacheKey}";

                // Set by the factory below, and only by it. It stays false both for a cache hit and for a
                // request that joined another request's still running scan.
                bool producedByThisRequest = false;

                var result = await AggregationCache.GetOrAddAsync(
                    cacheKey,
                    TimeSpan.FromSeconds(this.Settings.AggregationCacheSeconds),
                    async () =>
                    {
                        producedByThisRequest = true;

                        var startedAt = DateTimeOffset.UtcNow;
                        var stopwatch = Stopwatch.StartNew();

                        var produced = await failuresRoutine(durableClient, connEnvVariableName, hubName, query, CancellationToken.None);

                        stopwatch.Stop();

                        if (produced == null)
                        {
                            // Never cache (nor dereference) nothing: a hub with no failures still produces a result
                            throw new DfmStorageException($"The storage provider returned no failures for task hub {hubName}", inner: null);
                        }

                        // The provider routines fill everything but these three - they cannot know how long
                        // the whole call took, nor anything about the cache.
                        produced.ElapsedMs = stopwatch.ElapsedMilliseconds;
                        produced.GeneratedAt = startedAt;
                        produced.Cached = false;

                        return produced;
                    });

                // A cache hit must not mutate the cached instance: it stays in the cache for the rest of the
                // TTL and another request may be serializing it right now.
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
                this._logger.LogError(ex, "Failed to list the failures of the Task Hub");
                return await req.ReturnStatus(HttpStatusCode.InternalServerError, ex.Message);
            }
        }

        /// <summary>
        /// What the endpoint answers when the storage provider has no failures routine.
        /// </summary>
        internal const string ProviderNotSupportedMessage = "Failure groups are not supported for this storage provider";

        /// <summary>
        /// A shallow copy of a cached result, marked as such. Shallow is enough: nothing mutates the
        /// collections of a <see cref="FailuresResult"/> after the routine produced it.
        /// </summary>
        private static FailuresResult AsCached(FailuresResult result)
        {
            return new FailuresResult
            {
                Groups = result.Groups,
                TotalFailed = result.TotalFailed,
                Scanned = result.Scanned,
                Partial = result.Partial,
                Cap = result.Cap,
                ElapsedMs = result.ElapsedMs,
                GeneratedAt = result.GeneratedAt,
                Cached = true
            };
        }

        private readonly ILogger _logger;
    }
}
