// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.DurableTask.Client;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// A set of extension points that can be customized by the client code, when DFM is used in 'injected' mode.
    /// </summary>
    public class DfmExtensionPoints
    {
        /// <summary>
        /// Routine for fetching orchestration history.
        /// Takes IDurableClient, connString env variable name, taskHubName and instanceId and returns IEnumerable[HistoryEvent].
        /// Provide your own implementation for a custom storage provider.
        /// Default implementation fetches history directly from XXXHistory table.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, Task<IEnumerable<HistoryEvent>>> GetInstanceHistoryRoutine { get; set; }

        /// <summary>
        /// Routine for getting parent orchestration's Id.
        /// Takes IDurableClient, connString env variable name, taskHubName and instanceId and returns
        /// Id of parent orchestration, or null if the given instance is not a suborchestration.
        /// Provide your own implementation for a custom storage provider.
        /// Default implementation matches ExecutionId field in XXXInstances table.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, Task<string>> GetParentInstanceIdRoutine { get; set; }

        /// <summary>
        /// Routine for getting Task Hub names
        /// Takes connString env variable name and returns names of Task Hubs discovered there.
        /// Provide your own implementation for a custom storage provider.
        /// Default implementation traverses XXXInstances tables.
        /// </summary>
        public Func<string, Task<IEnumerable<string>>> GetTaskHubNamesRoutine { get; set; }

        /// <summary>
        /// Routine for reading the input of a single ExecutionStarted or EventRaised event, including payloads the
        /// storage provider keeps outside the history record.
        /// Takes IDurableClient, connString env variable name, taskHubName, instanceId and the event's SequenceNumber
        /// (as reported by GetInstanceHistoryRoutine) and returns the input as a JSON string, or null.
        /// Default implementation follows the 'InputBlobName' reference into the '{taskhub}-largemessages' container.
        /// Set to null if HistoryEvent.Input is always complete for your storage provider.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, long, Task<string>> GetHistoryEventInputRoutine { get; set; }

        /// <summary>
        /// Routine for replacing the input of a single ExecutionStarted or EventRaised event. Used by 'update-input-and-rewind'.
        /// Takes IDurableClient, connString env variable name, taskHubName, instanceId, the event's SequenceNumber and the new input as a JSON string.
        /// Default implementation edits the XXXHistory table (and XXXInstances, for ExecutionStarted) directly.
        /// Set to null if your storage provider does not support this; the endpoint then answers 400.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, long, string, Task> UpdateHistoryEventInputRoutine { get; set; }

        /// <summary>
        /// Routine for deleting an instance's history from an EventRaised event onward and reopening the instance as Running,
        /// so that the event can be raised again. Used by 'replay'.
        /// Takes IDurableClient, connString env variable name, taskHubName, instanceId and the event's SequenceNumber,
        /// and returns the number of deleted history records.
        /// Default implementation edits the XXXHistory and XXXInstances tables directly.
        /// Set to null if your storage provider does not support this; the endpoint then answers 400.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, long, Task<int>> TruncateHistoryRoutine { get; set; }

        public DfmExtensionPoints()
        {
            this.GetInstanceHistoryRoutine = OrchestrationHistory.GetHistoryDirectlyFromTable;
            this.GetParentInstanceIdRoutine = DetailedOrchestrationStatus.GetParentInstanceIdDirectlyFromTable;
            this.GetTaskHubNamesRoutine = Auth.GetTaskHubNamesFromStorage;
            this.GetHistoryEventInputRoutine = OrchestrationHistoryEditor.GetEventInputAsync;
            this.UpdateHistoryEventInputRoutine = OrchestrationHistoryEditor.UpdateEventInputAsync;
            this.TruncateHistoryRoutine = OrchestrationHistoryEditor.TruncateHistoryAsync;
        }
    }
}