// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

// Models shared by the aggregation endpoints (/stats, /failures, /children, /spans, /storage, /audit)
// and by the DfmExtensionPoints routines that produce them.
//
// These types are public on purpose: the storage provider packages (MSSQL, Netherite) and any custom
// backend construct them.
//
// Property names are the ones the UI is built against: see docs/plans/svelte-rewrite/00-shared-contracts.md
// section 6. They are serialized to camelCase by Globals.SerializerSettings, dates with the
// 'yyyy-MM-ddTHH:mm:ssZ' format string (so always assign UTC values) and enums as strings.

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// A map of counters keyed by RuntimeStatus name ('Completed', 'Running', 'Failed', 'Pending',
    /// 'Terminated', 'Canceled', 'ContinuedAsNew', 'Suspended'), plus the extra keys the contract defines
    /// for a particular field ('all' and 'entities' for <see cref="StatsResult.Totals"/>).
    ///
    /// Derives from Dictionary and pins the default naming strategy, because Globals.SerializerSettings uses
    /// CamelCasePropertyNamesContractResolver, which also camel-cases dictionary *keys*. The contract requires
    /// the RuntimeStatus keys to keep their PascalCase spelling, so keys of this type are written verbatim.
    /// </summary>
    [JsonDictionary(NamingStrategyType = typeof(DefaultNamingStrategy))]
    public class StatusCounts : Dictionary<string, int>
    {
        /// <summary>Creates an empty map</summary>
        public StatusCounts() { }

        /// <summary>Creates a map pre-filled from the given pairs</summary>
        public StatusCounts(IDictionary<string, int> other) : base(other) { }
    }

    /// <summary>
    /// Parameters of a /stats request, already validated and normalized by the function.
    /// </summary>
    public class StatsQuery
    {
        /// <summary>Beginning of the time range (inclusive), matched against CreatedTime. UTC.</summary>
        public DateTimeOffset From { get; set; }

        /// <summary>End of the time range (inclusive), matched against CreatedTime. UTC.</summary>
        public DateTimeOffset To { get; set; }

        /// <summary>Number of equal time buckets to split [From, To] into. Default 48, max 366.</summary>
        public int Bins { get; set; } = 48;

        /// <summary>A Running instance whose LastUpdatedTime is older than this many minutes counts as stuck. Default 60.</summary>
        public int StuckAfterMinutes { get; set; } = 60;

        /// <summary>A Pending instance created more than this many minutes ago counts as long-pending. Default 10.</summary>
        public int PendingAfterMinutes { get; set; } = 10;

        /// <summary>Maximum number of instance rows the routine may scan. Comes from DfmSettings.</summary>
        public int Cap { get; set; }

        /// <summary>
        /// Stable part of the AggregationCache key. From/To are rounded down to the minute, so that
        /// auto-refreshing clients keep hitting the same cache entry.
        /// </summary>
        [JsonIgnore]
        public string CacheKey =>
            $"{this.From.UtcDateTime:yyyyMMddHHmm}|{this.To.UtcDateTime:yyyyMMddHHmm}|{this.Bins}|{this.StuckAfterMinutes}|{this.PendingAfterMinutes}|{this.Cap}";
    }

    /// <summary>
    /// One time bucket of the /stats response.
    /// </summary>
    public class StatsBin
    {
        /// <summary>Beginning of the bucket (inclusive). UTC.</summary>
        public DateTimeOffset Start { get; set; }

        /// <summary>End of the bucket (exclusive, except for the last bucket). UTC.</summary>
        public DateTimeOffset End { get; set; }

        /// <summary>Number of instances created inside the bucket, per RuntimeStatus.</summary>
        public StatusCounts Counts { get; set; } = new StatusCounts();
    }

    /// <summary>
    /// Per-orchestrator aggregates of the /stats response.
    /// </summary>
    public class StatsByName
    {
        /// <summary>Orchestrator name.</summary>
        public string Name { get; set; }

        /// <summary>Number of instances created in the range.</summary>
        public int Started { get; set; }

        /// <summary>Number of them that are Completed.</summary>
        public int Completed { get; set; }

        /// <summary>Number of them that are Failed.</summary>
        public int Failed { get; set; }

        /// <summary>Number of them that are still going (Running, Pending, ContinuedAsNew, Suspended).</summary>
        public int Running { get; set; }

        /// <summary>Failed / max(1, Completed + Failed).</summary>
        public double FailureRate { get; set; }

        /// <summary>Median duration of the terminal instances, in milliseconds. Null when there are none.</summary>
        public double? P50Ms { get; set; }

        /// <summary>95th percentile duration of the terminal instances, in milliseconds. Null when there are none.</summary>
        public double? P95Ms { get; set; }

        /// <summary>LastUpdatedTime of the most recent failure. Null when there is none. UTC.</summary>
        public DateTimeOffset? LastFailedAt { get; set; }
    }

    /// <summary>
    /// One entry of <see cref="StatsResult.EntitiesByName"/>.
    /// </summary>
    public class EntityNameCount
    {
        /// <summary>Entity name (the '@name@' part of the entity instance id).</summary>
        public string Name { get; set; }

        /// <summary>Number of entity instances with that name.</summary>
        public int Count { get; set; }
    }

    /// <summary>
    /// A set of instances singled out by the /stats response and dated by their LastUpdatedTime
    /// (<see cref="StatsResult.Stuck"/> and <see cref="StatsResult.Suspended"/>).
    /// </summary>
    public class StuckSummary
    {
        /// <summary>How many instances are in the set.</summary>
        public int Count { get; set; }

        /// <summary>LastUpdatedTime of the oldest one. Null when the set is empty. UTC.</summary>
        public DateTimeOffset? OldestLastUpdatedAt { get; set; }

        /// <summary>Ids of the first few of them (10 at most), so that the UI can link to them.</summary>
        public IReadOnlyList<string> SampleIds { get; set; } = new List<string>();
    }

    /// <summary>
    /// A set of instances singled out by the /stats response and dated by their CreatedTime
    /// (<see cref="StatsResult.OldestPending"/>).
    /// </summary>
    public class PendingSummary
    {
        /// <summary>How many instances are in the set.</summary>
        public int Count { get; set; }

        /// <summary>CreatedTime of the oldest one. Null when the set is empty. UTC.</summary>
        public DateTimeOffset? OldestCreatedAt { get; set; }

        /// <summary>Ids of the first few of them (10 at most), so that the UI can link to them.</summary>
        public IReadOnlyList<string> SampleIds { get; set; } = new List<string>();
    }

    /// <summary>
    /// Response of the /stats endpoint.
    /// </summary>
    public class StatsResult
    {
        /// <summary>Beginning of the aggregated range. UTC.</summary>
        public DateTimeOffset From { get; set; }

        /// <summary>End of the aggregated range. UTC.</summary>
        public DateTimeOffset To { get; set; }

        /// <summary>Number of buckets in <see cref="Bins"/>.</summary>
        public int BinCount { get; set; }

        /// <summary>Instance counters per RuntimeStatus, plus 'all' and 'entities'.</summary>
        public StatusCounts Totals { get; set; } = new StatusCounts();

        /// <summary>The time buckets, in chronological order.</summary>
        public IReadOnlyList<StatsBin> Bins { get; set; } = new List<StatsBin>();

        /// <summary>Per-orchestrator aggregates, sorted by Started descending.</summary>
        public IReadOnlyList<StatsByName> ByName { get; set; } = new List<StatsByName>();

        /// <summary>Durable Entity instances per entity name.</summary>
        public IReadOnlyList<EntityNameCount> EntitiesByName { get; set; } = new List<EntityNameCount>();

        /// <summary>Running instances that have not been updated for a while.</summary>
        public StuckSummary Stuck { get; set; } = new StuckSummary();

        /// <summary>Pending instances that were created a while ago.</summary>
        public PendingSummary OldestPending { get; set; } = new PendingSummary();

        /// <summary>Suspended instances.</summary>
        public StuckSummary Suspended { get; set; } = new StuckSummary();

        /// <summary>How many instance rows were actually scanned.</summary>
        public int Scanned { get; set; }

        /// <summary>True when the scan hit the cap, so the numbers are a lower bound.</summary>
        public bool Partial { get; set; }

        /// <summary>The cap the scan was bounded by.</summary>
        public int Cap { get; set; }

        /// <summary>How long producing this result took, in milliseconds.</summary>
        public long ElapsedMs { get; set; }

        /// <summary>When this result was produced. UTC.</summary>
        public DateTimeOffset GeneratedAt { get; set; }

        /// <summary>True when the result was served from the aggregation cache.</summary>
        public bool Cached { get; set; }
    }

    /// <summary>
    /// One child (sub-orchestration) of an instance.
    /// </summary>
    public class ChildInstance
    {
        /// <summary>Instance id of the child.</summary>
        public string InstanceId { get; set; }

        /// <summary>Orchestrator name of the child.</summary>
        public string Name { get; set; }

        /// <summary>One of the RuntimeStatus names ('Running', 'Completed', ...).</summary>
        public string RuntimeStatus { get; set; }

        /// <summary>When the child was created. UTC.</summary>
        public DateTimeOffset CreatedTime { get; set; }

        /// <summary>When the child was last updated. UTC.</summary>
        public DateTimeOffset LastUpdatedTime { get; set; }
    }

    /// <summary>
    /// Response of the orchestrations('{id}')/children endpoint.
    /// </summary>
    public class ChildrenResult
    {
        /// <summary>The children found.</summary>
        public IReadOnlyList<ChildInstance> Children { get; set; } = new List<ChildInstance>();

        /// <summary>
        /// True when the provider can guarantee that the list is complete. The Azure Storage implementation
        /// matches children by their generated instance ids, which explicitly named children do not follow,
        /// so it reports false.
        /// </summary>
        public bool Complete { get; set; }
    }

    /// <summary>
    /// One orchestrator episode (the time between an OrchestratorStarted and its OrchestratorCompleted event).
    /// </summary>
    public class EpisodeMarker
    {
        /// <summary>Timestamp of the OrchestratorStarted event. UTC.</summary>
        public DateTimeOffset Start { get; set; }

        /// <summary>Timestamp of the matching OrchestratorCompleted event. Null for a still open episode. UTC.</summary>
        public DateTimeOffset? End { get; set; }
    }

    /// <summary>
    /// The few values of an instance's storage row that the /spans endpoint needs and that the
    /// DurableTaskClient does not expose.
    /// </summary>
    public class InstanceRowInfo
    {
        /// <summary>Current execution id of the instance. Null when unknown.</summary>
        public string ExecutionId { get; set; }

        /// <summary>How many times the instance continued-as-new. Null when the provider does not track it.</summary>
        public int? Generation { get; set; }

        /// <summary>Estimated size of the instance's history, in bytes. Null when the provider cannot tell.</summary>
        public long? HistoryBytesEstimate { get; set; }
    }

    /// <summary>
    /// Parameters of a /failures request, already validated and normalized by the function.
    /// </summary>
    public class FailuresQuery
    {
        /// <summary>Beginning of the time range (inclusive), matched against CreatedTime. UTC.</summary>
        public DateTimeOffset From { get; set; }

        /// <summary>End of the time range (inclusive), matched against CreatedTime. UTC.</summary>
        public DateTimeOffset To { get; set; }

        /// <summary>Maximum number of instance rows the routine may scan. Comes from DfmSettings.</summary>
        public int Cap { get; set; }

        /// <summary>
        /// Stable part of the AggregationCache key. From/To are rounded down to the minute, so that
        /// auto-refreshing clients keep hitting the same cache entry.
        /// </summary>
        [JsonIgnore]
        public string CacheKey =>
            $"{this.From.UtcDateTime:yyyyMMddHHmm}|{this.To.UtcDateTime:yyyyMMddHHmm}|{this.Cap}";
    }

    /// <summary>
    /// One failed instance inside a failure group.
    /// </summary>
    public class FailureInstance
    {
        /// <summary>Instance id.</summary>
        public string InstanceId { get; set; }

        /// <summary>When the instance was created. UTC.</summary>
        public DateTimeOffset CreatedTime { get; set; }

        /// <summary>When the instance failed. Null when the provider does not report it. UTC.</summary>
        public DateTimeOffset? CompletedTime { get; set; }

        /// <summary>How long the instance ran, in milliseconds. Null when it cannot be computed.</summary>
        public double? DurationMs { get; set; }

        /// <summary>The (unnormalized) error message of this instance.</summary>
        public string Reason { get; set; }
    }

    /// <summary>
    /// Failed instances that share an orchestrator name and a normalized error signature.
    /// </summary>
    public class FailureGroup
    {
        /// <summary>Group key, '{name}|{signature}'.</summary>
        public string Key { get; set; }

        /// <summary>Orchestrator name.</summary>
        public string Name { get; set; }

        /// <summary>Normalized error message (see FailureSignature).</summary>
        public string Signature { get; set; }

        /// <summary>How many failures are in the group.</summary>
        public int Count { get; set; }

        /// <summary>LastUpdatedTime of the most recent failure of the group. UTC.</summary>
        public DateTimeOffset LastSeenAt { get; set; }

        /// <summary>Ids of the first few instances of the group (5 at most).</summary>
        public IReadOnlyList<string> SampleIds { get; set; } = new List<string>();

        /// <summary>The newest instances of the group (50 at most), newest first.</summary>
        public IReadOnlyList<FailureInstance> Instances { get; set; } = new List<FailureInstance>();
    }

    /// <summary>
    /// Response of the /failures endpoint.
    /// </summary>
    public class FailuresResult
    {
        /// <summary>The groups, sorted by Count descending, then by LastSeenAt descending.</summary>
        public IReadOnlyList<FailureGroup> Groups { get; set; } = new List<FailureGroup>();

        /// <summary>How many failed instances were found in the range.</summary>
        public int TotalFailed { get; set; }

        /// <summary>How many instance rows were actually scanned.</summary>
        public int Scanned { get; set; }

        /// <summary>True when the scan hit the cap, so the numbers are a lower bound.</summary>
        public bool Partial { get; set; }

        /// <summary>The cap the scan was bounded by.</summary>
        public int Cap { get; set; }

        /// <summary>How long producing this result took, in milliseconds.</summary>
        public long ElapsedMs { get; set; }

        /// <summary>When this result was produced. UTC.</summary>
        public DateTimeOffset GeneratedAt { get; set; }

        /// <summary>True when the result was served from the aggregation cache.</summary>
        public bool Cached { get; set; }
    }

    /// <summary>
    /// Task Hub level facts of the /storage response.
    /// </summary>
    public class StorageTaskHubInfo
    {
        /// <summary>Task Hub name.</summary>
        public string Name { get; set; }

        /// <summary>Number of partitions. Null when it could not be determined.</summary>
        public int? PartitionCount { get; set; }

        /// <summary>When the Task Hub was created. Null when it could not be determined. UTC.</summary>
        public DateTimeOffset? CreatedAt { get; set; }

        /// <summary>Where the above came from: 'taskhub.json' or 'unknown'.</summary>
        public string Source { get; set; }
    }

    /// <summary>
    /// One queue of the /storage response.
    /// </summary>
    public class StorageQueueInfo
    {
        /// <summary>Queue name.</summary>
        public string Name { get; set; }

        /// <summary>'workitems' or 'control'.</summary>
        public string Kind { get; set; }

        /// <summary>Partition number of a control queue. Null for the work-item queue.</summary>
        public int? Partition { get; set; }

        /// <summary>Approximate number of messages. Null when the queue does not exist or could not be read.</summary>
        public int? ApproximateMessageCount { get; set; }
    }

    /// <summary>
    /// One partition of the /storage response.
    /// </summary>
    public class StoragePartitionInfo
    {
        /// <summary>Partition name (usually the control queue name).</summary>
        public string Name { get; set; }

        /// <summary>Current owner (worker id). Null when unowned or unknown.</summary>
        public string Owner { get; set; }

        /// <summary>Since when the current owner holds the partition. Null when unknown. UTC.</summary>
        public DateTimeOffset? OwnedSince { get; set; }

        /// <summary>True when the partition is being handed over. Null when unknown.</summary>
        public bool? IsDraining { get; set; }

        /// <summary>The worker the partition is being handed over to. Null when none or unknown.</summary>
        public string NextOwner { get; set; }

        /// <summary>Where the above came from: 'table', 'lease-blob' or 'none'.</summary>
        public string Source { get; set; }
    }

    /// <summary>
    /// Names of the tables the Task Hub uses.
    /// </summary>
    public class StorageTablesInfo
    {
        /// <summary>Name of the Instances table.</summary>
        public string Instances { get; set; }

        /// <summary>Name of the History table.</summary>
        public string History { get; set; }

        /// <summary>Name of the Partitions table. Null when the table does not exist.</summary>
        public string Partitions { get; set; }

        /// <summary>Name of the DfMon audit table. Null when the table does not exist.</summary>
        public string Audit { get; set; }
    }

    /// <summary>
    /// The large-message blob container of the Task Hub.
    /// </summary>
    public class StorageLargeMessagesInfo
    {
        /// <summary>Container name.</summary>
        public string Container { get; set; }

        /// <summary>Whether the container exists.</summary>
        public bool Exists { get; set; }

        /// <summary>Number of blobs of the requested instance. Null when no instance was requested.</summary>
        public int? BlobCount { get; set; }

        /// <summary>Total size of those blobs, in bytes. Null when no instance was requested.</summary>
        public long? TotalBytes { get; set; }
    }

    /// <summary>
    /// Row counts of the /storage response. All null unless they were explicitly requested.
    /// </summary>
    public class StorageCountsInfo
    {
        /// <summary>Number of rows in the Instances table. Null when not requested.</summary>
        public long? InstancesRows { get; set; }

        /// <summary>Number of rows in the History table. Null when not requested.</summary>
        public long? HistoryRows { get; set; }

        /// <summary>True when a count hit its scan cap.</summary>
        public bool Partial { get; set; }
    }

    /// <summary>
    /// Response of the /storage endpoint.
    /// </summary>
    public class StorageHealthResult
    {
        /// <summary>Storage provider name, e.g. 'AzureStorage'. Set by the function from DfmExtensionPoints.ProviderName.</summary>
        public string Provider { get; set; }

        /// <summary>Storage account name.</summary>
        public string AccountName { get; set; }

        /// <summary>Task Hub level facts.</summary>
        public StorageTaskHubInfo TaskHub { get; set; }

        /// <summary>The work-item and control queues.</summary>
        public IReadOnlyList<StorageQueueInfo> Queues { get; set; } = new List<StorageQueueInfo>();

        /// <summary>Partition ownership.</summary>
        public IReadOnlyList<StoragePartitionInfo> Partitions { get; set; } = new List<StoragePartitionInfo>();

        /// <summary>Table names.</summary>
        public StorageTablesInfo Tables { get; set; }

        /// <summary>The large-message container.</summary>
        public StorageLargeMessagesInfo LargeMessages { get; set; }

        /// <summary>Row counts, when they were requested.</summary>
        public StorageCountsInfo Counts { get; set; }

        /// <summary>When this result was produced. UTC.</summary>
        public DateTimeOffset GeneratedAt { get; set; }

        /// <summary>How long producing this result took, in milliseconds.</summary>
        public long ElapsedMs { get; set; }

        /// <summary>True when the result was served from the aggregation cache.</summary>
        public bool Cached { get; set; }
    }

    /// <summary>
    /// One audited call: a Write or Dangerous operation that went through DfMon.
    /// </summary>
    public class AuditRecord
    {
        /// <summary>When the call happened. UTC.</summary>
        public DateTimeOffset At { get; set; }

        /// <summary>Who made the call ('anonymous' when authentication is disabled).</summary>
        public string User { get; set; }

        /// <summary>Human readable operation name, e.g. 'Terminate' (see AuditOperations).</summary>
        public string Operation { get; set; }

        /// <summary>'Write' or 'Dangerous'.</summary>
        public string Kind { get; set; }

        /// <summary>The instance the call was about. Null for hub-wide operations.</summary>
        public string InstanceId { get; set; }

        /// <summary>'ok' or 'failed'.</summary>
        public string Outcome { get; set; }

        /// <summary>HTTP status code the call returned.</summary>
        public int Status { get; set; }

        /// <summary>Error text or operation summary. Null when there is nothing to say.</summary>
        public string Message { get; set; }

        /// <summary>The request path, kept for troubleshooting. Not part of the /audit response.</summary>
        public string Route { get; set; }
    }

    /// <summary>
    /// Parameters of an /audit request, already validated and normalized by the function.
    /// </summary>
    public class AuditQuery
    {
        /// <summary>Beginning of the time range (inclusive). UTC.</summary>
        public DateTimeOffset From { get; set; }

        /// <summary>End of the time range (inclusive). UTC.</summary>
        public DateTimeOffset To { get; set; }

        /// <summary>Only return records of this operation. Null means all of them.</summary>
        public string Operation { get; set; }

        /// <summary>How many records to return. Default 100, max 500.</summary>
        public int Top { get; set; } = 100;

        /// <summary>How many records to skip.</summary>
        public int Skip { get; set; }

        /// <summary>Stable part of the AggregationCache key, should the reader ever be cached.</summary>
        [JsonIgnore]
        public string CacheKey =>
            $"{this.From.UtcDateTime:yyyyMMddHHmm}|{this.To.UtcDateTime:yyyyMMddHHmm}|{this.Operation}|{this.Top}|{this.Skip}";
    }

    /// <summary>
    /// One page of audit records, newest first.
    /// </summary>
    public class AuditPage
    {
        /// <summary>The records, newest first.</summary>
        public IReadOnlyList<AuditRecord> Rows { get; set; } = new List<AuditRecord>();

        /// <summary>True when there are more records past this page.</summary>
        public bool HasMore { get; set; }
    }
}
