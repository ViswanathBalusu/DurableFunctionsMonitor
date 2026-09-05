// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.DurableTask.Client;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Names of the operations DfMon offers on an instance's input-bearing history events
    /// (ExecutionStarted and EventRaised). They double as the route segments of the corresponding endpoints.
    /// </summary>
    public static class InputEventOperations
    {
        /// <summary>Purge a failed instance and re-create it under the same ID with the same or an edited initial input</summary>
        public const string RestartInPlace = "restart-in-place";

        /// <summary>Replace the input of the last input-bearing event of a failed instance, then rewind it</summary>
        public const string UpdateInputAndRewind = "update-input-and-rewind";

        /// <summary>Delete the history from the last EventRaised event onward and raise the event again</summary>
        public const string Replay = "replay";

        /// <summary>All of the above</summary>
        public static readonly string[] All = new[] { RestartInPlace, UpdateInputAndRewind, Replay };
    }

    /// <summary>
    /// Whether one operation can be applied to one input event, and why not otherwise
    /// </summary>
    class InputEventOperationInfo
    {
        public bool Allowed { get; set; }

        public string Reason { get; set; }

        /// <summary>
        /// Replay only: the instance is not in a terminal state yet, so the request must carry terminateIfRunning
        /// </summary>
        public bool? RequiresTerminate { get; set; }

        public string Warning { get; set; }
    }

    class InputEventInfo
    {
        public long? SequenceNumber { get; set; }
        public string EventType { get; set; }
        public string Name { get; set; }
        public DateTimeOffset Timestamp { get; set; }
        public JToken Input { get; set; }

        /// <summary>
        /// Set when the stored payload could not be read; Input then shows what the history record itself holds
        /// </summary>
        public string InputError { get; set; }

        public bool IsLast { get; set; }
        public Dictionary<string, InputEventOperationInfo> Operations { get; set; } = new Dictionary<string, InputEventOperationInfo>();

        // The input as the history routine reported it. Not part of the response: Input carries the resolved value.
        [JsonIgnore]
        public string StoredInput { get; set; }
    }

    class InputEventsStorageSupport
    {
        public bool UpdateInput { get; set; }
        public bool TruncateHistory { get; set; }
    }

    /// <summary>
    /// Response of the input-events endpoint
    /// </summary>
    class InputEventsResult
    {
        public string InstanceId { get; set; }
        public OrchestrationRuntimeStatus RuntimeStatus { get; set; }
        public string ParentInstanceId { get; set; }
        public bool DangerousOperationsEnabled { get; set; }
        public InputEventsStorageSupport StorageSupports { get; set; }
        public List<InputEventInfo> Events { get; set; } = new List<InputEventInfo>();
    }

    /// <summary>
    /// The rules for which operation applies to which input event. Pure: every write endpoint re-evaluates
    /// them before touching storage, and the read endpoint returns their outcome, so the UI never has to encode them.
    /// </summary>
    static class InputEventEligibility
    {
        public static bool IsTerminal(OrchestrationRuntimeStatus status)
        {
            return status is OrchestrationRuntimeStatus.Completed
                or OrchestrationRuntimeStatus.Failed
                or OrchestrationRuntimeStatus.Terminated;
        }

        public static InputEventsResult Compute(
            string instanceId,
            OrchestrationRuntimeStatus status,
            string parentInstanceId,
            IReadOnlyList<HistoryEvent> history,
            bool dangerousOperationsEnabled,
            bool canUpdateInput,
            bool canTruncateHistory)
        {
            var result = new InputEventsResult
            {
                InstanceId = instanceId,
                RuntimeStatus = status,
                ParentInstanceId = parentInstanceId,
                DangerousOperationsEnabled = dangerousOperationsEnabled,
                StorageSupports = new InputEventsStorageSupport { UpdateInput = canUpdateInput, TruncateHistory = canTruncateHistory }
            };

            // Only the current execution matters. ContinueAsNew starts a new one with its own ExecutionStarted,
            // and some history routines return the previous generations too.
            int currentExecutionStart = LastIndexOf(history, HistoryEventTypes.ExecutionStarted);
            var currentExecution = currentExecutionStart < 0 ? history : history.Skip(currentExecutionStart).ToList();

            var inputEvents = currentExecution
                .Where(e => e.EventType == HistoryEventTypes.ExecutionStarted || e.EventType == HistoryEventTypes.EventRaised)
                .ToList();

            var raisedEvents = inputEvents.Where(e => e.EventType == HistoryEventTypes.EventRaised).ToList();
            bool hasRaisedEvents = raisedEvents.Count > 0;

            // The last input-bearing event: the last EventRaised, or ExecutionStarted when there is none
            var lastEvent = raisedEvents.LastOrDefault() ?? inputEvents.LastOrDefault();

            bool isFailed = status == OrchestrationRuntimeStatus.Failed;
            bool isTerminal = IsTerminal(status);
            bool isSubOrchestration = !string.IsNullOrEmpty(parentInstanceId);
            string subOrchestrationWarning = isSubOrchestration ? "This is a sub-orchestration. Its parent will not be re-run." : null;

            foreach (var evt in inputEvents)
            {
                var info = new InputEventInfo
                {
                    SequenceNumber = evt.SequenceNumber,
                    EventType = evt.EventType,
                    Name = evt.Name,
                    Timestamp = evt.Timestamp,
                    IsLast = ReferenceEquals(evt, lastEvent),
                    StoredInput = evt.Input
                };

                if (evt.SequenceNumber == null)
                {
                    DisallowAll(info, "The storage provider does not report sequence numbers, so this event cannot be addressed.");
                }
                else if (evt.EventType == HistoryEventTypes.ExecutionStarted)
                {
                    info.Operations[InputEventOperations.RestartInPlace] =
                        !dangerousOperationsEnabled ? NotAllowed(DangerousOperationsDisabledReason) :
                        !isFailed ? NotAllowed($"Only failed instances can be restarted in place, and this one is {status}.") :
                        hasRaisedEvents ? NotAllowed("The instance has received external events. Use replay or update-input-and-rewind on the last one instead.") :
                        isSubOrchestration ? NotAllowed("Sub-orchestrations cannot be restarted in place, because the parent would never receive their result.") :
                        Allowed();

                    info.Operations[InputEventOperations.UpdateInputAndRewind] =
                        hasRaisedEvents ? NotAllowed("Only the last input-bearing event can be edited, and this instance has received external events since it started.") :
                        !isFailed ? NotAllowed($"Only failed instances can be rewound, and this one is {status}.") :
                        !canUpdateInput ? NotAllowed(StorageProviderReason) :
                        Allowed(subOrchestrationWarning);

                    info.Operations[InputEventOperations.Replay] =
                        NotAllowed("Use restart-in-place to re-run the whole instance from its initial input.");
                }
                else if (!info.IsLast)
                {
                    DisallowAll(info, "Only the last input-bearing event can be edited or replayed.");
                }
                else
                {
                    info.Operations[InputEventOperations.RestartInPlace] =
                        NotAllowed("Restart in place applies to the initial input only.");

                    info.Operations[InputEventOperations.UpdateInputAndRewind] =
                        !isFailed ? NotAllowed($"Only failed instances can be rewound, and this one is {status}.") :
                        !canUpdateInput ? NotAllowed(StorageProviderReason) :
                        Allowed(subOrchestrationWarning);

                    info.Operations[InputEventOperations.Replay] =
                        !dangerousOperationsEnabled ? NotAllowed(DangerousOperationsDisabledReason) :
                        !canTruncateHistory ? NotAllowed(StorageProviderReason) :
                        new InputEventOperationInfo { Allowed = true, RequiresTerminate = !isTerminal, Warning = subOrchestrationWarning };
                }

                result.Events.Add(info);
            }

            return result;
        }

        private const string DangerousOperationsDisabledReason = "Dangerous operations are disabled for this deployment (DFM_DANGEROUS_OPERATIONS_ENABLED).";
        private const string StorageProviderReason = "The configured storage provider does not support this operation.";

        private static InputEventOperationInfo Allowed(string warning = null)
        {
            return new InputEventOperationInfo { Allowed = true, Warning = warning };
        }

        private static InputEventOperationInfo NotAllowed(string reason)
        {
            return new InputEventOperationInfo { Allowed = false, Reason = reason };
        }

        private static void DisallowAll(InputEventInfo info, string reason)
        {
            foreach (string operation in InputEventOperations.All)
            {
                info.Operations[operation] = NotAllowed(reason);
            }
        }

        private static int LastIndexOf(IReadOnlyList<HistoryEvent> history, string eventType)
        {
            for (int i = history.Count - 1; i >= 0; i--)
            {
                if (history[i].EventType == eventType)
                {
                    return i;
                }
            }

            return -1;
        }
    }
}
