// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The handful of instance-row fields the /stats aggregation needs. Built from an Azure Table Storage
    /// row (the projection of Common/TableClient.QueryAsync, where <see cref="InstanceId"/> is the row's
    /// PartitionKey) or from a SQL row in the MSSQL package.
    /// </summary>
    public class InstanceRowLite
    {
        /// <summary>Instance id. In Azure Table Storage this is the Instances row's PartitionKey.</summary>
        public string InstanceId { get; set; }

        /// <summary>Orchestrator (or entity function) name, as stored in the row.</summary>
        public string Name { get; set; }

        /// <summary>RuntimeStatus, as stored in the row. Never parsed into an enum, so unknown values do not throw.</summary>
        public string RuntimeStatus { get; set; }

        /// <summary>When the instance was created. UTC.</summary>
        public DateTimeOffset CreatedTime { get; set; }

        /// <summary>When the instance row was last written. UTC.</summary>
        public DateTimeOffset LastUpdatedTime { get; set; }

        /// <summary>When the instance reached a terminal state. Null while it is still going. UTC.</summary>
        public DateTimeOffset? CompletedTime { get; set; }
    }

    /// <summary>
    /// Turns a bounded scan of Instances rows into the /stats response (B1-S2). Pure: no storage access and
    /// no clock of its own (the caller passes the current time), so every rule is unit tested here rather
    /// than through the endpoint, and every storage provider (Azure Storage, MSSQL) reaches the same numbers
    /// from the same rows.
    ///
    /// The shape it produces is docs/plans/svelte-rewrite/00-shared-contracts.md section 6, StatsResponse.
    /// </summary>
    public static class StatsAggregator
    {
        /// <summary>Key of <see cref="StatsResult.Totals"/> holding the number of orchestration instances.</summary>
        public const string AllKey = "all";

        /// <summary>Key of <see cref="StatsResult.Totals"/> holding the number of Durable Entity instances.</summary>
        public const string EntitiesKey = "entities";

        /// <summary>What a missing or blank RuntimeStatus is counted under, so that such a row is never lost.</summary>
        public const string UnknownStatus = "Unknown";

        /// <summary>How many instance ids the stuck, pending and suspended summaries carry.</summary>
        public const int MaxSampleIds = 10;

        /// <summary>Upper bound on the number of time buckets (the function validates it too).</summary>
        public const int MaxBins = 366;

        /// <summary>
        /// Aggregates the scanned rows into a <see cref="StatsResult"/>.
        ///
        /// Entity rows (whose instance id matches ExpandedOrchestrationStatus.EntityIdRegex) only count into
        /// the totals entities key and <see cref="StatsResult.EntitiesByName"/>; they are left out of the
        /// status totals, the bins, the per-name aggregates and the stuck, pending and suspended sets.
        /// </summary>
        /// <param name="rows">The rows the provider scanned. Null is treated as empty.</param>
        /// <param name="query">The validated query. Supplies From, To, Bins and the stuck/pending thresholds.</param>
        /// <param name="now">Current time, against which the stuck and pending thresholds are applied. UTC.</param>
        /// <param name="truncated">True when the scan hit its cap, becomes <see cref="StatsResult.Partial"/>.</param>
        /// <param name="cap">The cap the scan was bounded by, becomes <see cref="StatsResult.Cap"/>.</param>
        public static StatsResult Aggregate(IEnumerable<InstanceRowLite> rows, StatsQuery query, DateTimeOffset now, bool truncated, int cap)
        {
            ArgumentNullException.ThrowIfNull(query);

            var rowList = rows == null ? new List<InstanceRowLite>() : rows.ToList();

            DateTimeOffset from = query.From;
            DateTimeOffset to = query.To;
            int binCount = Math.Clamp(query.Bins, 1, MaxBins);

            long[] binEdges = BuildBinEdges(from, to, binCount);
            var bins = new StatsBin[binCount];
            for (int i = 0; i < binCount; i++)
            {
                bins[i] = new StatsBin
                {
                    Start = new DateTimeOffset(binEdges[i], TimeSpan.Zero),
                    End = new DateTimeOffset(binEdges[i + 1], TimeSpan.Zero)
                };
            }

            var totals = new StatusCounts { { AllKey, 0 }, { EntitiesKey, 0 } };
            var byName = new Dictionary<string, NameAccumulator>(StringComparer.Ordinal);
            var entityCounts = new Dictionary<string, int>(StringComparer.Ordinal);

            var stuckRows = new List<InstanceRowLite>();
            var pendingRows = new List<InstanceRowLite>();
            var suspendedRows = new List<InstanceRowLite>();

            DateTimeOffset stuckBefore = now.AddMinutes(-query.StuckAfterMinutes);
            DateTimeOffset pendingBefore = now.AddMinutes(-query.PendingAfterMinutes);

            foreach (var row in rowList)
            {
                if (row == null)
                {
                    continue;
                }

                // Entities count into their own two buckets and nowhere else. The entity name is the
                // '@name@' part of the instance id, not the row's Name column (which holds the entity
                // function name).
                var entityMatch = ExpandedOrchestrationStatus.EntityIdRegex.Match(row.InstanceId ?? string.Empty);
                if (entityMatch.Success)
                {
                    totals[EntitiesKey] = totals[EntitiesKey] + 1;

                    string entityName = entityMatch.Groups[1].Value;
                    entityCounts.TryGetValue(entityName, out int entityCount);
                    entityCounts[entityName] = entityCount + 1;

                    continue;
                }

                string status = NormalizeStatus(row.RuntimeStatus);

                totals[AllKey] = totals[AllKey] + 1;
                totals.TryGetValue(status, out int statusCount);
                totals[status] = statusCount + 1;

                if (row.CreatedTime >= from && row.CreatedTime <= to)
                {
                    var counts = bins[FindBin(binEdges, row.CreatedTime.UtcTicks, binCount)].Counts;
                    counts.TryGetValue(status, out int binStatusCount);
                    counts[status] = binStatusCount + 1;
                }

                string name = row.Name ?? string.Empty;
                if (!byName.TryGetValue(name, out var accumulator))
                {
                    accumulator = new NameAccumulator { Name = name };
                    byName[name] = accumulator;
                }

                accumulator.Started++;

                switch (status)
                {
                    case CompletedStatus:
                        accumulator.Completed++;
                        break;

                    case FailedStatus:
                        accumulator.Failed++;
                        if (accumulator.LastFailedAt == null || row.LastUpdatedTime > accumulator.LastFailedAt.Value)
                        {
                            accumulator.LastFailedAt = row.LastUpdatedTime;
                        }
                        break;
                }

                if (RunningStatuses.Contains(status))
                {
                    accumulator.Running++;
                }

                if ((status == CompletedStatus || status == FailedStatus) && row.CompletedTime.HasValue)
                {
                    accumulator.DurationsMs.Add((row.CompletedTime.Value - row.CreatedTime).TotalMilliseconds);
                }

                if (status == RunningStatus && row.LastUpdatedTime < stuckBefore)
                {
                    stuckRows.Add(row);
                }

                if (status == PendingStatus && row.CreatedTime < pendingBefore)
                {
                    pendingRows.Add(row);
                }

                if (status == SuspendedStatus)
                {
                    suspendedRows.Add(row);
                }
            }

            return new StatsResult
            {
                From = from,
                To = to,
                BinCount = binCount,
                Totals = totals,
                Bins = bins,
                ByName = byName.Values
                    .OrderByDescending(a => a.Started)
                    .ThenBy(a => a.Name, StringComparer.Ordinal)
                    .Select(a => a.ToStatsByName())
                    .ToList(),
                EntitiesByName = entityCounts
                    .OrderByDescending(pair => pair.Value)
                    .ThenBy(pair => pair.Key, StringComparer.Ordinal)
                    .Select(pair => new EntityNameCount { Name = pair.Key, Count = pair.Value })
                    .ToList(),
                Stuck = ToStuckSummary(stuckRows),
                OldestPending = ToPendingSummary(pendingRows),
                Suspended = ToStuckSummary(suspendedRows),
                Scanned = rowList.Count,
                Partial = truncated,
                Cap = cap,

                // The function overwrites GeneratedAt and ElapsedMs and sets Cached; this is the sane default
                // for a routine that does not.
                GeneratedAt = now
            };
        }

        /// <summary>
        /// Returns the canonical PascalCase spelling of a known RuntimeStatus, the value itself (trimmed) for
        /// anything else and <see cref="UnknownStatus"/> for a missing one. Never throws: the value comes
        /// straight out of a storage row.
        /// </summary>
        public static string NormalizeStatus(string runtimeStatus)
        {
            if (string.IsNullOrWhiteSpace(runtimeStatus))
            {
                return UnknownStatus;
            }

            string trimmed = runtimeStatus.Trim();

            return KnownStatuses.TryGetValue(trimmed, out string canonical) ? canonical : trimmed;
        }

        // Bin i spans [edges[i], edges[i + 1]); the last one also includes its right edge, so that a row
        // created exactly at To lands in it.
        private static long[] BuildBinEdges(DateTimeOffset from, DateTimeOffset to, int binCount)
        {
            long fromTicks = from.UtcTicks;
            long toTicks = to.UtcTicks;
            long span = toTicks - fromTicks;

            var edges = new long[binCount + 1];

            if (span <= 0)
            {
                // Degenerate range (the function rejects it, but the aggregator must not divide by it):
                // every bucket is empty and starts where the range does.
                for (int i = 0; i <= binCount; i++)
                {
                    edges[i] = fromTicks;
                }

                return edges;
            }

            for (int i = 0; i <= binCount; i++)
            {
                // decimal, not double: a 92 day span is about 8e16 ticks, which multiplied by up to 366 bins
                // overflows long and loses precision in double.
                edges[i] = fromTicks + (long)((decimal)span * i / binCount);
            }

            edges[binCount] = toTicks;

            return edges;
        }

        private static int FindBin(long[] edges, long ticks, int binCount)
        {
            int position = Array.BinarySearch(edges, ticks);
            int index = position >= 0 ? position : ~position - 1;

            return Math.Clamp(index, 0, binCount - 1);
        }

        // Nearest-rank percentile: the value at rank ceil(count * percent / 100) of the ascending durations.
        // Integer arithmetic on purpose, so that e.g. 20 values at p95 give rank 19, not the 20 that
        // ceil(20 * 0.95) yields in binary floating point.
        private static double? Percentile(List<double> ascendingDurations, int percent)
        {
            if (ascendingDurations.Count == 0)
            {
                return null;
            }

            int rank = (ascendingDurations.Count * percent + 99) / 100;

            return ascendingDurations[Math.Clamp(rank, 1, ascendingDurations.Count) - 1];
        }

        // Sample ids are the oldest ones first: those are the ones worth looking at.
        private static StuckSummary ToStuckSummary(List<InstanceRowLite> rows)
        {
            var ordered = rows
                .OrderBy(r => r.LastUpdatedTime)
                .ThenBy(r => r.InstanceId, StringComparer.Ordinal)
                .ToList();

            return new StuckSummary
            {
                Count = ordered.Count,
                OldestLastUpdatedAt = ordered.Count == 0 ? null : ordered[0].LastUpdatedTime,
                SampleIds = ordered.Take(MaxSampleIds).Select(r => r.InstanceId).ToList()
            };
        }

        private static PendingSummary ToPendingSummary(List<InstanceRowLite> rows)
        {
            var ordered = rows
                .OrderBy(r => r.CreatedTime)
                .ThenBy(r => r.InstanceId, StringComparer.Ordinal)
                .ToList();

            return new PendingSummary
            {
                Count = ordered.Count,
                OldestCreatedAt = ordered.Count == 0 ? null : ordered[0].CreatedTime,
                SampleIds = ordered.Take(MaxSampleIds).Select(r => r.InstanceId).ToList()
            };
        }

        private const string CompletedStatus = "Completed";
        private const string FailedStatus = "Failed";
        private const string RunningStatus = "Running";
        private const string PendingStatus = "Pending";
        private const string SuspendedStatus = "Suspended";
        private const string ContinuedAsNewStatus = "ContinuedAsNew";

        // The RuntimeStatus names of contracts section 6, keyed case-insensitively so that a differently
        // cased row still counts under the canonical spelling the UI expects.
        private static readonly Dictionary<string, string> KnownStatuses = new[]
        {
            CompletedStatus, RunningStatus, FailedStatus, PendingStatus,
            "Terminated", "Canceled", ContinuedAsNewStatus, SuspendedStatus
        }.ToDictionary(s => s, s => s, StringComparer.OrdinalIgnoreCase);

        // What StatsByName.Running counts.
        private static readonly HashSet<string> RunningStatuses = new HashSet<string>(
            new[] { RunningStatus, PendingStatus, ContinuedAsNewStatus, SuspendedStatus }, StringComparer.Ordinal);

        private class NameAccumulator
        {
            public string Name;
            public int Started;
            public int Completed;
            public int Failed;
            public int Running;
            public DateTimeOffset? LastFailedAt;
            public readonly List<double> DurationsMs = new List<double>();

            public StatsByName ToStatsByName()
            {
                this.DurationsMs.Sort();

                return new StatsByName
                {
                    Name = this.Name,
                    Started = this.Started,
                    Completed = this.Completed,
                    Failed = this.Failed,
                    Running = this.Running,
                    FailureRate = (double)this.Failed / Math.Max(1, this.Completed + this.Failed),
                    P50Ms = Percentile(this.DurationsMs, 50),
                    P95Ms = Percentile(this.DurationsMs, 95),
                    LastFailedAt = this.LastFailedAt
                };
            }
        }
    }
}
