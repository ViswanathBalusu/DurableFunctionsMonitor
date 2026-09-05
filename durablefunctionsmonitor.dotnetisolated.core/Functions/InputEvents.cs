// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Operations on an instance's input-bearing history events (ExecutionStarted and EventRaised): listing them
    /// together with what can be done to each, restarting a failed instance in place with an edited initial input,
    /// editing the last event's input and rewinding, and replaying everything after the last event.
    /// </summary>
    public class InputEvents : DfmFunctionBase
    {
        public InputEvents(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<InputEvents>();
        }

        // Lists the input-bearing events of the current execution and the operations that apply to each.
        // GET /a/p/i/{connName}-{hubName}/orchestrations('<id>')/input-events
        [Function(nameof(DfmGetInputEventsFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public Task<HttpResponseData> DfmGetInputEventsFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/orchestrations('{instanceId}')/input-events")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string instanceId)
        {
            return this.ExecuteAsync(req, async () =>
            {
                var instance = await this.LoadAsync(durableClient, connName, hubName, instanceId, loadParent: true);
                var result = this.ComputeEligibility(instance);

                foreach (var evt in result.Events)
                {
                    evt.Input = ToJToken(await this.ReadEventInputAsync(instance, evt));
                }

                return await req.ReturnJson(result);
            });
        }

        // Purges a failed instance and re-creates it under the same instanceId, with the same or an edited input.
        // Only for instances that have not received external events.
        // POST /a/p/i/{connName}-{hubName}/orchestrations('<id>')/restart-in-place
        // Body: { "input": <any JSON value, optional> }
        [Function(nameof(DfmRestartInPlaceFunction))]
        [OperationKind(Kind = OperationKind.Dangerous)]
        public Task<HttpResponseData> DfmRestartInPlaceFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = Globals.ApiRoutePrefix + "/orchestrations('{instanceId}')/" + InputEventOperations.RestartInPlace)] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string instanceId)
        {
            return this.ExecuteAsync(req, async () =>
            {
                var body = await ReadBodyAsync(req);
                bool hasInput = body.TryGetPropertyValue("input", out var editedInput);

                var instance = await this.LoadAsync(durableClient, connName, hubName, instanceId, loadParent: true);
                var eligibility = this.ComputeEligibility(instance);

                var target = eligibility.Events.FirstOrDefault(e => e.EventType == HistoryEventTypes.ExecutionStarted)
                    ?? throw new DfmConflictException($"The history of instance {instanceId} has no ExecutionStarted event");

                EnsureAllowed(target, InputEventOperations.RestartInPlace);

                // Everything the new instance needs is captured before anything is deleted
                var input = hasInput ? editedInput : ParseStoredPayload(await this.ReadInitialInputAsync(instance, target));
                string orchestratorName = instance.Metadata.Name;
                var options = new StartOrchestrationOptions(instanceId);
                if (instance.Metadata.Tags?.Count > 0)
                {
                    options = options with { Tags = instance.Metadata.Tags };
                }

                this._logger.LogWarning("Restarting instance {InstanceId} in place: purging it and re-creating it with the {InputKind} input", instanceId, hasInput ? "edited" : "original");

                // The host refuses to purge a non-terminal instance, which is the safety net behind the 'Failed only' rule above
                await durableClient.PurgeInstanceAsync(instanceId);

                try
                {
                    await durableClient.ScheduleNewOrchestrationInstanceAsync(orchestratorName, input, options);
                }
                catch (Exception ex)
                {
                    this._logger.LogError(ex, "Instance {InstanceId} was purged but could not be re-created", instanceId);

                    return await req.ReturnJson(new
                    {
                        error = $"The instance was purged, but re-creating it failed: {ex.Message}. Start it again with the payload below.",
                        orchestratorName,
                        instanceId,
                        input = ToJToken(input)
                    }, status: HttpStatusCode.InternalServerError);
                }

                return await req.ReturnJson(new { instanceId, purged = true, input = ToJToken(input) });
            });
        }

        // Replaces the input of the last input-bearing event of a failed instance, then rewinds it.
        // Only the failed steps run again, now seeing the edited input.
        // POST /a/p/i/{connName}-{hubName}/orchestrations('<id>')/update-input-and-rewind
        // Body: { "sequenceNumber": 27, "input": <any JSON value>, "reason": "optional" }
        [Function(nameof(DfmUpdateInputAndRewindFunction))]
        [OperationKind(Kind = OperationKind.Write)]
        public Task<HttpResponseData> DfmUpdateInputAndRewindFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = Globals.ApiRoutePrefix + "/orchestrations('{instanceId}')/" + InputEventOperations.UpdateInputAndRewind)] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string instanceId)
        {
            return this.ExecuteAsync(req, async () =>
            {
                var body = await ReadBodyAsync(req);
                long sequenceNumber = GetSequenceNumber(body);
                if (!body.TryGetPropertyValue("input", out var input))
                {
                    throw new DfmBadRequestException("The request body must contain 'input' (the new payload; JSON null is allowed)");
                }
                string inputJson = input?.ToJsonString() ?? "null";
                string reason = GetString(body, "reason");

                if (this.ExtensionPoints.UpdateHistoryEventInputRoutine == null)
                {
                    throw new DfmNotSupportedException("Editing history events is not supported for this storage provider");
                }

                var instance = await this.LoadAsync(durableClient, connName, hubName, instanceId, loadParent: false);
                var target = FindEvent(this.ComputeEligibility(instance), sequenceNumber);

                EnsureAllowed(target, InputEventOperations.UpdateInputAndRewind);

                this._logger.LogWarning("Updating the input of event {SequenceNumber} ({EventType} {EventName}) of instance {InstanceId} and rewinding it", sequenceNumber, target.EventType, target.Name, instanceId);

                await this.ExtensionPoints.UpdateHistoryEventInputRoutine(durableClient, instance.ConnEnvVariableName, hubName, instanceId, sequenceNumber, inputJson);

                try
                {
                    await durableClient.RewindInstanceAsync(instanceId, string.IsNullOrEmpty(reason) ? DefaultRewindReason : reason);
                }
                catch (Exception ex)
                {
                    this._logger.LogError(ex, "The input of event {SequenceNumber} of instance {InstanceId} was updated, but the rewind failed", sequenceNumber, instanceId);

                    return await req.ReturnJson(new
                    {
                        error = $"The input was updated, but the rewind failed: {ex.Message}. Use the Rewind button to retry.",
                        sequenceNumber,
                        inputUpdated = true,
                        rewound = false
                    }, status: ex is InvalidOperationException ? HttpStatusCode.Conflict : HttpStatusCode.InternalServerError);
                }

                return await req.ReturnJson(new { sequenceNumber, inputUpdated = true, rewound = true });
            });
        }

        // Deletes the history from the last EventRaised event onward, reopens the instance and raises the event again
        // with the same or an edited input, so that everything after the event runs again.
        // POST /a/p/i/{connName}-{hubName}/orchestrations('<id>')/replay
        // Body: { "sequenceNumber": 27, "input": <any JSON value, optional>, "terminateIfRunning": false }
        [Function(nameof(DfmReplayFunction))]
        [OperationKind(Kind = OperationKind.Dangerous)]
        public Task<HttpResponseData> DfmReplayFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = Globals.ApiRoutePrefix + "/orchestrations('{instanceId}')/" + InputEventOperations.Replay)] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string instanceId)
        {
            return this.ExecuteAsync(req, async () =>
            {
                var body = await ReadBodyAsync(req);
                long sequenceNumber = GetSequenceNumber(body);
                bool hasInput = body.TryGetPropertyValue("input", out var editedInput);
                bool terminateIfRunning = GetBoolean(body, "terminateIfRunning");

                if (this.ExtensionPoints.TruncateHistoryRoutine == null)
                {
                    throw new DfmNotSupportedException("Truncating history is not supported for this storage provider");
                }

                var instance = await this.LoadAsync(durableClient, connName, hubName, instanceId, loadParent: false);
                var target = FindEvent(this.ComputeEligibility(instance), sequenceNumber);

                var operation = EnsureAllowed(target, InputEventOperations.Replay);

                // Captured before the history is touched
                var input = hasInput ? editedInput : ParseStoredPayload(await this.ReadEventInputAsync(instance, target));

                if (operation.RequiresTerminate == true)
                {
                    if (!terminateIfRunning)
                    {
                        throw new DfmConflictException($"Instance {instanceId} is {instance.Metadata.RuntimeStatus}. Replay needs an instance in a terminal state; send \"terminateIfRunning\": true to terminate it first.");
                    }

                    await TerminateAndWaitAsync(durableClient, instanceId);
                }

                this._logger.LogWarning("Replaying instance {InstanceId} from event {SequenceNumber} ({EventName}): truncating its history and raising the event again", instanceId, sequenceNumber, target.Name);

                int deletedRows = await this.ExtensionPoints.TruncateHistoryRoutine(durableClient, instance.ConnEnvVariableName, hubName, instanceId, sequenceNumber);

                try
                {
                    await durableClient.RaiseEventAsync(instanceId, target.Name, input);
                }
                catch (Exception ex)
                {
                    this._logger.LogError(ex, "The history of instance {InstanceId} was truncated, but raising event {EventName} failed", instanceId, target.Name);

                    return await req.ReturnJson(new
                    {
                        error = $"The history was truncated and the instance reopened, but raising the event failed: {ex.Message}. Raise event '{target.Name}' manually with the payload below.",
                        sequenceNumber,
                        eventName = target.Name,
                        deletedRows,
                        raised = false,
                        input = ToJToken(input)
                    }, status: HttpStatusCode.InternalServerError);
                }

                return await req.ReturnJson(new { sequenceNumber, eventName = target.Name, deletedRows, raised = true });
            });
        }

        private const string DefaultRewindReason = "Rewound by Durable Functions Monitor after an input update";

        // How long a 'terminateIfRunning' replay waits for the instance to actually terminate
        private static readonly TimeSpan TerminateTimeout = TimeSpan.FromSeconds(30);

        private readonly ILogger _logger;

        // Everything the endpoints know about the instance they work on
        private class InstanceContext
        {
            public string InstanceId { get; init; }
            public string HubName { get; init; }
            public string ConnEnvVariableName { get; init; }
            public DurableTaskClient DurableClient { get; init; }
            public OrchestrationMetadata Metadata { get; init; }
            public List<HistoryEvent> History { get; init; }
            public string ParentInstanceId { get; init; }
        }

        private async Task<InstanceContext> LoadAsync(DurableTaskClient durableClient, string connName, string hubName, string instanceId, bool loadParent)
        {
            if (ExpandedOrchestrationStatus.TryGetEntityInstanceId(instanceId, out _))
            {
                throw new DfmBadRequestException($"{instanceId} is a Durable Entity. Entities have no input events.");
            }

            var metadata = await durableClient.GetInstanceAsync(instanceId, getInputsAndOutputs: true)
                ?? throw new DfmNotFoundException($"Instance {instanceId} doesn't exist");

            string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

            var history = (await this.ExtensionPoints.GetInstanceHistoryRoutine(durableClient, connEnvVariableName, hubName, instanceId)).ToList();

            string parentInstanceId = null;
            if (loadParent)
            {
                try
                {
                    parentInstanceId = await this.ExtensionPoints.GetParentInstanceIdRoutine(durableClient, connEnvVariableName, hubName, instanceId);
                }
                catch (Exception ex)
                {
                    this._logger.LogWarning(ex, "Failed to get parent instanceId");
                }
            }

            return new InstanceContext
            {
                InstanceId = instanceId,
                HubName = hubName,
                ConnEnvVariableName = connEnvVariableName,
                DurableClient = durableClient,
                Metadata = metadata,
                History = history,
                ParentInstanceId = parentInstanceId
            };
        }

        private InputEventsResult ComputeEligibility(InstanceContext instance)
        {
            return InputEventEligibility.Compute(
                instance.InstanceId,
                instance.Metadata.RuntimeStatus,
                instance.ParentInstanceId,
                instance.History,
                this.Settings.DangerousOperationsEnabled,
                canUpdateInput: this.ExtensionPoints.UpdateHistoryEventInputRoutine != null,
                canTruncateHistory: this.ExtensionPoints.TruncateHistoryRoutine != null);
        }

        // The event's input, resolved through the storage provider when it keeps large payloads outside the history record
        private async Task<string> ReadEventInputAsync(InstanceContext instance, InputEventInfo evt)
        {
            if (evt.SequenceNumber.HasValue && this.ExtensionPoints.GetHistoryEventInputRoutine != null)
            {
                try
                {
                    return await this.ExtensionPoints.GetHistoryEventInputRoutine(instance.DurableClient, instance.ConnEnvVariableName, instance.HubName, instance.InstanceId, evt.SequenceNumber.Value);
                }
                catch (DfmNotFoundException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    this._logger.LogWarning(ex, "Failed to read the input of event {SequenceNumber} of instance {InstanceId} from storage, falling back to the history record", evt.SequenceNumber, instance.InstanceId);
                }
            }

            return evt.StoredInput;
        }

        // The initial input as the orchestrator saw it: the ExecutionStarted record, then the instance's own input field
        private async Task<string> ReadInitialInputAsync(InstanceContext instance, InputEventInfo executionStarted)
        {
            string input = await this.ReadEventInputAsync(instance, executionStarted);
            if (input != null)
            {
                return input;
            }

            input = instance.Metadata.SerializedInput;
            if (!LargeMessageBlobs.IsUrl(input))
            {
                return input;
            }

            // For a large initial input the instance's field holds the URL of the offloaded payload
            string blobUrl = input;
            input = await LargeMessageBlobs.DownloadByUrlAsync(instance.ConnEnvVariableName, blobUrl);

            // A '...-ExecutionStarted.json.gz' blob is a whole queue-message envelope, not the bare input
            if (blobUrl.EndsWith("ExecutionStarted.json.gz", StringComparison.OrdinalIgnoreCase))
            {
                input = JObject.Parse(input)["TaskMessage"]?["Event"]?["Input"]?.ToString();
            }

            return input;
        }

        private static async Task TerminateAndWaitAsync(DurableTaskClient durableClient, string instanceId)
        {
            try
            {
                await durableClient.TerminateInstanceAsync(instanceId, "Terminated by Durable Functions Monitor before a replay");
            }
            catch (InvalidOperationException ex)
            {
                throw new DfmConflictException($"Instance {instanceId} could not be terminated: {ex.Message}");
            }

            using (var cts = new CancellationTokenSource(TerminateTimeout))
            {
                try
                {
                    await durableClient.WaitForInstanceCompletionAsync(instanceId, getInputsAndOutputs: false, cts.Token);
                }
                catch (OperationCanceledException)
                {
                    throw new DfmConflictException($"Instance {instanceId} was asked to terminate, but did not reach a terminal state within {TerminateTimeout.TotalSeconds} seconds. Try again once it has.");
                }
            }
        }

        private static InputEventInfo FindEvent(InputEventsResult eligibility, long sequenceNumber)
        {
            return eligibility.Events.FirstOrDefault(e => e.SequenceNumber == sequenceNumber)
                ?? throw new DfmConflictException($"Event {sequenceNumber} is not an input-bearing event of the current execution. The history may have changed since it was read; reload and try again.");
        }

        private static InputEventOperationInfo EnsureAllowed(InputEventInfo evt, string operation)
        {
            var info = evt.Operations[operation];
            if (!info.Allowed)
            {
                throw new DfmConflictException(info.Reason);
            }

            return info;
        }

        // Maps the typed failures of these endpoints to status codes. Anything else stays with the middleware.
        private async Task<HttpResponseData> ExecuteAsync(HttpRequestData req, Func<Task<HttpResponseData>> action)
        {
            try
            {
                return await action();
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
            catch (DfmConflictException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.Conflict, ex.Message);
            }
            catch (DfmPayloadTooLargeException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.RequestEntityTooLarge, ex.Message);
            }
        }

        private static async Task<JsonObject> ReadBodyAsync(HttpRequestData req)
        {
            string bodyString = await req.ReadAsStringAsync();
            if (string.IsNullOrWhiteSpace(bodyString))
            {
                return new JsonObject();
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

        private static long GetSequenceNumber(JsonObject body)
        {
            if (!body.TryGetPropertyValue("sequenceNumber", out var node) || node == null)
            {
                throw new DfmBadRequestException("The request body must contain 'sequenceNumber' (as returned by the input-events endpoint)");
            }

            if (node is JsonValue value)
            {
                if (value.TryGetValue<long>(out long sequenceNumber))
                {
                    return sequenceNumber;
                }

                if (value.TryGetValue<string>(out string text) && long.TryParse(text, out sequenceNumber))
                {
                    return sequenceNumber;
                }
            }

            throw new DfmBadRequestException("'sequenceNumber' must be an integer");
        }

        private static bool GetBoolean(JsonObject body, string name)
        {
            if (!body.TryGetPropertyValue(name, out var node) || node == null)
            {
                return false;
            }

            if (node is JsonValue value && value.TryGetValue<bool>(out bool result))
            {
                return result;
            }

            throw new DfmBadRequestException($"'{name}' must be a boolean");
        }

        private static string GetString(JsonObject body, string name)
        {
            if (!body.TryGetPropertyValue(name, out var node) || node == null)
            {
                return null;
            }

            if (node is JsonValue value && value.TryGetValue<string>(out string result))
            {
                return result;
            }

            throw new DfmBadRequestException($"'{name}' must be a string");
        }

        // A payload as the storage provider stored it (already serialized JSON) into something the Durable client serializes back unchanged
        private static JsonNode ParseStoredPayload(string stored)
        {
            if (string.IsNullOrEmpty(stored))
            {
                return null;
            }

            try
            {
                return JsonNode.Parse(stored);
            }
            catch (System.Text.Json.JsonException)
            {
                // Not JSON, so a plain string it is
                return JsonValue.Create(stored);
            }
        }

        private static JToken ToJToken(JsonNode node)
        {
            return node == null ? null : ToJToken(node.ToJsonString());
        }

        private static JToken ToJToken(string stored)
        {
            if (stored == null)
            {
                return null;
            }

            try
            {
                // DateParseHandling.None keeps ISO date strings as strings, the way the orchestrator sees them
                return JsonConvert.DeserializeObject<JToken>(stored, StoredPayloadSerializerSettings);
            }
            catch (Newtonsoft.Json.JsonException)
            {
                return stored;
            }
        }

        private static readonly JsonSerializerSettings StoredPayloadSerializerSettings = new JsonSerializerSettings
        {
            DateParseHandling = DateParseHandling.None
        };
    }
}
