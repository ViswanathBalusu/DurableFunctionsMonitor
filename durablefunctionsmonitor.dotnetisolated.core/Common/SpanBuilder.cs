// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Globalization;
using Microsoft.DurableTask.Client;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

// Turns an instance's history into the spans the Timeline tab, the "where the time went" bars and the
// peek mini timeline draw, replacing the client-side Gantt merging of the React app
// (durablefunctionsmonitor.react/src/states/details-view/GanttDiagramTabState.ts).
//
// Pure: no storage access, no DurableTaskClient calls, so every rule is unit tested directly
// (tests/durablefunctionsmonitor.dotnetisolated.core.tests/SpanBuilderTests.cs) rather than through the endpoint.
//
// Property names are the ones the UI is built against: see docs/plans/svelte-rewrite/00-shared-contracts.md
// section 6 (Span, SpansResponse).

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The values of <see cref="Span.Kind"/>. Strings rather than an enum, because the contract spells them
    /// in camelCase and Globals.SerializerSettings serializes enums with their declared (PascalCase) names.
    /// </summary>
    public static class SpanKinds
    {
        /// <summary>One episode (replay) of the orchestrator itself. Comes from the episode markers, not from the history rows.</summary>
        public const string Orchestrator = "orchestrator";

        /// <summary>One activity call.</summary>
        public const string Activity = "activity";

        /// <summary>One sub-orchestration call.</summary>
        public const string SubOrchestration = "subOrchestration";

        /// <summary>One durable timer.</summary>
        public const string Timer = "timer";

        /// <summary>The (zero-length) moment an external event arrived.</summary>
        public const string ExternalEvent = "externalEvent";

        /// <summary>The stretch of time the orchestrator spent waiting for an external event.</summary>
        public const string EventWait = "eventWait";
    }

    /// <summary>
    /// The values of <see cref="Span.Status"/>.
    /// </summary>
    public static class SpanStatuses
    {
        /// <summary>A task, sub-orchestration or episode that finished successfully.</summary>
        public const string Completed = "completed";

        /// <summary>A task or sub-orchestration that finished with an error.</summary>
        public const string Failed = "failed";

        /// <summary>Still going at <c>now</c>: no completion row in the history yet.</summary>
        public const string Running = "running";

        /// <summary>A timer that fired.</summary>
        public const string Fired = "fired";

        /// <summary>Time spent waiting for an external event.</summary>
        public const string Waiting = "waiting";

        /// <summary>The moment an external event was raised.</summary>
        public const string Raised = "raised";
    }

    /// <summary>
    /// Writes span timestamps with millisecond precision, e.g. '2026-09-04T14:02:12.004Z'.
    ///
    /// Globals.SerializerSettings formats dates as 'yyyy-MM-ddTHH:mm:ssZ', which is fine for the instance
    /// lists but would collapse a 400 ms activity to a zero-width bar on a timeline. Still ISO 8601 UTC, as
    /// contracts section 6 requires; the history endpoint keeps sub-second precision the same way
    /// (Functions/Orchestration.cs, HistorySerializerSettings). The builder always emits UTC values.
    /// </summary>
    class SpanTimestampConverter : IsoDateTimeConverter
    {
        public SpanTimestampConverter()
        {
            this.DateTimeFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
            this.Culture = CultureInfo.InvariantCulture;
        }
    }

    /// <summary>
    /// One bar of the timeline.
    /// </summary>
    public class Span
    {
        /// <summary>Stable id of the span, '{kind}:{sequenceNumber ?? index}'. Unique inside one response.</summary>
        public string Id { get; set; }

        /// <summary>One of <see cref="SpanKinds"/>.</summary>
        public string Kind { get; set; }

        /// <summary>
        /// Activity/sub-orchestration/event name. Null when the history does not name the span
        /// (durable timers, and the open 'waiting for something' span at the end of a running instance).
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// 1 for the first span with this name and kind, 2 for the next one, and so on - so retries of the
        /// same activity are numbered. For an aggregated span (see <see cref="SpanBuilder"/>) it is instead
        /// the number of spans that were folded into it.
        /// </summary>
        public int Attempt { get; set; }

        /// <summary>When the span started. UTC.</summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset Start { get; set; }

        /// <summary>When the span ended. Null while it is still going. UTC.</summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset? End { get; set; }

        /// <summary>One of <see cref="SpanStatuses"/>.</summary>
        public string Status { get; set; }

        /// <summary>
        /// The history rows this span was built from, so the UI can scroll the History tab to them.
        /// Empty when the provider does not report sequence numbers, or when the span has no row of its own.
        /// </summary>
        public IReadOnlyList<long> SequenceNumbers { get; set; } = new List<long>();

        /// <summary>Instance id of the child, for a sub-orchestration span. Omitted for every other kind.</summary>
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string SubOrchestrationId { get; set; }

        /// <summary>How long the span took, in milliseconds. Null while it is still going.</summary>
        public double? DurationMs { get; set; }
    }

    /// <summary>
    /// The 'where the time went' numbers. Open spans count until <c>now</c>.
    /// </summary>
    public class SpansTotals
    {
        /// <summary>Time spent in activities, in milliseconds. Overlapping activities are counted once each.</summary>
        public double ActivitiesMs { get; set; }

        /// <summary>Time spent in sub-orchestrations, in milliseconds.</summary>
        public double SubOrchestrationsMs { get; set; }

        /// <summary>Time spent in durable timers, in milliseconds.</summary>
        public double TimersMs { get; set; }

        /// <summary>Time spent waiting for external events, in milliseconds.</summary>
        public double ExternalEventWaitMs { get; set; }

        /// <summary>
        /// Time spent inside the orchestrator code itself, in milliseconds.
        /// Null when the storage provider does not report episode markers.
        /// </summary>
        public double? OrchestratorMs { get; set; }

        /// <summary>Wall-clock lifetime of the current execution, in milliseconds.</summary>
        public double TotalMs { get; set; }
    }

    /// <summary>
    /// What <see cref="SpanBuilder.Build"/> computes. The /spans endpoint (B2-S3) adds the instance id,
    /// execution id, generation, row counts and 'now' around it.
    /// </summary>
    public class SpansResult
    {
        /// <summary>The spans, ordered by start ascending (orchestrator episodes win ties).</summary>
        public IReadOnlyList<Span> Spans { get; set; } = new List<Span>();

        /// <summary>The 'where the time went' numbers.</summary>
        public SpansTotals Totals { get; set; } = new SpansTotals();

        /// <summary>Timestamp of the ExecutionStarted row of the current execution. Null when the history has none. UTC.</summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset? ExecutionStartedAt { get; set; }

        /// <summary>Timestamp of the ExecutionCompleted/ExecutionFailed/ExecutionTerminated row. Null while the instance runs. UTC.</summary>
        [JsonConverter(typeof(SpanTimestampConverter))]
        public DateTimeOffset? ExecutionEndedAt { get; set; }
    }

    /// <summary>
    /// Turns an instance's history (as OrchestrationHistory returns it: a scheduled task is merged with its
    /// completion row, so a TaskCompleted/TaskFailed row carries ScheduledTime, and an unmatched TaskScheduled
    /// row means "still running") plus its episode markers into timeline spans and totals.
    /// </summary>
    public static class SpanBuilder
    {
        /// <summary>
        /// Histories longer than this get their spans aggregated, mirroring the React app's
        /// MaxEventsBeforeStartAggregating rule (which used 500 for a Mermaid diagram; the SVG timeline
        /// copes with more).
        /// </summary>
        public const int MaxEventsBeforeStartAggregating = 5000;

        /// <summary>
        /// When aggregating, consecutive spans of the same kind and name that start within this many
        /// milliseconds of the first one of the group are folded into a single span.
        /// </summary>
        public const int AggregationWindowInMs = 500;

        /// <summary>
        /// Builds the spans of one instance.
        /// </summary>
        /// <param name="history">The instance's history, oldest row first. Null or empty is allowed.</param>
        /// <param name="markers">Episode markers, or null when the storage provider does not report them
        /// (then there are no orchestrator spans and <see cref="SpansTotals.OrchestratorMs"/> is null).</param>
        /// <param name="status">Current runtime status. Non-terminal instances can get a trailing open span.</param>
        /// <param name="now">The moment the response is produced; open spans are measured against it.</param>
        public static SpansResult Build(
            IReadOnlyList<HistoryEvent> history,
            IReadOnlyList<EpisodeMarker> markers,
            OrchestrationRuntimeStatus status,
            DateTimeOffset now)
        {
            now = now.ToUniversalTime();

            // Rows without a timestamp cannot be placed on a timeline at all
            var rows = (history ?? new List<HistoryEvent>())
                .Where(evt => evt != null && evt.Timestamp != default)
                .ToList();

            var result = new SpansResult();

            // Only the current execution matters. ContinueAsNew starts a new one with its own ExecutionStarted,
            // and some history routines return the previous generations too (same rule as InputEventEligibility).
            int executionStartIndex = LastIndexOf(rows, HistoryEventTypes.ExecutionStarted);
            if (executionStartIndex >= 0)
            {
                rows = rows.Skip(executionStartIndex).ToList();
                result.ExecutionStartedAt = rows[0].Timestamp.ToUniversalTime();
            }

            string orchestratorName = executionStartIndex >= 0 ? NullIfEmpty(rows[0].Name) : null;

            foreach (var evt in rows)
            {
                if (evt.EventType == ExecutionCompleted || evt.EventType == ExecutionFailed || evt.EventType == ExecutionTerminated)
                {
                    result.ExecutionEndedAt = evt.Timestamp.ToUniversalTime();
                }
            }

            var spans = BuildHistorySpans(rows, result.ExecutionStartedAt, status, now);

            if (markers != null)
            {
                // Orchestrator episodes go first, so that they win ties when the list is sorted by Start
                // (the first episode starts exactly when the instance does)
                spans.InsertRange(0, BuildOrchestratorSpans(markers, orchestratorName));
            }

            // OrderBy is stable, so spans that start at the same moment keep the order they were built in
            var ordered = spans.OrderBy(s => s.Start).ToList();

            if (rows.Count > MaxEventsBeforeStartAggregating)
            {
                ordered = Aggregate(ordered);
            }

            EnsureUniqueIds(ordered);

            foreach (var span in ordered)
            {
                span.DurationMs = span.End == null ? null : Elapsed(span.Start, span.End.Value);
            }

            result.Spans = ordered;
            result.Totals = ComputeTotals(ordered, markers != null, result.ExecutionStartedAt ?? rows.FirstOrDefault()?.Timestamp.ToUniversalTime(), result.ExecutionEndedAt, now);

            return result;
        }

        #region History rows -> spans

        private static List<Span> BuildHistorySpans(
            IReadOnlyList<HistoryEvent> rows,
            DateTimeOffset? executionStartedAt,
            OrchestrationRuntimeStatus status,
            DateTimeOffset now)
        {
            var spans = new List<Span>();
            var attempts = new Dictionary<string, int>();

            // TimerFired rows are consumed by the TimerCreated row they belong to
            var timerPairs = PairTimers(rows);
            var pairedFiredRows = new HashSet<HistoryEvent>(timerPairs.Values.Where(evt => evt != null));

            for (int i = 0; i < rows.Count; i++)
            {
                var evt = rows[i];
                var timestamp = evt.Timestamp.ToUniversalTime();

                switch (evt.EventType)
                {
                    case TaskCompleted:
                    case TaskFailed:
                    case TaskScheduled:

                        spans.Add(MakeSpan(attempts, SpanKinds.Activity, NullIfEmpty(evt.Name), i, evt,
                            start: StartOfScheduled(evt, timestamp),
                            end: IsUnmatched(evt.EventType) ? null : timestamp,
                            status: StatusOfScheduled(evt.EventType)));

                        break;

                    case SubOrchestrationInstanceCompleted:
                    case SubOrchestrationInstanceFailed:
                    case SubOrchestrationInstanceCreated:

                        var subSpan = MakeSpan(attempts, SpanKinds.SubOrchestration, NullIfEmpty(evt.Name), i, evt,
                            start: StartOfScheduled(evt, timestamp),
                            end: IsUnmatched(evt.EventType) ? null : timestamp,
                            status: StatusOfScheduled(evt.EventType));

                        subSpan.SubOrchestrationId = NullIfEmpty(evt.SubOrchestrationId);
                        spans.Add(subSpan);

                        break;

                    case TimerCreated:

                        timerPairs.TryGetValue(evt, out var firedEvent);
                        spans.Add(MakeTimerSpan(attempts, i, evt, firedEvent, now));

                        break;

                    case TimerFired:

                        // An orphan TimerFired (its TimerCreated row is gone, or the history was truncated)
                        // still deserves a mark on the timeline
                        if (!pairedFiredRows.Contains(evt))
                        {
                            spans.Add(MakeSpan(attempts, SpanKinds.Timer, NullIfEmpty(evt.Name), i, evt,
                                start: timestamp,
                                end: timestamp,
                                status: SpanStatuses.Fired));
                        }

                        break;

                    case HistoryEventTypes.EventRaised:

                        // The orchestrator was waiting for this event from the moment the previous row happened
                        var waitStart = i > 0 ? rows[i - 1].Timestamp.ToUniversalTime() : (executionStartedAt ?? timestamp);
                        if (waitStart > timestamp)
                        {
                            waitStart = timestamp;
                        }

                        spans.Add(MakeSpan(attempts, SpanKinds.EventWait, NullIfEmpty(evt.Name), i, evt,
                            start: waitStart,
                            end: timestamp,
                            status: SpanStatuses.Waiting));

                        // ...and the arrival itself is a zero-length mark
                        spans.Add(MakeSpan(attempts, SpanKinds.ExternalEvent, NullIfEmpty(evt.Name), i, evt,
                            start: timestamp,
                            end: timestamp,
                            status: SpanStatuses.Raised));

                        break;
                }
            }

            // A running instance whose last row did not leave an activity, sub-orchestration or timer open
            // is waiting for something external. We cannot know what, so the span is unnamed.
            if (rows.Count > 0 && !InputEventEligibility.IsTerminal(status) && !LeavesSomethingOpen(rows[rows.Count - 1], timerPairs))
            {
                spans.Add(new Span
                {
                    Id = $"{SpanKinds.EventWait}:{rows.Count}",
                    Kind = SpanKinds.EventWait,
                    Name = null,
                    Attempt = NextAttempt(attempts, SpanKinds.EventWait, null),
                    Start = rows[rows.Count - 1].Timestamp.ToUniversalTime(),
                    End = null,
                    Status = SpanStatuses.Waiting
                });
            }

            return spans;
        }

        private static Span MakeSpan(
            Dictionary<string, int> attempts,
            string kind,
            string name,
            int index,
            HistoryEvent evt,
            DateTimeOffset start,
            DateTimeOffset? end,
            string status)
        {
            return new Span
            {
                Id = $"{kind}:{evt.SequenceNumber?.ToString(CultureInfo.InvariantCulture) ?? index.ToString(CultureInfo.InvariantCulture)}",
                Kind = kind,
                Name = name,
                Attempt = NextAttempt(attempts, kind, name),
                Start = start,
                End = end,
                Status = status,
                SequenceNumbers = SequenceNumbersOf(evt)
            };
        }

        private static Span MakeTimerSpan(Dictionary<string, int> attempts, int index, HistoryEvent created, HistoryEvent fired, DateTimeOffset now)
        {
            var start = created.Timestamp.ToUniversalTime();
            var fireAt = created.FireAt?.ToUniversalTime();

            DateTimeOffset? end;
            string status;

            if (fired != null)
            {
                end = fired.Timestamp.ToUniversalTime();
                status = SpanStatuses.Fired;
            }
            else if (fireAt == null || fireAt > now)
            {
                // Still ticking: the bar reaches to its due moment, if the provider reports one
                end = fireAt;
                status = SpanStatuses.Running;
            }
            else
            {
                // Due moment already passed, but no TimerFired row: the timer is over as far as the timeline
                // is concerned. The exact firing moment is unknown, so the span ends when it was due.
                end = fireAt;
                status = SpanStatuses.Fired;
            }

            if (end != null && end < start)
            {
                end = start;
            }

            var sequenceNumbers = new List<long>();
            if (created.SequenceNumber != null)
            {
                sequenceNumbers.Add(created.SequenceNumber.Value);
            }
            if (fired?.SequenceNumber != null)
            {
                sequenceNumbers.Add(fired.SequenceNumber.Value);
            }

            string name = NullIfEmpty(created.Name) ?? NullIfEmpty(fired?.Name);

            return new Span
            {
                Id = $"{SpanKinds.Timer}:{created.SequenceNumber?.ToString(CultureInfo.InvariantCulture) ?? index.ToString(CultureInfo.InvariantCulture)}",
                Kind = SpanKinds.Timer,
                Name = name,
                Attempt = NextAttempt(attempts, SpanKinds.Timer, name),
                Start = start,
                End = end,
                Status = status,
                SequenceNumbers = sequenceNumbers
            };
        }

        /// <summary>
        /// Matches TimerFired rows to the TimerCreated rows they belong to: by TimerId first (Azure Storage
        /// reports it), then first-come-first-served for whatever is left (MSSQL reports no TimerId).
        /// The returned map contains an entry for every TimerCreated row; the value is null when it never fired.
        /// </summary>
        private static Dictionary<HistoryEvent, HistoryEvent> PairTimers(IReadOnlyList<HistoryEvent> rows)
        {
            var created = rows.Where(evt => evt.EventType == TimerCreated).ToList();
            var fired = rows.Where(evt => evt.EventType == TimerFired).ToList();

            var pairs = new Dictionary<HistoryEvent, HistoryEvent>();
            foreach (var evt in created)
            {
                pairs[evt] = null;
            }

            var unpairedFired = new List<HistoryEvent>();

            foreach (var firedEvent in fired)
            {
                var match = firedEvent.TimerId == null
                    ? null
                    : created.FirstOrDefault(c => pairs[c] == null && c.EventId != null && c.EventId == firedEvent.TimerId);

                if (match == null)
                {
                    unpairedFired.Add(firedEvent);
                }
                else
                {
                    pairs[match] = firedEvent;
                }
            }

            // FIFO for the rest
            foreach (var firedEvent in unpairedFired)
            {
                var match = created.FirstOrDefault(c => pairs[c] == null && c.Timestamp <= firedEvent.Timestamp)
                    ?? created.FirstOrDefault(c => pairs[c] == null);

                if (match != null)
                {
                    pairs[match] = firedEvent;
                }
            }

            return pairs;
        }

        /// <summary>
        /// True when the given (last) history row left an activity, sub-orchestration or timer running,
        /// so the instance is waiting for that rather than for an external event.
        /// </summary>
        private static bool LeavesSomethingOpen(HistoryEvent evt, Dictionary<HistoryEvent, HistoryEvent> timerPairs)
        {
            switch (evt.EventType)
            {
                case TaskScheduled:
                case SubOrchestrationInstanceCreated:
                    return true;

                case TimerCreated:
                    return timerPairs.TryGetValue(evt, out var fired) && fired == null;

                default:
                    return false;
            }
        }

        private static DateTimeOffset StartOfScheduled(HistoryEvent evt, DateTimeOffset timestamp)
        {
            if (IsUnmatched(evt.EventType) || evt.ScheduledTime == null)
            {
                return timestamp;
            }

            var scheduled = evt.ScheduledTime.Value.ToUniversalTime();

            // A scheduled time after the completion time (clock skew between workers) would draw a
            // backwards bar. Clamp it to a zero-length span instead.
            return scheduled > timestamp ? timestamp : scheduled;
        }

        private static bool IsUnmatched(string eventType)
        {
            return eventType == TaskScheduled || eventType == SubOrchestrationInstanceCreated;
        }

        private static string StatusOfScheduled(string eventType)
        {
            switch (eventType)
            {
                case TaskFailed:
                case SubOrchestrationInstanceFailed:
                    return SpanStatuses.Failed;

                case TaskScheduled:
                case SubOrchestrationInstanceCreated:
                    return SpanStatuses.Running;

                default:
                    return SpanStatuses.Completed;
            }
        }

        private static IReadOnlyList<long> SequenceNumbersOf(HistoryEvent evt)
        {
            return evt.SequenceNumber == null ? new List<long>() : new List<long> { evt.SequenceNumber.Value };
        }

        private static int NextAttempt(Dictionary<string, int> attempts, string kind, string name)
        {
            string key = $"{kind}|{name}";
            attempts.TryGetValue(key, out int seen);
            attempts[key] = seen + 1;
            return seen + 1;
        }

        #endregion

        #region Episode markers -> orchestrator spans

        private static List<Span> BuildOrchestratorSpans(IReadOnlyList<EpisodeMarker> markers, string orchestratorName)
        {
            var spans = new List<Span>();

            for (int i = 0; i < markers.Count; i++)
            {
                var marker = markers[i];
                if (marker == null)
                {
                    continue;
                }

                spans.Add(new Span
                {
                    Id = $"{SpanKinds.Orchestrator}:{i}",
                    Kind = SpanKinds.Orchestrator,
                    Name = orchestratorName,
                    // Episode number: the same "1 + earlier spans of this kind and name" rule
                    Attempt = spans.Count + 1,
                    Start = marker.Start.ToUniversalTime(),
                    End = marker.End?.ToUniversalTime(),
                    Status = marker.End == null ? SpanStatuses.Running : SpanStatuses.Completed
                });
            }

            return spans;
        }

        #endregion

        #region Aggregation and totals

        /// <summary>
        /// Folds consecutive spans of the same kind and name that start within
        /// <see cref="AggregationWindowInMs"/> of each other into one span, whose Attempt is how many spans
        /// went into it. Orchestrator episodes are left alone. Only used for very long histories.
        /// </summary>
        private static List<Span> Aggregate(List<Span> spans)
        {
            var result = new List<Span>();

            int i = 0;
            while (i < spans.Count)
            {
                var first = spans[i];

                if (first.Kind == SpanKinds.Orchestrator)
                {
                    result.Add(first);
                    i++;
                    continue;
                }

                int j = i + 1;
                while (j < spans.Count
                    && spans[j].Kind == first.Kind
                    && string.Equals(spans[j].Name, first.Name, StringComparison.Ordinal)
                    && (spans[j].Start - first.Start).TotalMilliseconds <= AggregationWindowInMs)
                {
                    j++;
                }

                if (j == i + 1)
                {
                    result.Add(first);
                    i = j;
                    continue;
                }

                var group = spans.GetRange(i, j - i);

                var sequenceNumbers = new List<long>();
                foreach (var span in group)
                {
                    sequenceNumbers.AddRange(span.SequenceNumbers);
                }

                bool anyOpen = group.Any(s => s.End == null);

                result.Add(new Span
                {
                    Id = first.Id,
                    Kind = first.Kind,
                    Name = first.Name,
                    Attempt = group.Count,
                    Start = first.Start,
                    End = anyOpen ? null : group.Max(s => s.End.Value),
                    Status =
                        group.Any(s => s.Status == SpanStatuses.Failed) ? SpanStatuses.Failed :
                        anyOpen ? SpanStatuses.Running :
                        first.Status,
                    SequenceNumbers = sequenceNumbers,
                    SubOrchestrationId = first.SubOrchestrationId
                });

                i = j;
            }

            return result;
        }

        private static SpansTotals ComputeTotals(
            IReadOnlyList<Span> spans,
            bool hasMarkers,
            DateTimeOffset? origin,
            DateTimeOffset? executionEndedAt,
            DateTimeOffset now)
        {
            double SumOf(string kind) => spans.Where(s => s.Kind == kind).Sum(s => Elapsed(s.Start, s.End ?? now));

            return new SpansTotals
            {
                ActivitiesMs = SumOf(SpanKinds.Activity),
                SubOrchestrationsMs = SumOf(SpanKinds.SubOrchestration),
                TimersMs = SumOf(SpanKinds.Timer),
                ExternalEventWaitMs = SumOf(SpanKinds.EventWait),
                OrchestratorMs = hasMarkers ? SumOf(SpanKinds.Orchestrator) : (double?)null,
                TotalMs = origin == null ? 0 : Elapsed(origin.Value, executionEndedAt ?? now)
            };
        }

        private static double Elapsed(DateTimeOffset from, DateTimeOffset to)
        {
            double ms = (to - from).TotalMilliseconds;
            return ms < 0 ? 0 : ms;
        }

        #endregion

        /// <summary>
        /// The '{kind}:{sequenceNumber ?? index}' rule produces unique ids for the histories we know of, but
        /// a provider that reports no (or duplicated) sequence numbers could still collide. The UI keys its
        /// rows by id, so make sure they are unique.
        /// </summary>
        private static void EnsureUniqueIds(IReadOnlyList<Span> spans)
        {
            var seen = new HashSet<string>();

            foreach (var span in spans)
            {
                if (seen.Add(span.Id))
                {
                    continue;
                }

                int suffix = 2;
                while (!seen.Add($"{span.Id}#{suffix}"))
                {
                    suffix++;
                }

                span.Id = $"{span.Id}#{suffix}";
            }
        }

        private static int LastIndexOf(IReadOnlyList<HistoryEvent> rows, string eventType)
        {
            for (int i = rows.Count - 1; i >= 0; i--)
            {
                if (rows[i].EventType == eventType)
                {
                    return i;
                }
            }

            return -1;
        }

        private static string NullIfEmpty(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }

        private const string TaskScheduled = "TaskScheduled";
        private const string TaskCompleted = "TaskCompleted";
        private const string TaskFailed = "TaskFailed";
        private const string SubOrchestrationInstanceCreated = "SubOrchestrationInstanceCreated";
        private const string SubOrchestrationInstanceCompleted = "SubOrchestrationInstanceCompleted";
        private const string SubOrchestrationInstanceFailed = "SubOrchestrationInstanceFailed";
        private const string TimerCreated = "TimerCreated";
        private const string TimerFired = "TimerFired";
        private const string ExecutionCompleted = "ExecutionCompleted";
        private const string ExecutionFailed = "ExecutionFailed";
        private const string ExecutionTerminated = "ExecutionTerminated";
    }
}
