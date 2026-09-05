// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The /storage endpoint: what the Storage screen (and the Overview backlog panel) shows about the
    /// storage account behind a Task Hub - queue depths, partition ownership, the task hub blob, the
    /// tables and the large-message container.
    ///
    /// Everything it reports comes from <see cref="DfmExtensionPoints.GetStorageHealthRoutine"/> (Azure
    /// Storage has one, MSSQL and Netherite do not), wrapped in the shared <see cref="AggregationCache"/>
    /// as decision D10 requires. The endpoint itself only adds the two facts the routine cannot know:
    /// the provider name and the storage account name.
    /// </summary>
    public class Storage : DfmFunctionBase
    {
        public Storage(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Storage>();
        }

        // Returns the storage health of a Task Hub.
        // GET /a/p/i/{connName}-{hubName}/storage?counts=true&instanceId=
        [Function(nameof(DfmGetStorageFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetStorageFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/storage")] HttpRequestData req,
            string connName,
            string hubName)
        {
            try
            {
                // A null routine means the provider has no storage account to look at (MSSQL, Netherite).
                // /about reports capabilities.storageHealth == false for the same reason.
                var storageHealthRoutine = this.ExtensionPoints.GetStorageHealthRoutine;
                if (storageHealthRoutine == null)
                {
                    return await req.ReturnStatus(HttpStatusCode.BadRequest, ProviderNotSupportedMessage);
                }

                bool counts = ParseBool(req.Query["counts"], "counts");
                string instanceId = req.Query["instanceId"];

                string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                // Two entries per hub, one for each value of 'counts': the expensive scans must not be
                // served to a caller that asked for them just because a cheap call ran a moment earlier,
                // and the cheap call must not have to wait for them either. The instance only scopes the
                // large-message numbers, but it changes the response, so it belongs in the key as well.
                string cacheKey = $"storage|{connEnvVariableName}|{hubName}|{counts}|{instanceId}";

                // Set by the factory below, and only by it: it stays false both for a cache hit and for a
                // request that joined another request's still running read.
                bool producedByThisRequest = false;

                var result = await AggregationCache.GetOrAddAsync(
                    cacheKey,
                    TimeSpan.FromSeconds(this.Settings.AggregationCacheSeconds),
                    async () =>
                    {
                        producedByThisRequest = true;

                        var produced = await storageHealthRoutine(connEnvVariableName, hubName, counts, instanceId, CancellationToken.None);

                        if (produced == null)
                        {
                            // Never cache (nor dereference) nothing: even an empty account produces a result
                            throw new DfmStorageException($"The storage provider returned no storage health for task hub {hubName}", inner: null);
                        }

                        // The routine reads storage; it knows nothing about which provider or account it was
                        // pointed at. Both are set once, before the value is cached.
                        produced.Provider = this.ExtensionPoints.ProviderName;
                        produced.AccountName = GetAccountName(connEnvVariableName);
                        produced.Cached = false;

                        return produced;
                    });

                // A cache hit must not mutate the cached instance: it stays in the cache for the rest of
                // the TTL and another request may be serializing it right now.
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
                this._logger.LogError(ex, "Failed to read the storage health of the Task Hub");
                return await req.ReturnStatus(HttpStatusCode.InternalServerError, ex.Message);
            }
        }

        /// <summary>
        /// What the endpoint answers when the storage provider has no storage-health routine.
        /// </summary>
        internal const string ProviderNotSupportedMessage = "Storage health is not supported for this storage provider";

        /// <summary>
        /// The storage account name, read out of the connection string the same way /about reads it.
        /// An identity-based connection (no AccountName= in it) yields an empty string, exactly as there.
        /// </summary>
        private static string GetAccountName(string connEnvVariableName)
        {
            string connString = Environment.GetEnvironmentVariable(connEnvVariableName);

            var match = AccountNameRegex.Match(connString ?? string.Empty);

            return match.Success ? match.Groups[1].Value : string.Empty;
        }

        /// <summary>
        /// A shallow copy of a cached result, marked as such. Shallow is enough: nothing mutates the
        /// collections of a <see cref="StorageHealthResult"/> after the routine produced it.
        /// </summary>
        private static StorageHealthResult AsCached(StorageHealthResult result)
        {
            return new StorageHealthResult
            {
                Provider = result.Provider,
                AccountName = result.AccountName,
                TaskHub = result.TaskHub,
                Queues = result.Queues,
                Partitions = result.Partitions,
                Tables = result.Tables,
                LargeMessages = result.LargeMessages,
                Counts = result.Counts,
                GeneratedAt = result.GeneratedAt,
                ElapsedMs = result.ElapsedMs,
                Cached = true
            };
        }

        /// <summary>
        /// Parses an optional boolean query parameter. Absent or empty means false; anything that is not a
        /// boolean is a 400, rather than a silent false that would leave the caller wondering why the row
        /// counts never arrived.
        /// </summary>
        private static bool ParseBool(string raw, string paramName)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return false;
            }

            if (!bool.TryParse(raw, out bool value))
            {
                throw new DfmBadRequestException($"Invalid '{paramName}' value: '{raw}'");
            }

            return value;
        }

        // The same expression /about uses, so both endpoints report the same account name
        private static readonly Regex AccountNameRegex = new Regex(@"AccountName=(\w+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private readonly ILogger _logger;
    }
}
