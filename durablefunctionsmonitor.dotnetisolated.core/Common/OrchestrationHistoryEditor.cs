// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Text;
using Azure;
using Azure.Data.Tables;
using Microsoft.DurableTask.Client;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Default (Azure Storage) implementations of the history-editing extension points.
    ///
    /// Works directly on the XXXHistory and XXXInstances tables, following the layout the Durable Task
    /// Framework's AzureTableTrackingStore writes:
    ///   - a history row's RowKey is the event's sequence number as 16 upper-case hex digits, and every row
    ///     carries the ExecutionId it belongs to (rows of previous generations can remain behind the current ones);
    ///   - a row with RowKey 'sentinel' holds the current ExecutionId, and sorts after every hex key;
    ///   - the next checkpoint numbers new rows from the current row count, so cutting the tail leaves no gap;
    ///   - payloads above 60 KB live in the '{taskhub}-largemessages' container, referenced by a '*BlobName' column.
    /// </summary>
    static class OrchestrationHistoryEditor
    {
        /// <summary>
        /// The threshold AzureTableTrackingStore applies (to the UTF-16 byte count) before moving a property into a blob
        /// </summary>
        internal const int MaxInlinePropertySizeInBytes = 60 * 1024;

        internal const string SentinelRowKey = "sentinel";

        internal const string ExecutionIdColumn = "ExecutionId";
        internal const string EventTypeColumn = "EventType";
        internal const string InputColumn = "Input";
        internal const string InputBlobNameColumn = "InputBlobName";
        internal const string RuntimeStatusColumn = "RuntimeStatus";
        internal const string RunningStatus = "Running";

        internal static string ToRowKey(long sequenceNumber)
        {
            return sequenceNumber.ToString("X16");
        }

        /// <summary>
        /// Reads the input of a single history event of the current execution, following an 'InputBlobName'
        /// reference when the framework offloaded the payload.
        /// </summary>
        public static async Task<string> GetEventInputAsync(DurableTaskClient durableClient, string connEnvVariableName, string hubName, string instanceId, long sequenceNumber)
        {
            var tableClient = TableClient.GetTableClient(connEnvVariableName);

            var instanceRow = await LoadInstanceRowAsync(tableClient, hubName, instanceId);
            var row = await LoadHistoryRowAsync(tableClient, hubName, instanceId, sequenceNumber, instanceRow.GetString(ExecutionIdColumn) ?? string.Empty);

            return await ReadInputAsync(connEnvVariableName, hubName, row);
        }

        /// <summary>
        /// Replaces the input of an ExecutionStarted or EventRaised event of the current execution.
        /// For ExecutionStarted the XXXInstances row, which has its own copy of the initial input, is updated too.
        /// </summary>
        public static async Task UpdateEventInputAsync(DurableTaskClient durableClient, string connEnvVariableName, string hubName, string instanceId, long sequenceNumber, string inputJson)
        {
            ArgumentNullException.ThrowIfNull(inputJson);
            ThrowIfTooLarge(inputJson);

            var tableClient = TableClient.GetTableClient(connEnvVariableName);

            var instanceRow = await LoadInstanceRowAsync(tableClient, hubName, instanceId);
            var row = await LoadHistoryRowAsync(tableClient, hubName, instanceId, sequenceNumber, instanceRow.GetString(ExecutionIdColumn) ?? string.Empty);

            string eventType = row.GetString(EventTypeColumn);
            if (eventType != HistoryEventTypes.ExecutionStarted && eventType != HistoryEventTypes.EventRaised)
            {
                throw new DfmConflictException($"Only ExecutionStarted and EventRaised events carry an editable input, but event {sequenceNumber} of instance {instanceId} is {eventType}");
            }

            // The framework reads a '*BlobName' column in preference to the column itself, so the reference has to go
            string oldBlobName = row.GetString(InputBlobNameColumn);
            row[InputColumn] = inputJson;
            row.Remove(InputBlobNameColumn);

            await ReplaceOrConflictAsync(tableClient, HistoryTable(hubName), row, $"history event {sequenceNumber} of instance {instanceId}");

            if (eventType == HistoryEventTypes.ExecutionStarted)
            {
                instanceRow[InputColumn] = inputJson;
                instanceRow.Remove(InputBlobNameColumn);

                await ReplaceOrConflictAsync(tableClient, InstancesTable(hubName), instanceRow, $"instance {instanceId}");
            }

            if (!string.IsNullOrEmpty(oldBlobName))
            {
                await LargeMessageBlobs.TryDeleteByNameAsync(connEnvVariableName, hubName, oldBlobName);
            }
        }

        /// <summary>
        /// Deletes the current execution's history from an EventRaised event onward, keeps the remaining history
        /// a sequence of complete episodes, and reopens the instance as Running, so that raising the event again
        /// makes the orchestrator continue from where it was waiting for it.
        /// </summary>
        /// <returns>The number of deleted history rows</returns>
        public static async Task<int> TruncateHistoryAsync(DurableTaskClient durableClient, string connEnvVariableName, string hubName, string instanceId, long fromSequenceNumber)
        {
            var tableClient = TableClient.GetTableClient(connEnvVariableName);
            string historyTable = HistoryTable(hubName);

            var instanceRow = await LoadInstanceRowAsync(tableClient, hubName, instanceId);
            string executionId = instanceRow.GetString(ExecutionIdColumn) ?? string.Empty;

            var targetRow = await LoadHistoryRowAsync(tableClient, hubName, instanceId, fromSequenceNumber, executionId);
            string targetType = targetRow.GetString(EventTypeColumn);
            if (targetType != HistoryEventTypes.EventRaised)
            {
                throw new DfmConflictException($"Replay can only start from an EventRaised event, but event {fromSequenceNumber} of instance {instanceId} is {targetType}");
            }

            // If the event opened its episode, the OrchestratorStarted marker right before it goes too,
            // so that the kept history ends with the previous episode's OrchestratorCompleted.
            long cutPoint = fromSequenceNumber;
            var previousRow = await TryLoadHistoryRowAsync(tableClient, hubName, instanceId, cutPoint - 1, executionId);
            if (previousRow?.GetString(EventTypeColumn) == HistoryEventTypes.OrchestratorStarted)
            {
                cutPoint--;
                previousRow = await TryLoadHistoryRowAsync(tableClient, hubName, instanceId, cutPoint - 1, executionId);
            }

            // Rows of previous generations are left alone: both the framework and DfMon's history reader stop at
            // the first row of another execution, and the framework's upserts overwrite them as the history grows again.
            // The sentinel row sorts after every hex key and carries the current ExecutionId too, so it is excluded by name.
            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and RowKey ge {ToRowKey(cutPoint)} and RowKey ne {SentinelRowKey} and ExecutionId eq {executionId}");

            // Highest key first: the target row is deleted last, so an interrupted run leaves a contiguous prefix that
            // still contains it, and the very same request can be retried.
            var rowsToDelete = (await tableClient.GetAllAsync(historyTable, filter))
                .OrderByDescending(r => r.RowKey, StringComparer.Ordinal)
                .ToList();

            await ThrowIfKeptWorkIsUnfinishedAsync(tableClient, historyTable, instanceId, executionId, cutPoint, fromSequenceNumber);

            // Nothing has been changed up to here. The first write is a conditional one on the Instances row: if the row
            // changed since it was read, someone else is working on this instance (a rewind, a restart) and we stop
            // before touching the history. The re-read gives the ETag the reopen at the end needs.
            instanceRow["LastUpdatedTime"] = DateTimeOffset.UtcNow;
            await ReplaceOrConflictAsync(tableClient, InstancesTable(hubName), instanceRow, $"instance {instanceId}");
            instanceRow = await LoadInstanceRowAsync(tableClient, hubName, instanceId);

            await TouchSentinelAsync(tableClient, historyTable, instanceId);

            var blobNames = rowsToDelete.SelectMany(GetBlobNames).ToList();

            await tableClient.DeleteEntitiesAsync(historyTable, rowsToDelete);

            // The event arrived mid-batch, after other events of the same episode. Close that episode, so the
            // kept history is a sequence of complete episodes and the next checkpoint starts right after it.
            if (previousRow != null && previousRow.GetString(EventTypeColumn) != HistoryEventTypes.OrchestratorCompleted)
            {
                await tableClient.UpsertEntityAsync(historyTable, new TableEntity(instanceId, ToRowKey(cutPoint))
                {
                    [EventTypeColumn] = HistoryEventTypes.OrchestratorCompleted,
                    ["EventId"] = -1,
                    ["IsPlayed"] = true,
                    ["_Timestamp"] = DateTimeOffset.UtcNow,
                    [ExecutionIdColumn] = executionId
                });
            }

            foreach (string blobName in blobNames)
            {
                await LargeMessageBlobs.TryDeleteByNameAsync(connEnvVariableName, hubName, blobName);
            }

            await ReopenInstanceAsync(tableClient, hubName, instanceId, instanceRow);

            return rowsToDelete.Count;
        }

        internal static string HistoryTable(string hubName) => $"{hubName}History";

        internal static string InstancesTable(string hubName) => $"{hubName}Instances";

        internal static bool IsTerminalStatus(string runtimeStatus)
        {
            return runtimeStatus is "Completed" or "Failed" or "Terminated" or "Canceled";
        }

        private static void ThrowIfTooLarge(string inputJson)
        {
            int sizeInBytes = Encoding.Unicode.GetByteCount(inputJson);
            if (sizeInBytes > MaxInlinePropertySizeInBytes)
            {
                throw new DfmPayloadTooLargeException($"The input is {sizeInBytes / 1024} KB, more than the {MaxInlinePropertySizeInBytes / 1024} KB a history record can hold inline. Editing payloads of that size is not supported yet.");
            }
        }

        private static readonly string[] SchedulingEventTypes = { "TaskScheduled", "SubOrchestrationInstanceCreated" };
        private static readonly string[] CompletionEventTypes = { "TaskCompleted", "TaskFailed", "SubOrchestrationInstanceCompleted", "SubOrchestrationInstanceFailed" };

        // Activities and sub-orchestrations scheduled before the cut point must have completed before it as well.
        // Otherwise the orchestrator would replay them as still pending and wait for completions that were consumed
        // (or discarded) long ago, and never arrive again. Timers are exempt: a timer the orchestrator no longer
        // awaits can fire or not without consequence.
        private static async Task ThrowIfKeptWorkIsUnfinishedAsync(ITableClient tableClient, string historyTable, string instanceId, string executionId, long cutPoint, long targetSequenceNumber)
        {
            string keptFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and RowKey lt {ToRowKey(cutPoint)} and ExecutionId eq {executionId}");

            var keptRows = (await tableClient.GetAllAsync(historyTable, keptFilter)).ToList();

            var completedIds = keptRows
                .Where(r => CompletionEventTypes.Contains(r.GetString(EventTypeColumn)))
                .Select(r => r.GetInt32("TaskScheduledId"))
                .Where(id => id.HasValue)
                .Select(id => id.Value)
                .ToHashSet();

            var unfinished = keptRows
                .Where(r => SchedulingEventTypes.Contains(r.GetString(EventTypeColumn)))
                .Where(r => !completedIds.Contains(r.GetInt32("EventId") ?? -1))
                .Select(r => $"{r.GetString(EventTypeColumn)} '{r.GetString("Name")}' (id {r.GetInt32("EventId")})")
                .ToList();

            if (unfinished.Count > 0)
            {
                throw new DfmConflictException(
                    $"Event {targetSequenceNumber} arrived while work scheduled before it was still running: {string.Join(", ", unfinished)}. " +
                    "Replaying from this event would leave the orchestrator waiting for completions that will never be delivered again. " +
                    "Use update-input-and-rewind (for a failed instance) or restart-in-place instead.");
            }
        }

        // The framework checkpoints with If-Match on the sentinel row. Writing it back unchanged bumps its ETag, so a
        // worker that still holds this instance's session fails its next checkpoint as split-brain, instead of writing
        // over the edited history.
        private static async Task TouchSentinelAsync(ITableClient tableClient, string historyTable, string instanceId)
        {
            var sentinel = await tableClient.GetEntityAsync(historyTable, instanceId, SentinelRowKey);
            if (sentinel != null)
            {
                await ReplaceOrConflictAsync(tableClient, historyTable, sentinel, $"history of instance {instanceId}");
            }
        }

        private static async Task<TableEntity> LoadInstanceRowAsync(ITableClient tableClient, string hubName, string instanceId)
        {
            var row = await tableClient.GetEntityAsync(InstancesTable(hubName), instanceId, string.Empty);

            return row ?? throw new DfmNotFoundException($"Instance {instanceId} doesn't exist");
        }

        private static async Task<TableEntity> LoadHistoryRowAsync(ITableClient tableClient, string hubName, string instanceId, long sequenceNumber, string executionId)
        {
            var row = await TryLoadHistoryRowAsync(tableClient, hubName, instanceId, sequenceNumber, executionId);

            return row ?? throw new DfmNotFoundException($"History event {sequenceNumber} of instance {instanceId} doesn't exist, or belongs to a previous execution");
        }

        // Returns null for a row that does not exist or belongs to another execution of the same instance
        private static async Task<TableEntity> TryLoadHistoryRowAsync(ITableClient tableClient, string hubName, string instanceId, long sequenceNumber, string executionId)
        {
            if (sequenceNumber < 0)
            {
                return null;
            }

            var row = await tableClient.GetEntityAsync(HistoryTable(hubName), instanceId, ToRowKey(sequenceNumber));

            return row != null && (row.GetString(ExecutionIdColumn) ?? string.Empty) == executionId ? row : null;
        }

        private static Task<string> ReadInputAsync(string connEnvVariableName, string hubName, TableEntity row)
        {
            string blobName = row.GetString(InputBlobNameColumn);

            return string.IsNullOrEmpty(blobName)
                ? Task.FromResult(row.GetString(InputColumn))
                : LargeMessageBlobs.DownloadByNameAsync(connEnvVariableName, hubName, blobName);
        }

        private static IEnumerable<string> GetBlobNames(TableEntity row)
        {
            return row
                .Where(p => p.Key.EndsWith(LargeMessageBlobs.BlobNameColumnSuffix, StringComparison.Ordinal) && p.Value is string)
                .Select(p => (string)p.Value)
                .Where(blobName => !string.IsNullOrEmpty(blobName));
        }

        private static async Task ReplaceOrConflictAsync(ITableClient tableClient, string tableName, TableEntity row, string what)
        {
            try
            {
                await tableClient.ReplaceEntityAsync(tableName, row);
            }
            catch (RequestFailedException ex) when (ex.Status == 412)
            {
                throw new DfmConflictException($"The {what} was modified concurrently. Reload and try again.");
            }
        }

        private static async Task ReopenInstanceAsync(ITableClient tableClient, string hubName, string instanceId, TableEntity instanceRow)
        {
            string instancesTable = InstancesTable(hubName);

            try
            {
                await tableClient.ReplaceEntityAsync(instancesTable, Reopen(instanceRow));
            }
            catch (RequestFailedException ex) when (ex.Status == 412)
            {
                // The row changed while the history was being deleted. A terminal instance has nothing running
                // that could have done that, so re-read and retry once. Anything else means something is active
                // on this instance, and rewriting its status would only make matters worse.
                var freshRow = await LoadInstanceRowAsync(tableClient, hubName, instanceId);

                string runtimeStatus = freshRow.GetString(RuntimeStatusColumn);
                if (!IsTerminalStatus(runtimeStatus))
                {
                    throw new DfmConflictException($"Instance {instanceId} changed to {runtimeStatus} while its history was being truncated. The history is truncated, but the instance was not reopened.");
                }

                await tableClient.ReplaceEntityAsync(instancesTable, Reopen(freshRow));
            }
        }

        private static TableEntity Reopen(TableEntity instanceRow)
        {
            instanceRow[RuntimeStatusColumn] = RunningStatus;
            instanceRow["LastUpdatedTime"] = DateTimeOffset.UtcNow;
            instanceRow.Remove("Output");
            instanceRow.Remove("CompletedTime");

            return instanceRow;
        }
    }
}
