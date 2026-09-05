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
        /// Name of the underlying storage provider, as reported by /about and used by the UI for display only
        /// (behaviour is driven by /about.capabilities, never by this name).
        /// Known values: "AzureStorage" (the default), "MsSql", "Netherite".
        /// </summary>
        public string ProviderName { get; set; } = "AzureStorage";

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
        /// Default implementation reads the ParentInstanceId column of the XXXInstances row, and falls back to matching
        /// the ExecutionId (old-format ids) or scanning the XXXHistory table when the column is absent.
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

        /// <summary>
        /// Routine for producing the Task Hub statistics of the /stats endpoint.
        /// Takes IDurableClient, connString env variable name, taskHubName, the (already validated) StatsQuery
        /// and a CancellationToken, and returns a StatsResult aggregated over a bounded instance scan.
        /// Default implementation scans the XXXInstances table (added by B1).
        /// Null means the provider does not support it: the endpoint answers 400 and /about reports
        /// capabilities.stats == false, so the UI hides the feature.
        /// </summary>
        public Func<DurableTaskClient, string, string, StatsQuery, CancellationToken, Task<StatsResult>> GetStatsRoutine { get; set; }

        /// <summary>
        /// Routine for producing the grouped failures of the /failures endpoint.
        /// Takes IDurableClient, connString env variable name, taskHubName, the (already validated) FailuresQuery
        /// and a CancellationToken, and returns a FailuresResult grouped by orchestrator name and error signature.
        /// Default implementation scans the failed rows of the XXXInstances table (added by B3).
        /// Null means the provider does not support it: the endpoint answers 400 and /about reports
        /// capabilities.failures == false.
        /// </summary>
        public Func<DurableTaskClient, string, string, FailuresQuery, CancellationToken, Task<FailuresResult>> GetFailuresRoutine { get; set; }

        /// <summary>
        /// Routine for listing the sub-orchestrations of an instance.
        /// Takes IDurableClient, connString env variable name, taskHubName and instanceId, and returns
        /// a ChildrenResult (Complete tells whether the list is guaranteed to be exhaustive).
        /// Default implementation matches the generated child instance ids in the XXXInstances table (added by B1).
        /// Null means the provider does not support it: the endpoint answers 400 and /about reports
        /// capabilities.children == false.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, Task<ChildrenResult>> GetChildrenRoutine { get; set; }

        /// <summary>
        /// Routine for reading the orchestrator episodes (OrchestratorStarted/OrchestratorCompleted pairs)
        /// of an instance, used by the /spans endpoint to draw the orchestrator lane.
        /// Takes IDurableClient, connString env variable name, taskHubName and instanceId, and returns
        /// the markers in chronological order (the last one may be open, i.e. End == null).
        /// Default implementation reads the XXXHistory table (added by B2).
        /// Null means the provider does not support it: /spans then reports no orchestrator spans and
        /// totals.orchestratorMs == null, and /about reports capabilities.episodeMarkers == false.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, Task<IReadOnlyList<EpisodeMarker>>> GetEpisodeMarkersRoutine { get; set; }

        /// <summary>
        /// Routine for reading the storage row of an instance (execution id, generation, history size estimate),
        /// values the DurableTaskClient does not expose.
        /// Takes IDurableClient, connString env variable name, taskHubName and instanceId, and returns an
        /// InstanceRowInfo (its individual properties may be null).
        /// Default implementation reads the XXXInstances row (added by B2).
        /// Null means the provider does not support it: the corresponding fields of /spans are null.
        /// </summary>
        public Func<DurableTaskClient, string, string, string, Task<InstanceRowInfo>> GetInstanceRowInfoRoutine { get; set; }

        /// <summary>
        /// Routine for collecting the storage health of a Task Hub (queues, partitions, tables, large messages)
        /// for the /storage endpoint.
        /// Takes connString env variable name, taskHubName, whether to also count table rows (expensive),
        /// an optional instanceId to scope the large-message stats to, and a CancellationToken.
        /// Default implementation talks to the Azure Storage account directly (added by B4).
        /// Null means the provider does not support it: the endpoint answers 400 and /about reports
        /// capabilities.storageHealth == false.
        /// </summary>
        public Func<string, string, bool, string, CancellationToken, Task<StorageHealthResult>> GetStorageHealthRoutine { get; set; }

        /// <summary>
        /// Routine for recording one Write or Dangerous operation in the audit log.
        /// Takes connString env variable name, taskHubName and the AuditRecord to append.
        /// Default implementation appends to the XXXDfmAudit table (added by B5).
        /// Called fire-and-forget by the middleware and only when auditing is enabled;
        /// null means the provider cannot store audit records, so nothing is written.
        /// </summary>
        public Func<string, string, AuditRecord, Task> WriteAuditRecordRoutine { get; set; }

        /// <summary>
        /// Routine for reading the audit log for the /audit endpoint.
        /// Takes connString env variable name, taskHubName and the (already validated) AuditQuery,
        /// and returns one page of records, newest first.
        /// Default implementation reads the XXXDfmAudit table (added by B5).
        /// Null means the provider cannot serve audit records: /about reports capabilities.audit == false
        /// and the endpoint answers with an empty, disabled page.
        /// </summary>
        public Func<string, string, AuditQuery, Task<AuditPage>> ReadAuditRecordsRoutine { get; set; }

        public DfmExtensionPoints()
        {
            this.GetInstanceHistoryRoutine = OrchestrationHistory.GetHistoryDirectlyFromTable;
            this.GetParentInstanceIdRoutine = DetailedOrchestrationStatus.GetParentInstanceIdDirectlyFromTable;
            this.GetTaskHubNamesRoutine = Auth.GetTaskHubNamesFromStorage;
            this.GetHistoryEventInputRoutine = OrchestrationHistoryEditor.GetEventInputAsync;
            this.UpdateHistoryEventInputRoutine = OrchestrationHistoryEditor.UpdateEventInputAsync;
            this.TruncateHistoryRoutine = OrchestrationHistoryEditor.TruncateHistoryAsync;

            // The aggregation routines above (stats, failures, children, episode markers, instance row info,
            // storage health, audit) intentionally stay null here. Each of the B1-B5 epics assigns its own
            // Azure Storage default; until then the corresponding endpoints answer 400 and /about reports
            // the capability as false for every provider.
        }
    }
}