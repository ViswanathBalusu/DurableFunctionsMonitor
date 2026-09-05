// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Text.Json.Nodes;
using Microsoft.DurableTask.Client;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The names of the eight instance-level actions handled by <see cref="OrchestrationActions.ExecuteAsync"/>.
    /// </summary>
    public static class OrchestrationActionNames
    {
        /// <summary>Pause the instance until resumed</summary>
        public const string Suspend = "suspend";

        /// <summary>Resume a suspended instance</summary>
        public const string Resume = "resume";

        /// <summary>Delete the instance's history and metadata</summary>
        public const string Purge = "purge";

        /// <summary>Re-run a failed instance from its last checkpoint</summary>
        public const string Rewind = "rewind";

        /// <summary>Stop a running instance</summary>
        public const string Terminate = "terminate";

        /// <summary>Raise an external event at an instance, or signal a Durable Entity</summary>
        public const string RaiseEvent = "raise-event";

        /// <summary>Set or clear the instance's custom status</summary>
        public const string SetCustomStatus = "set-custom-status";

        /// <summary>Purge and re-create an instance from its original input, optionally under a new instance id</summary>
        public const string Restart = "restart";

        /// <summary>All eight action names</summary>
        public static readonly string[] All = new[]
        {
            Suspend, Resume, Purge, Rewind, Terminate, RaiseEvent, SetCustomStatus, Restart
        };

        /// <summary>The actions that make no sense for a Durable Entity (which has no runtime status, no rewind/restart semantics)</summary>
        public static readonly string[] OrchestrationOnly = new[] { Suspend, Resume, Rewind, Restart };
    }

    /// <summary>
    /// The single set of instance-level action handlers (suspend, resume, purge, rewind, terminate, raise-event,
    /// set-custom-status, restart), shared by the single-instance endpoint (<c>Orchestration.DfmPostOrchestrationFunction</c>)
    /// and the batch endpoint (<c>Batch.DfmBatchFunction</c>), so both apply exactly the same rules to an instance.
    /// </summary>
    public static class OrchestrationActions
    {
        /// <summary>
        /// Runs one of the eight actions above against the Durable Task client (and, for 'set-custom-status',
        /// directly against the Instances table, since there is no client API for it).
        /// </summary>
        /// <param name="payload">
        /// Carries whatever the action needs: 'reason' (suspend/resume/rewind/terminate), 'name'/'data' (raise-event),
        /// 'customStatus' (set-custom-status), 'restartWithNewInstanceId' (restart). May be null or miss the property
        /// an action does not need.
        /// </param>
        /// <exception cref="DfmBadRequestException">The action is not one of the eight known ones, or a required
        /// payload property is missing or of the wrong type.</exception>
        /// <exception cref="DfmConflictException">The Durable Task client refused the operation because a
        /// precondition does not hold (wrong runtime status, a stale rewind/restart, ...).</exception>
        public static async Task ExecuteAsync(
            DurableTaskClient durableClient,
            string connName,
            string instanceId,
            string action,
            JsonObject payload)
        {
            switch (action)
            {
                case OrchestrationActionNames.Suspend:
                {
                    string reason = GetString(payload, "reason");
                    await RunAsync(() => durableClient.SuspendInstanceAsync(instanceId, reason));
                    return;
                }

                case OrchestrationActionNames.Resume:
                {
                    string reason = GetString(payload, "reason");
                    await RunAsync(() => durableClient.ResumeInstanceAsync(instanceId, reason));
                    return;
                }

                case OrchestrationActionNames.Purge:
                {
                    await RunAsync(() => durableClient.PurgeInstanceAsync(instanceId));
                    return;
                }

                case OrchestrationActionNames.Rewind:
                {
                    string reason = GetString(payload, "reason");
                    await RunAsync(() => durableClient.RewindInstanceAsync(instanceId, reason));
                    return;
                }

                case OrchestrationActionNames.Terminate:
                {
                    string reason = GetString(payload, "reason");
                    await RunAsync(() => durableClient.TerminateInstanceAsync(instanceId, reason));
                    return;
                }

                case OrchestrationActionNames.RaiseEvent:
                {
                    string eventName = GetString(payload, "name")
                        ?? throw new DfmBadRequestException("The request body must contain 'name' (the event to raise)");
                    var eventData = payload?["data"];

                    // if this looks like an Entity
                    if (ExpandedOrchestrationStatus.TryGetEntityInstanceId(instanceId, out var entityInstanceId))
                    {
                        // then sending signal
                        await RunAsync(() => durableClient.Entities.SignalEntityAsync(entityInstanceId, eventName, eventData));
                    }
                    else
                    {
                        // otherwise raising event
                        await RunAsync(() => durableClient.RaiseEventAsync(instanceId, eventName, eventData));
                    }

                    return;
                }

                case OrchestrationActionNames.SetCustomStatus:
                {
                    await SetCustomStatusAsync(durableClient, connName, instanceId, payload);
                    return;
                }

                case OrchestrationActionNames.Restart:
                {
                    bool restartWithNewInstanceId = GetBoolean(payload, "restartWithNewInstanceId");
                    await RunAsync(() => durableClient.RestartAsync(instanceId, restartWithNewInstanceId));
                    return;
                }

                default:
                    throw new DfmBadRequestException($"'{action}' is not a known orchestration action");
            }
        }

        // Updating the table directly, as there is no other known way
        private static async Task SetCustomStatusAsync(DurableTaskClient durableClient, string connName, string instanceId, JsonObject payload)
        {
            var tableClient = TableClient.GetTableClient(Globals.GetFullConnectionStringEnvVariableName(connName));
            string tableName = $"{durableClient.Name}Instances";

            var orcEntity = await tableClient.GetEntityAsync(tableName, instanceId, string.Empty);

            var customStatus = payload?["customStatus"];
            if (customStatus == null)
            {
                orcEntity.Remove("CustomStatus");
            }
            else
            {
                // Round-tripping through Newtonsoft, so that a custom status ends up formatted exactly the way
                // it always has been, regardless of which JSON library produced the payload.
                orcEntity["CustomStatus"] = JObject.Parse(customStatus.ToJsonString()).ToString();
            }

            await tableClient.ReplaceEntityAsync(tableName, orcEntity);
        }

        // The Durable Task client throws this when a precondition doesn't hold (wrong runtime status, a stale
        // rewind/restart, ...): a conflict, not a bad request, so callers map it to 409.
        private static async Task RunAsync(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch (InvalidOperationException ex)
            {
                throw new DfmConflictException(ex.Message);
            }
        }

        private static string GetString(JsonObject payload, string propertyName)
        {
            if (payload == null || !payload.TryGetPropertyValue(propertyName, out var node) || node == null)
            {
                return null;
            }

            if (node is JsonValue value && value.TryGetValue<string>(out string result))
            {
                return result;
            }

            throw new DfmBadRequestException($"'{propertyName}' must be a string");
        }

        private static bool GetBoolean(JsonObject payload, string propertyName)
        {
            if (payload == null || !payload.TryGetPropertyValue(propertyName, out var node) || node == null)
            {
                return false;
            }

            if (node is JsonValue value && value.TryGetValue<bool>(out bool result))
            {
                return result;
            }

            throw new DfmBadRequestException($"'{propertyName}' must be a boolean");
        }
    }
}
