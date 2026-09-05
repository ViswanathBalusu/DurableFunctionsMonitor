// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// What GET orchestrations('{id}')/spans returns: the timeline bars, the 'where the time went' totals and
    /// the few numbers around them that the Timeline tab, the totals bars and the peek mini timeline draw.
    ///
    /// Exactly the SpansResponse of docs/plans/svelte-rewrite/00-shared-contracts.md section 6.
    /// </summary>
    public class SpansResponse
    {
        /// <summary>The instance this is about.</summary>
        public string InstanceId { get; set; }

        /// <summary>
        /// Current execution id, as the storage row reports it. Null when the storage provider does not
        /// expose it (Netherite) or when the row could not be read.
        /// </summary>
        public string ExecutionId { get; set; }

        /// <summary>How many times the instance continued-as-new. Null when the provider does not track it.</summary>
        public int? Generation { get; set; }

        /// <summary>Timestamp of the ExecutionStarted row of the current execution. Null when the history has none. UTC.</summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset? ExecutionStartedAt { get; set; }

        /// <summary>Timestamp of the ExecutionCompleted/ExecutionFailed/ExecutionTerminated row. Null while the instance runs. UTC.</summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset? ExecutionEndedAt { get; set; }

        /// <summary>
        /// The moment this response was produced. Open spans (end == null) are drawn up to it, so it carries
        /// the same millisecond precision the spans do - whole seconds would misplace a live bar by up to a second.
        /// </summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset Now { get; set; }

        /// <summary>The bars, ordered by start ascending.</summary>
        public IReadOnlyList<Span> Spans { get; set; } = new List<Span>();

        /// <summary>The 'where the time went' numbers.</summary>
        public SpansTotals Totals { get; set; } = new SpansTotals();

        /// <summary>How many history rows were loaded to build this.</summary>
        public int HistoryRows { get; set; }

        /// <summary>
        /// Rough size of those rows' payloads, in bytes. Null when the history is empty.
        /// An estimate: the UTF-16 size of the Input/Result/Details strings the history routine returned,
        /// not an exact storage figure.
        /// </summary>
        public long? HistoryBytes { get; set; }

        /// <summary>
        /// How many payloads of this instance live in the large-message blob container.
        /// Always null in v1: counting them means listing that container, which /storage (B4) does instead.
        /// </summary>
        public long? LargeMessageBlobs { get; set; }
    }

    /// <summary>
    /// The /spans endpoint: composes the history loader, the episode-marker routine and the pure
    /// <see cref="SpanBuilder"/> into the SpansResponse of contracts section 6.
    /// </summary>
    public class Spans : DfmFunctionBase
    {
        public Spans(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Spans>();
        }

        // Returns the timeline spans and totals of an instance.
        // GET /a/p/i/{connName}-{hubName}/orchestrations('<id>')/spans
        [Function(nameof(DfmGetOrchestrationSpansFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetOrchestrationSpansFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/orchestrations('{instanceId}')/spans")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string instanceId)
        {
            try
            {
                var now = DateTimeOffset.UtcNow;

                // A Durable Entity has no orchestrator, no activities and no timers, so it has no timeline:
                // the plan (B2-S3-T1) answers 400 for entity ids, and the UI never requests spans for an entity.
                if (ExpandedOrchestrationStatus.TryGetEntityInstanceId(instanceId, out var _))
                {
                    return await req.ReturnStatus(HttpStatusCode.BadRequest, $"Instance {instanceId} is a Durable Entity and has no spans");
                }

                // Cheap: no inputs/outputs needed, just the runtime status and enough to compute the etag
                var metadata = await durableClient.GetInstanceAsync(instanceId, false);
                if (metadata == null)
                {
                    return await req.ReturnStatus(HttpStatusCode.NotFound, $"Instance {instanceId} doesn't exist");
                }

                // The same etag the details endpoint returns: the spans can only have changed when the
                // instance itself has, so the UI can skip re-rendering the timeline on a poll
                string etag = ConditionalGet.ComputeETag(metadata);
                if (ConditionalGet.TryNotModified(req, etag, out var notModifiedResponse))
                {
                    return notModifiedResponse;
                }

                string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                var history = (await this.ExtensionPoints.GetInstanceHistoryRoutine(durableClient, connEnvVariableName, hubName, instanceId))
                    ?.ToList() ?? new List<HistoryEvent>();

                // A null routine means the provider cannot report episodes (Netherite): the builder then
                // produces no orchestrator spans and totals.orchestratorMs is null
                var markers = this.ExtensionPoints.GetEpisodeMarkersRoutine == null
                    ? null
                    : await this.ExtensionPoints.GetEpisodeMarkersRoutine(durableClient, connEnvVariableName, hubName, instanceId);

                // A null routine, and also a null result (the Instances row was purged), both mean 'unknown'
                var rowInfo = this.ExtensionPoints.GetInstanceRowInfoRoutine == null
                    ? null
                    : await this.ExtensionPoints.GetInstanceRowInfoRoutine(durableClient, connEnvVariableName, hubName, instanceId);

                var result = SpanBuilder.Build(history, markers, metadata.RuntimeStatus, now);

                var response = await req.ReturnJson(new SpansResponse
                {
                    InstanceId = instanceId,
                    ExecutionId = rowInfo?.ExecutionId,
                    Generation = rowInfo?.Generation,
                    ExecutionStartedAt = result.ExecutionStartedAt,
                    ExecutionEndedAt = result.ExecutionEndedAt,
                    Now = now,
                    Spans = result.Spans,
                    Totals = result.Totals,
                    HistoryRows = history.Count,

                    // InstanceRowInfo.HistoryBytesEstimate is always null (no provider reports it), so the
                    // estimate is computed here, from the history that was actually loaded
                    HistoryBytes = EstimateHistoryBytes(history),

                    LargeMessageBlobs = null
                });

                response.Headers.Add("ETag", etag);
                return response;
            }
            catch (DfmBadRequestException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmNotSupportedException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmNotFoundException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.NotFound, ex.Message);
            }
            catch (DfmStorageException ex)
            {
                this._logger.LogError(ex, "Storage could not be read");
                return await req.ReturnStatus(HttpStatusCode.InternalServerError, ex.Message);
            }
        }

        private readonly ILogger _logger;

        /// <summary>
        /// A rough size of the loaded history: the UTF-16 size of every payload string in it.
        /// Null for an empty history, so the UI can tell 'nothing to measure' from 'measured zero'.
        /// </summary>
        private static long? EstimateHistoryBytes(IReadOnlyList<HistoryEvent> history)
        {
            if (history.Count <= 0)
            {
                return null;
            }

            long result = 0;
            foreach (var evt in history)
            {
                if (evt == null)
                {
                    continue;
                }

                result += SizeOf(evt.Input) + SizeOf(evt.Result) + SizeOf(evt.Details);
            }

            return result;
        }

        // A .NET string is UTF-16: two bytes per char
        private static long SizeOf(string value)
        {
            return value == null ? 0 : (long)value.Length * sizeof(char);
        }
    }
}
