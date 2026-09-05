// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Azure.Data.Tables;
using Microsoft.DurableTask.Client;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Default (Azure Storage) implementations of the aggregation extension points - the routines that answer
    /// questions the DurableTaskClient cannot, by reading the XXXInstances/XXXHistory tables directly.
    ///
    /// Everything here follows the layout the Durable Task Framework's AzureTableTrackingStore writes:
    ///   - the XXXInstances row of an instance is (PartitionKey = instanceId, RowKey = ""), and carries
    ///     ExecutionId, RuntimeStatus, Generation and the rest of the instance's state;
    ///   - a history row's RowKey is the event's sequence number as 16 upper-case hex digits, so ordering
    ///     rows by RowKey is ordering them by sequence number;
    ///   - every history row carries the ExecutionId it belongs to (rows of previous generations remain
    ///     behind the current ones), plus its own _Timestamp;
    ///   - each orchestrator episode (one replay of the orchestrator function) is wrapped in an
    ///     'OrchestratorStarted' ... 'OrchestratorCompleted' pair of rows.
    ///
    /// Every scan here is bounded: nothing ever reads a whole table.
    /// </summary>
    static class AzureStorageAggregations
    {
        /// <summary>
        /// Reads the orchestrator episodes of an instance's current execution, in chronological order.
        /// The last marker is left open (End == null) when the instance sits between OrchestratorStarted and
        /// OrchestratorCompleted, i.e. when the orchestrator is running right now.
        /// Returns an empty list when the instance (or its history) is gone.
        /// </summary>
        public static async Task<IReadOnlyList<EpisodeMarker>> GetEpisodeMarkersAsync(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            var tableClient = TableClient.GetTableClient(connName);

            // The history table also holds the rows of the generations that ran before this one, so the
            // current ExecutionId (which only the instance row knows) is what tells them apart.
            var instanceEntity = await tableClient.GetEntityAsync($"{hubName}Instances", instanceId, string.Empty);
            if (instanceEntity == null)
            {
                // No such instance (or it was purged). Nothing to correlate against, so no episodes.
                return Array.Empty<EpisodeMarker>();
            }

            // Coalescing to string.Empty because CreateQueryFilter would otherwise emit "eq null",
            // which Table Storage rejects.
            string executionId = instanceEntity.GetString(ExecutionIdColumn) ?? string.Empty;

            // CreateQueryFilter escapes the interpolated values, so instanceId cannot break out of the filter.
            // The event type is part of the filter (and not only of the loop below) because an episode marker
            // is one row in a handful: pulling the rest over the wire just to drop it would make the scan cap
            // below bite on instances that are nowhere near that many episodes deep.
            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and ExecutionId eq {executionId} and (EventType eq {OrchestratorStartedEventType} or EventType eq {OrchestratorCompletedEventType})");

            var (rows, _) = await tableClient.QueryAsync($"{hubName}History", filter, MarkerColumns, MaxEpisodeMarkerRowsToScan, CancellationToken.None);

            // Table Storage returns a partition ordered by RowKey, but a projected, capped query is not worth
            // trusting on that: the hex row keys sort exactly like the sequence numbers they encode.
            var markerRows = rows.OrderBy(row => row.RowKey, StringComparer.Ordinal);

            var result = new List<EpisodeMarker>();
            DateTimeOffset? episodeStart = null;

            foreach (var row in markerRows)
            {
                var timestamp = row.GetDateTimeOffset(TimestampColumn);
                if (timestamp == null)
                {
                    // A row without a timestamp cannot be placed on a timeline
                    continue;
                }

                if (row.GetString(EventTypeColumn) == OrchestratorStartedEventType)
                {
                    if (episodeStart != null)
                    {
                        // An episode that never completed (the host crashed mid-replay, say). It stays open,
                        // and the row that follows it opens the next one.
                        result.Add(new EpisodeMarker { Start = episodeStart.Value, End = null });
                    }

                    episodeStart = timestamp.Value.ToUniversalTime();
                }
                else if (episodeStart != null)
                {
                    result.Add(new EpisodeMarker { Start = episodeStart.Value, End = timestamp.Value.ToUniversalTime() });

                    episodeStart = null;
                }
            }

            if (episodeStart != null)
            {
                // The orchestrator is running right now
                result.Add(new EpisodeMarker { Start = episodeStart.Value, End = null });
            }

            return result;
        }

        /// <summary>
        /// Reads the values of an instance's XXXInstances row that the DurableTaskClient does not expose.
        /// Returns null when there is no such row (the instance never existed, or was purged).
        /// HistoryBytesEstimate is always null here: Azure Storage cannot tell the size of a history without
        /// reading all of it, so /spans estimates it from the history it has loaded anyway.
        /// </summary>
        public static async Task<InstanceRowInfo> GetInstanceRowInfoAsync(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            var tableClient = TableClient.GetTableClient(connName);

            var instanceEntity = await tableClient.GetEntityAsync($"{hubName}Instances", instanceId, string.Empty);
            if (instanceEntity == null)
            {
                return null;
            }

            return new InstanceRowInfo
            {
                ExecutionId = instanceEntity.GetString(ExecutionIdColumn),
                Generation = TryGetInt32(instanceEntity, GenerationColumn),
                HistoryBytesEstimate = null
            };
        }

        // TableEntity.GetInt32() casts, so it throws when the column was written as an Int64 (or as a string,
        // by a tool other than the framework). None of that is worth failing a request over: a value that does
        // not look like a number simply reads as 'unknown'.
        private static int? TryGetInt32(TableEntity entity, string columnName)
        {
            if (!entity.TryGetValue(columnName, out object value) || value == null)
            {
                return null;
            }

            switch (value)
            {
                case int intValue:
                    return intValue;
                case long longValue:
                    return longValue >= int.MinValue && longValue <= int.MaxValue ? (int)longValue : null;
                case string stringValue:
                    return int.TryParse(stringValue, out int parsedValue) ? parsedValue : null;
                default:
                    return null;
            }
        }

        internal const string OrchestratorStartedEventType = "OrchestratorStarted";
        internal const string OrchestratorCompletedEventType = "OrchestratorCompleted";

        private const string ExecutionIdColumn = "ExecutionId";
        private const string EventTypeColumn = "EventType";
        private const string GenerationColumn = "Generation";
        private const string TimestampColumn = "_Timestamp";

        // An orchestrator replays once per event it observes, so this cap covers instances tens of thousands
        // of episodes deep. Beyond it the timeline is cut short rather than the query running away with the
        // history table.
        internal const int MaxEpisodeMarkerRowsToScan = 20000;

        // PartitionKey and RowKey come back regardless - ITableClient adds them to every projection
        private static readonly string[] MarkerColumns = new[] { EventTypeColumn, TimestampColumn };
    }
}
