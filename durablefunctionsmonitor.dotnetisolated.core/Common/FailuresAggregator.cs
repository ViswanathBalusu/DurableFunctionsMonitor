// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// One failed instance as the /failures scan reads it: the few columns of an Instances row plus the
    /// error text, which the storage routine may have had to download from the large-message container.
    /// </summary>
    public class FailedInstanceRow
    {
        /// <summary>Instance id. In Azure Table Storage this is the Instances row's PartitionKey.</summary>
        public string InstanceId { get; set; }

        /// <summary>Orchestrator name, as stored in the row.</summary>
        public string Name { get; set; }

        /// <summary>When the instance was created. UTC.</summary>
        public DateTimeOffset CreatedTime { get; set; }

        /// <summary>When the instance row was last written - for a failed instance, when it failed. UTC.</summary>
        public DateTimeOffset LastUpdatedTime { get; set; }

        /// <summary>When the instance reached its terminal state. Null when the row does not carry it. UTC.</summary>
        public DateTimeOffset? CompletedTime { get; set; }

        /// <summary>
        /// The instance's Output, as stored (or as downloaded from the large-message container). The
        /// aggregator extracts the human-readable reason and its signature from it.
        /// </summary>
        public string Output { get; set; }
    }

    /// <summary>
    /// Turns a bounded scan of failed Instances rows into the /failures response (B3-S2). Pure: no storage
    /// access and no clock of its own, so every grouping rule is unit tested here rather than through the
    /// endpoint, and every storage provider reaches the same groups from the same rows.
    /// </summary>
    public static class FailuresAggregator
    {
        /// <summary>
        /// Groups failed instances by orchestrator name and normalized error signature.
        ///
        /// Groups come back by count descending, then by most recent failure descending, which is the order
        /// the Failures screen lists them in: the loudest first, ties broken by whichever is still happening.
        /// Inside a group the instances are newest first, so the sample the user opens is a current one.
        /// </summary>
        /// <param name="rows">The scanned rows. Entity rows are the caller's job to leave out.</param>
        /// <param name="truncated">Whether the scan stopped at the cap</param>
        /// <param name="cap">The cap the scan was bounded by</param>
        public static FailuresResult Group(IEnumerable<FailedInstanceRow> rows, bool truncated, int cap)
        {
            var rowList = rows?.ToList() ?? new List<FailedInstanceRow>();

            var groups = new List<FailureGroup>();

            // The reason is extracted once per row and carried into the group, so a row's Output is parsed
            // exactly once no matter how many groups or instances it ends up in.
            var byKey = rowList
                .Select(row => new
                {
                    Row = row,
                    Reason = FailureSignature.Extract(row.Output),
                })
                .Select(x => new
                {
                    x.Row,
                    x.Reason,
                    Signature = FailureSignature.Normalize(x.Reason)
                })
                .GroupBy(x => FailureSignature.GroupKey(x.Row.Name, x.Signature));

            foreach (var group in byKey)
            {
                var members = group.ToList();
                var first = members[0];

                var newestFirst = members
                    .OrderByDescending(x => x.Row.CreatedTime)

                    // The id breaks ties, so instances created in the same instant keep a stable order
                    .ThenBy(x => x.Row.InstanceId, StringComparer.Ordinal)
                    .ToList();

                groups.Add(new FailureGroup
                {
                    Key = group.Key,
                    Name = first.Row.Name,
                    Signature = first.Signature,
                    Count = members.Count,
                    LastSeenAt = members.Max(x => x.Row.LastUpdatedTime),

                    // The ids of the newest few, so the screen can show 'and 5 more like it' without
                    // carrying the whole instance list around
                    SampleIds = newestFirst.Take(MaxSampleIds).Select(x => x.Row.InstanceId).ToList(),

                    Instances = newestFirst
                        .Take(MaxInstancesPerGroup)
                        .Select(x => new FailureInstance
                        {
                            InstanceId = x.Row.InstanceId,
                            CreatedTime = x.Row.CreatedTime,
                            CompletedTime = x.Row.CompletedTime,

                            // A failed instance's row is written when it fails, so LastUpdatedTime is the
                            // best available end when CompletedTime is missing. Negative clock skew is
                            // reported as null rather than as a negative duration.
                            DurationMs = ComputeDurationMs(x.Row),

                            // The instance's own message, not the group's signature: the signature has the
                            // ids and numbers replaced, and it is those the user needs to see on a row.
                            Reason = x.Reason
                        })
                        .ToList()
                });
            }

            return new FailuresResult
            {
                Groups = groups
                    .OrderByDescending(g => g.Count)
                    .ThenByDescending(g => g.LastSeenAt)

                    // The key breaks ties, so two equally loud, equally recent groups keep a stable order
                    .ThenBy(g => g.Key, StringComparer.Ordinal)
                    .ToList(),

                TotalFailed = rowList.Count,
                Scanned = rowList.Count,
                Partial = truncated,
                Cap = cap
            };
        }

        private static double? ComputeDurationMs(FailedInstanceRow row)
        {
            var end = row.CompletedTime ?? row.LastUpdatedTime;

            double ms = (end - row.CreatedTime).TotalMilliseconds;

            return ms < 0 ? null : ms;
        }

        /// <summary>How many instance ids a group carries as its sample.</summary>
        internal const int MaxSampleIds = 5;

        /// <summary>How many instances a group carries in full.</summary>
        internal const int MaxInstancesPerGroup = 50;
    }
}
