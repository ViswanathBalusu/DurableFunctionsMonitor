// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Diagnostics;
using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Runs one of the eight <see cref="OrchestrationActions"/> (suspend, resume, purge, rewind, terminate,
    /// raise-event, set-custom-status, restart) against up to <see cref="MaxInstanceIds"/> instances in a single
    /// call, for the bulk action bar and the Failures group actions. Shares <see cref="OrchestrationActions.ExecuteAsync"/>
    /// with the single-instance endpoint (<see cref="Orchestration.DfmPostOrchestrationFunction"/>), so both apply
    /// exactly the same rules to an instance. A failure on one instance never stops the others: the response
    /// carries a per-id status and message, and the HTTP status itself is 200 unless the request shape itself
    /// was invalid.
    /// </summary>
    public class Batch : DfmFunctionBase
    {
        // The three input-events operations (Functions/InputEvents.cs) never run in batch: they need a
        // per-instance sequence number/input and are OperationKind.Dangerous, not Write.
        private static readonly string[] DangerousActionNames = { "replay", "restart-in-place", "update-input-and-rewind" };

        private const int MaxInstanceIds = 200;
        private const int MaxConcurrency = 8;

        public Batch(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Batch>();
        }

        // Runs one action against a list of instances.
        // POST /a/p/i/{connName}-{hubName}/orchestrations/batch
        // Body: { "action": "suspend", "instanceIds": ["a", "b"], "payload": { "reason": "..." } }
        [Function(nameof(DfmBatchFunction))]
        [OperationKind(Kind = OperationKind.Write)]
        public async Task<HttpResponseData> DfmBatchFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = Globals.ApiRoutePrefix + "/orchestrations/batch")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            FunctionContext context)
        {
            try
            {
                var body = await ReadBodyAsync(req);

                string action = GetRequiredString(body, "action");

                if (DangerousActionNames.Contains(action))
                {
                    throw new DfmBadRequestException("Dangerous operations cannot run in batch");
                }

                if (!OrchestrationActionNames.All.Contains(action))
                {
                    throw new DfmBadRequestException($"'{action}' is not a known batch action");
                }

                var instanceIds = GetInstanceIds(body);

                if (OrchestrationActionNames.OrchestrationOnly.Contains(action))
                {
                    foreach (var instanceId in instanceIds)
                    {
                        if (ExpandedOrchestrationStatus.TryGetEntityInstanceId(instanceId, out _))
                        {
                            throw new DfmBadRequestException($"'{action}' cannot run against Durable Entity '{instanceId}'");
                        }
                    }
                }

                var payload = GetPayload(body);

                this._logger.LogInformation("Running batch action {Action} against {Count} instances", action, instanceIds.Count);

                var stopwatch = Stopwatch.StartNew();
                var results = new BatchResultItem[instanceIds.Count];

                using (var semaphore = new SemaphoreSlim(MaxConcurrency))
                {
                    var tasks = instanceIds.Select(async (instanceId, index) =>
                    {
                        await semaphore.WaitAsync();
                        try
                        {
                            results[index] = await RunOneAsync(durableClient, connName, instanceId, action, payload);
                        }
                        finally
                        {
                            semaphore.Release();
                        }
                    });

                    await Task.WhenAll(tasks);
                }

                stopwatch.Stop();

                var response = new BatchResponse
                {
                    Action = action,
                    Results = results,
                    OkCount = results.Count(r => r.Ok),
                    FailedCount = results.Count(r => !r.Ok),
                    ElapsedMs = stopwatch.ElapsedMilliseconds
                };

                // What the audit record (B5) says about this call: one row per batch, naming the action
                // it ran and how it went, rather than one indistinguishable 'Batch' row per bulk operation.
                context.Items[Globals.DfmAuditOperationContextValue] = $"Batch {action}";
                context.Items[Globals.DfmAuditMessageContextValue] = $"{response.OkCount} ok, {response.FailedCount} failed, of {instanceIds.Count} instances";

                return await req.ReturnJson(response);
            }
            catch (DfmBadRequestException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
        }

        // Runs one instance's action, mapping OrchestrationActions' typed failures to the per-id status the
        // response carries. A failure here never throws: it always becomes a BatchResultItem so the other
        // instances in the same request still get to run.
        private static async Task<BatchResultItem> RunOneAsync(DurableTaskClient durableClient, string connName, string instanceId, string action, JsonObject payload)
        {
            try
            {
                await OrchestrationActions.ExecuteAsync(durableClient, connName, instanceId, action, payload);

                return new BatchResultItem { InstanceId = instanceId, Ok = true, Status = (int)HttpStatusCode.OK };
            }
            catch (DfmConflictException ex)
            {
                return new BatchResultItem { InstanceId = instanceId, Ok = false, Status = (int)HttpStatusCode.Conflict, Message = ex.Message };
            }
            catch (DfmNotFoundException ex)
            {
                return new BatchResultItem { InstanceId = instanceId, Ok = false, Status = (int)HttpStatusCode.NotFound, Message = ex.Message };
            }
            catch (DfmBadRequestException ex)
            {
                return new BatchResultItem { InstanceId = instanceId, Ok = false, Status = (int)HttpStatusCode.BadRequest, Message = ex.Message };
            }
            catch (Exception ex)
            {
                return new BatchResultItem { InstanceId = instanceId, Ok = false, Status = (int)HttpStatusCode.InternalServerError, Message = ex.Message };
            }
        }

        private static async Task<JsonObject> ReadBodyAsync(HttpRequestData req)
        {
            string bodyString = await req.ReadAsStringAsync();
            if (string.IsNullOrWhiteSpace(bodyString))
            {
                throw new DfmBadRequestException("The request body must be a JSON object with 'action' and 'instanceIds'");
            }

            JsonNode node;
            try
            {
                node = JsonNode.Parse(bodyString);
            }
            catch (System.Text.Json.JsonException ex)
            {
                throw new DfmBadRequestException($"The request body is not valid JSON: {ex.Message}");
            }

            return node as JsonObject ?? throw new DfmBadRequestException("The request body must be a JSON object");
        }

        private static string GetRequiredString(JsonObject body, string propertyName)
        {
            if (!body.TryGetPropertyValue(propertyName, out var node) ||
                node is not JsonValue value ||
                !value.TryGetValue<string>(out string result) ||
                string.IsNullOrEmpty(result))
            {
                throw new DfmBadRequestException($"The request body must contain '{propertyName}' (a non-empty string)");
            }

            return result;
        }

        // 'payload' is optional; when present it must be a JSON object (its properties are validated per-action
        // inside OrchestrationActions.ExecuteAsync, same as the single-instance endpoint).
        private static JsonObject GetPayload(JsonObject body)
        {
            if (!body.TryGetPropertyValue("payload", out var node) || node == null)
            {
                return null;
            }

            return node as JsonObject ?? throw new DfmBadRequestException("'payload' must be a JSON object");
        }

        private static List<string> GetInstanceIds(JsonObject body)
        {
            if (!body.TryGetPropertyValue("instanceIds", out var node) || node is not JsonArray array)
            {
                throw new DfmBadRequestException("The request body must contain 'instanceIds' (a non-empty array of strings)");
            }

            var instanceIds = new List<string>(array.Count);
            foreach (var item in array)
            {
                if (item is not JsonValue value || !value.TryGetValue<string>(out string instanceId) || string.IsNullOrEmpty(instanceId))
                {
                    throw new DfmBadRequestException("'instanceIds' must be an array of non-empty strings");
                }

                instanceIds.Add(instanceId);
            }

            if (instanceIds.Count == 0)
            {
                throw new DfmBadRequestException("'instanceIds' must not be empty");
            }

            if (instanceIds.Count > MaxInstanceIds)
            {
                throw new DfmBadRequestException($"'instanceIds' must not contain more than {MaxInstanceIds} ids (got {instanceIds.Count})");
            }

            if (instanceIds.Distinct(StringComparer.Ordinal).Count() != instanceIds.Count)
            {
                throw new DfmBadRequestException("'instanceIds' must not contain duplicate ids");
            }

            return instanceIds;
        }

        private readonly ILogger _logger;
    }

    /// <summary>
    /// Response of POST /orchestrations/batch. Matches docs/plans/svelte-rewrite/00-shared-contracts.md
    /// section 6 (BatchResponse) byte for byte.
    /// </summary>
    public class BatchResponse
    {
        public string Action { get; set; }
        public IReadOnlyList<BatchResultItem> Results { get; set; }
        public int OkCount { get; set; }
        public int FailedCount { get; set; }
        public long ElapsedMs { get; set; }
    }

    /// <summary>One instance's outcome inside a <see cref="BatchResponse"/>.</summary>
    public class BatchResultItem
    {
        public string InstanceId { get; set; }
        public bool Ok { get; set; }
        public int Status { get; set; }

        /// <summary>The failure message. Omitted (not null) when <see cref="Ok"/> is true.</summary>
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string Message { get; set; }
    }
}
