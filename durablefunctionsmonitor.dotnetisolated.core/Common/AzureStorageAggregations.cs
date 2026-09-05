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
        /// Produces the Task Hub statistics of the /stats endpoint from one bounded, projected scan of the
        /// XXXInstances table: every row created inside [From, To], with only the five columns the aggregation
        /// needs (plus PartitionKey, which ITableClient adds to every projection and which is the instance id).
        ///
        /// The scan is capped at <see cref="StatsQuery.Cap"/> rows (<see cref="DefaultStatsScanCap"/> when the
        /// caller left it unset); hitting the cap is reported honestly as StatsResult.Partial, never hidden.
        /// All the counting itself lives in the pure <see cref="StatsAggregator"/>, so Azure Storage and MSSQL
        /// reach the same numbers from the same rows.
        /// </summary>
        public static async Task<StatsResult> GetStatsAsync(DurableTaskClient durableClient, string connName, string hubName, StatsQuery query, CancellationToken ct)
        {
            ArgumentNullException.ThrowIfNull(query);

            var tableClient = TableClient.GetTableClient(connName);

            // A cap of 0 means 'the caller did not set one' (ITableClient.QueryAsync rejects anything below 1),
            // so fall back to the documented default rather than failing the request.
            int cap = query.Cap > 0 ? query.Cap : DefaultStatsScanCap;

            // CreateQueryFilter escapes and formats the interpolated values, so the dates come out as the
            // Edm.DateTime literals Table Storage expects. Both ends are inclusive, matching StatsAggregator's
            // binning rule (a row exactly at To lands in the last bin).
            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"CreatedTime ge {query.From} and CreatedTime le {query.To}");

            var (rows, truncated) = await tableClient.QueryAsync($"{hubName}Instances", filter, StatsColumns, cap, ct);

            var instanceRows = rows.Select(row => new InstanceRowLite
            {
                // The Instances row of an instance is (PartitionKey = instanceId, RowKey = "")
                InstanceId = row.PartitionKey,
                Name = row.GetString(NameColumn),
                RuntimeStatus = row.GetString(RuntimeStatusColumn),
                CreatedTime = TryGetDateTimeOffset(row, CreatedTimeColumn) ?? default,
                LastUpdatedTime = TryGetDateTimeOffset(row, LastUpdatedTimeColumn) ?? default,
                CompletedTime = TryGetDateTimeOffset(row, CompletedTimeColumn)
            });

            return StatsAggregator.Aggregate(instanceRows, query, DateTimeOffset.UtcNow, truncated, cap);
        }

        /// <summary>
        /// Produces the /failures response from one bounded, projected scan of the XXXInstances table: every
        /// Failed row created inside [From, To], with only the columns the grouping needs.
        ///
        /// The reason a row failed is its Output. When the output was too big for a table column the
        /// framework stores a blob URL there instead; those are downloaded (at most
        /// <see cref="MaxFailureOutputDownloads"/> per request, so one request cannot turn into hundreds of
        /// blob reads) and cut to <see cref="MaxFailureOutputChars"/> characters - the signature only ever
        /// needs the first line. Rows past that budget carry <see cref="LargeOutputPlaceholder"/>, which
        /// groups them together honestly instead of pretending they all failed for the same reason.
        ///
        /// Entity rows are skipped: an entity has no orchestrator to group under. The grouping itself lives
        /// in the pure <see cref="FailuresAggregator"/>.
        /// </summary>
        public static async Task<FailuresResult> GetFailuresAsync(DurableTaskClient durableClient, string connName, string hubName, FailuresQuery query, CancellationToken ct)
        {
            ArgumentNullException.ThrowIfNull(query);

            var tableClient = TableClient.GetTableClient(connName);

            // A cap of 0 means 'the caller did not set one' (ITableClient.QueryAsync rejects anything below 1)
            int cap = query.Cap > 0 ? query.Cap : DefaultStatsScanCap;

            // CreateQueryFilter escapes and formats the interpolated values, so the dates come out as the
            // Edm.DateTime literals Table Storage expects. Both ends are inclusive, as for /stats.
            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"RuntimeStatus eq {FailedRuntimeStatus} and CreatedTime ge {query.From} and CreatedTime le {query.To}");

            var (rows, truncated) = await tableClient.QueryAsync($"{hubName}Instances", filter, FailureColumns, cap, ct);

            var failedRows = new List<FailedInstanceRow>();
            int downloadsLeft = MaxFailureOutputDownloads;

            foreach (var row in rows)
            {
                // An entity is not an orchestrator: it never appears on the Failures screen
                if (ExpandedOrchestrationStatus.EntityIdRegex.IsMatch(row.PartitionKey))
                {
                    continue;
                }

                string output = row.GetString(OutputColumn);

                if (LargeMessageBlobs.IsUrl(output))
                {
                    output = downloadsLeft > 0
                        ? Truncate(await TryDownloadOutputAsync(connName, output), MaxFailureOutputChars)
                        : LargeOutputPlaceholder;

                    downloadsLeft--;
                }

                failedRows.Add(new FailedInstanceRow
                {
                    // The Instances row of an instance is (PartitionKey = instanceId, RowKey = "")
                    InstanceId = row.PartitionKey,
                    Name = row.GetString(NameColumn),
                    CreatedTime = TryGetDateTimeOffset(row, CreatedTimeColumn) ?? default,
                    LastUpdatedTime = TryGetDateTimeOffset(row, LastUpdatedTimeColumn) ?? default,
                    CompletedTime = TryGetDateTimeOffset(row, CompletedTimeColumn),
                    Output = output
                });
            }

            var result = FailuresAggregator.Group(failedRows, truncated, cap);

            // Scanned counts the rows the table returned, entity rows included: it is a statement about the
            // scan (and about whether the cap bit), not about the groups.
            result.Scanned = rows.Count;

            return result;
        }

        /// <summary>
        /// Downloads an offloaded Output. A blob that cannot be read (deleted, or a URL outside this
        /// account) leaves the placeholder rather than failing the whole request.
        /// </summary>
        private static async Task<string> TryDownloadOutputAsync(string connName, string blobUrl)
        {
            try
            {
                return await LargeMessageBlobs.DownloadByUrlAsync(connName, blobUrl);
            }
            catch (Exception)
            {
                return LargeOutputPlaceholder;
            }
        }

        private static string Truncate(string text, int maxChars)
        {
            if (string.IsNullOrEmpty(text) || text.Length <= maxChars)
            {
                return text;
            }

            return text.Substring(0, maxChars);
        }

        /// <summary>
        /// Lists the sub-orchestrations of an instance.
        ///
        /// DurableTask.Core names a sub-orchestration it was not given an explicit id for
        /// "{parent's ExecutionId}:{taskId}", so every generated child of this instance sits in the
        /// XXXInstances partition range ['{executionId}:', '{executionId};') - ';' is the character right
        /// after ':' in ASCII, and Table Storage compares PartitionKeys ordinally, so that half-open range
        /// is exactly the set of ids that start with "{executionId}:" and nothing else (an unrelated
        /// "{executionId}x:0" sorts past its upper bound).
        ///
        /// Children the orchestrator named itself do not follow that convention and cannot be found this
        /// way, which is why the result always reports Complete == false: the list is what could be
        /// matched, never a guarantee. Grandchildren carry the *child's* ExecutionId and so are correctly
        /// left out - one call, one level of the tree.
        ///
        /// Returns an empty list when the instance (or its row) is gone.
        /// </summary>
        public static async Task<ChildrenResult> GetChildrenAsync(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            var tableClient = TableClient.GetTableClient(connName);

            // Only the instance row knows the current ExecutionId, and the child ids are built from it
            var instanceEntity = await tableClient.GetEntityAsync($"{hubName}Instances", instanceId, string.Empty);

            string executionId = instanceEntity?.GetString(ExecutionIdColumn);
            if (string.IsNullOrEmpty(executionId))
            {
                // No row, or a row without an ExecutionId. There is no prefix to match children by, and
                // querying on an empty prefix would drag the whole table in, so: nothing found.
                return new ChildrenResult { Children = Array.Empty<ChildInstance>(), Complete = false };
            }

            // CreateQueryFilter escapes the interpolated values, so an instance id cannot break out of the filter
            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey ge {executionId + ChildIdSeparator} and PartitionKey lt {executionId + ChildIdRangeEnd}");

            // Bounded like every other scan here. Hitting the cap is not reported separately: Complete is
            // already false for this provider, which is exactly what 'this list may be short' means.
            var (rows, _) = await tableClient.QueryAsync($"{hubName}Instances", filter, ChildColumns, MaxChildRowsToScan, CancellationToken.None);

            var children = rows
                .Select(row => new ChildInstance
                {
                    // The Instances row of an instance is (PartitionKey = instanceId, RowKey = "")
                    InstanceId = row.PartitionKey,
                    Name = row.GetString(NameColumn),

                    // The PascalCase RuntimeStatus name, verbatim as the storage row spells it
                    RuntimeStatus = row.GetString(RuntimeStatusColumn),
                    CreatedTime = TryGetDateTimeOffset(row, CreatedTimeColumn) ?? default,
                    LastUpdatedTime = TryGetDateTimeOffset(row, LastUpdatedTimeColumn) ?? default
                })
                // Oldest first, so the tree reads in the order the orchestrator started them; the id breaks
                // ties, because sub-orchestrations started in the same instant would otherwise shuffle
                .OrderBy(child => child.CreatedTime)
                .ThenBy(child => child.InstanceId, StringComparer.Ordinal)
                .ToList();

            return new ChildrenResult { Children = children, Complete = false };
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

        // TableEntity.GetDateTimeOffset() casts too, so a column another tool wrote as a string (or left out
        // entirely) would throw. A date that cannot be read is reported as 'unknown' instead.
        private static DateTimeOffset? TryGetDateTimeOffset(TableEntity entity, string columnName)
        {
            if (!entity.TryGetValue(columnName, out object value) || value == null)
            {
                return null;
            }

            switch (value)
            {
                case DateTimeOffset dateTimeOffsetValue:
                    return dateTimeOffsetValue.ToUniversalTime();
                case DateTime dateTimeValue:
                    return new DateTimeOffset(dateTimeValue.ToUniversalTime(), TimeSpan.Zero);
                case string stringValue:
                    return DateTimeOffset.TryParse(stringValue, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var parsedValue) ? parsedValue : null;
                default:
                    return null;
            }
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
        private const string NameColumn = "Name";
        private const string RuntimeStatusColumn = "RuntimeStatus";
        private const string CreatedTimeColumn = "CreatedTime";
        private const string LastUpdatedTimeColumn = "LastUpdatedTime";
        private const string CompletedTimeColumn = "CompletedTime";
        private const string OutputColumn = "Output";
        private const string EventTypeColumn = "EventType";
        private const string GenerationColumn = "Generation";
        private const string TimestampColumn = "_Timestamp";

        // What DurableTask.Core puts between a parent's ExecutionId and the task id when it generates a
        // sub-orchestration's instance id, and the character right after it in ASCII, which closes the
        // half-open PartitionKey range the children query uses.
        internal const string ChildIdSeparator = ":";
        internal const string ChildIdRangeEnd = ";";

        // An orchestrator replays once per event it observes, so this cap covers instances tens of thousands
        // of episodes deep. Beyond it the timeline is cut short rather than the query running away with the
        // history table.
        internal const int MaxEpisodeMarkerRowsToScan = 20000;

        // Decision D10: an Instances scan never reads more than this many rows. Overridable per request
        // through StatsQuery.Cap, which the /stats function fills from DfmSettings (env DFM_STATS_CAP).
        internal const int DefaultStatsScanCap = 50000;

        // An orchestration with more direct sub-orchestrations than this is not a tree anyone can read;
        // beyond it the list is cut short (and Complete is false anyway).
        internal const int MaxChildRowsToScan = 500;

        // The RuntimeStatus value the /failures scan filters on, spelled as the framework stores it.
        internal const string FailedRuntimeStatus = "Failed";

        // How many offloaded Outputs one /failures request may download, and how much of each is kept.
        // The signature only ever needs the first line, and a hub where hundreds of failures offloaded
        // their output must not turn one request into hundreds of blob reads.
        internal const int MaxFailureOutputDownloads = 20;
        internal const int MaxFailureOutputChars = 2048;

        /// <summary>Stands in for an Output that was offloaded and not downloaded (or could not be read).</summary>
        internal const string LargeOutputPlaceholder = "(large output)";

        // PartitionKey and RowKey come back regardless - ITableClient adds them to every projection
        private static readonly string[] MarkerColumns = new[] { EventTypeColumn, TimestampColumn };

        // Everything StatsAggregator needs and nothing else: Input, Output and CustomStatus are the big
        // columns of an Instances row and are never pulled over the wire for statistics.
        private static readonly string[] StatsColumns = new[] { NameColumn, RuntimeStatusColumn, CreatedTimeColumn, LastUpdatedTimeColumn, CompletedTimeColumn };

        // Exactly the four fields of contracts section 6 ChildInstance that are not the id (PartitionKey)
        private static readonly string[] ChildColumns = new[] { NameColumn, RuntimeStatusColumn, CreatedTimeColumn, LastUpdatedTimeColumn };

        // Everything FailuresAggregator needs: the times, the orchestrator name and the error payload.
        // Input and CustomStatus - the other fat columns - are left behind.
        private static readonly string[] FailureColumns = new[] { NameColumn, CreatedTimeColumn, LastUpdatedTimeColumn, CompletedTimeColumn, OutputColumn };
    }
}
