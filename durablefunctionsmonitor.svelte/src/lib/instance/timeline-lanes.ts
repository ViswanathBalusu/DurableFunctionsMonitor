// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// `/spans` turned into the lanes the Timeline tab draws (ScreenInstance.dc.html L300-L310, design
// §8). Pure: which bar belongs to which lane, and what it says, is decided here and unit tested,
// rather than eyeballed against a screenshot.
//
// The rules, in the order they matter:
//   - the orchestrator's own episodes are lane 0, thin `orch` bars, and carry the dashed now line;
//   - every other span gets a lane by name, in order of first start;
//   - retries of one activity are lanes of their own when the provider numbered them one span per
//     attempt (the mockup's `ChargePayment (retry 2)`); otherwise they are numbered segments of one
//     lane, and two spans that overlap in time are split apart, because one track cannot hold both.

import type { HistoryEvent, Span, SpansResponse } from '$lib/api/types';
import { isNarrow, placeSpan, type Swimlane, type SwimlaneBar, type TimeDomain } from '$lib/charts/swimlane';
import { fmtDuration } from '$lib/format/duration';
import { resultOf } from './history-columns';

/** The key of the orchestrator's own lane before its first episode names it. */
export const ORCHESTRATOR_LANE = 'orchestrator';

/** Where the dashed now line sits, as a percentage of the track (mockup L296). */
export const NOW_PERCENT = 96;

/** A raised event has no duration, and a bar of no width is a bar nobody can see (mockup L306). */
export const MARKER_PERCENT = 1;

/** What a wait is called before the event that ends it arrives and names it. */
export const UNKNOWN_WAIT_LABEL = 'wait for external event';

/** What a timer is called when it is not the pause between two attempts of the same activity. */
export const TIMER_LABEL = 'timer';
export const RETRY_BACKOFF_LABEL = 'retry backoff';

/** How much of a failure reason fits inside a bar before it is cut (mockup L304, `timeout 4.0 s`). */
export const REASON_MAX = 12;

export interface TimelineInput {
  /** The `/spans` answer, or null while there is none: the timeline is then empty, not invented. */
  spans: SpansResponse | null;
  /** The orchestrator's name, which is what lane 0 is called. */
  name?: string;
  /** Still running: open bars run to the now line, and the now line is drawn at all. */
  running?: boolean;
  /**
   * The history rows on screen. A span does not carry why it failed - the history row it was built
   * from does - so a failed bar can only name its reason while the rows behind it are loaded.
   */
  history?: readonly HistoryEvent[];
}

export interface Timeline {
  lanes: Swimlane[];
  domain: TimeDomain;
}

/** What one span's bar is filled with (contracts §11, dfm-ui.css). */
export function barClass(span: Span): string | undefined {
  switch (span.kind) {
    case 'orchestrator':
      return 'orch';
    case 'timer':
      return 'st-suspended';
    case 'eventWait':
      return 'wait';
    case 'externalEvent':
      // The arrival itself is a solid tick, so it can be told apart from the dotted wait it ends
      return undefined;
    default:
      break;
  }

  switch (span.status) {
    case 'failed':
      return 'st-failed';
    case 'running':
      return 'st-running';
    default:
      return 'st-completed';
  }
}

/**
 * The head of a failure reason, for the bar (mockup L304: `timeout 4.0 s`): the first word, without
 * the trailing colon and the `Exception` every exception type ends in, cut at {@link REASON_MAX}
 * characters. The whole reason is in the bar's title, which is where one too long to read belongs.
 */
export function shortReason(reason: unknown): string | null {
  if (typeof reason !== 'string') {
    return null;
  }

  const first = (reason.trim().split(/\s+/)[0] ?? '').replace(/:+$/, '');
  const word = first.replace(/Exception$/, '') || first;

  if (!word) {
    return null;
  }

  return word.length > REASON_MAX ? `${word.slice(0, REASON_MAX)}…` : word;
}

/**
 * The window the bars are placed in: the execution's own start and end. A running instance ends at
 * `now` plus the sliver the now line stands in, so the line is visible rather than flat against the
 * right border (mockup L296: `left:96%`).
 */
export function timelineDomain(response: SpansResponse | null, running = false): TimeDomain {
  const spans = response?.spans ?? [];
  const starts = spans.map((span) => Date.parse(span.start)).filter((value) => Number.isFinite(value));
  const now = response ? Date.parse(response.now) : Number.NaN;

  const started = response?.executionStartedAt ? Date.parse(response.executionStartedAt) : Number.NaN;
  const from = Number.isFinite(started) ? started : starts.length > 0 ? Math.min(...starts) : now;

  const ended = response?.executionEndedAt ? Date.parse(response.executionEndedAt) : Number.NaN;
  const to = Number.isFinite(ended) ? ended : running ? from + (now - from) / (NOW_PERCENT / 100) : now;

  const start = Number.isFinite(from) ? from : 0;
  const end = Number.isFinite(to) && to > start ? to : start + 1;

  return { from: new Date(start), to: new Date(end) };
}

/** The lanes, in the order they are drawn, and the window they are drawn in. */
export function buildTimeline(input: TimelineInput): Timeline {
  const response = input.spans;
  const domain = timelineDomain(response, input.running);
  const now = response ? Date.parse(response.now) : Number.NaN;

  const spans = [...(response?.spans ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const calls = spans.filter(isCall);
  const split = attemptLanes(calls);

  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();

  for (const span of spans) {
    const lane = laneOf(span, { calls, split, orchestratorName: input.name });
    const { bar, text } = buildBar(span, domain, now, {
      reason: reasonOf(span, input.history),
      numbered: !lane.separate,
    });

    const draft = laneFor(drafts, byKey, lane, span, bar);

    draft.bars.push(bar);
    draft.texts.push(text);
    draft.lastEnd = Math.max(draft.lastEnd, endOf(span, domain));
  }

  // Lane 0 is the orchestrator whether or not the provider reports its episodes: it is what carries
  // the now line, and a hub without episode markers still has an instance that is still running
  if (input.running && !byKey.has(ORCHESTRATOR_LANE)) {
    drafts.unshift({
      key: ORCHESTRATOR_LANE,
      label: input.name || ORCHESTRATOR_LANE,
      orchestrator: true,
      bars: [],
      texts: [],
      lastEnd: Number.NEGATIVE_INFINITY,
    });
  }

  return { lanes: drafts.map((draft) => finish(draft, input.running === true)), domain };
}

// ---------------------------------------------------------------- the pieces

/** A lane under construction: the bars are pushed in start order, the label never changes. */
interface Draft {
  key: string;
  label: string;
  /** The orchestrator's own lane, which is the one the now line is drawn on. */
  orchestrator: boolean;
  bars: SwimlaneBar[];
  /** What each bar would have said had it been wide enough, so a lone narrow one can say it beside. */
  texts: (string | undefined)[];
  /** Where the last bar ends, as a timestamp, so an overlapping span can be moved to a lane of its own. */
  lastEnd: number;
}

interface Lane {
  key: string;
  label: string;
  /** The retries of this name have a lane each, so a bar does not have to say which attempt it is. */
  separate: boolean;
  orchestrator: boolean;
}

function isCall(span: Span): boolean {
  return span.kind === 'activity' || span.kind === 'subOrchestration';
}

/** `activity:ChargePayment` - one name of one kind, which is what a lane is about. */
function nameKey(span: Span): string {
  return `${span.kind}:${span.name ?? ''}`;
}

/**
 * The names whose retries get a lane each, labelled `{name} (retry n)` as the mockup labels them:
 * the ones the provider numbered one span per attempt. A name whose attempts hold several spans -
 * a fan-out, or a history long enough for B2 to have folded spans together - stays one lane with
 * numbered segments instead, because a lane per span would be a lane per call.
 */
function attemptLanes(calls: Span[]): Set<string> {
  const groups = new Map<string, Span[]>();

  for (const span of calls) {
    const key = nameKey(span);
    const list = groups.get(key);

    if (list) {
      list.push(span);
    } else {
      groups.set(key, [span]);
    }
  }

  const split = new Set<string>();

  for (const [key, list] of groups) {
    const attempts = new Set(list.map((span) => span.attempt));

    if (attempts.size > 1 && attempts.size === list.length) {
      split.add(key);
    }
  }

  return split;
}

/** Which lane a span belongs in, and what that lane is called. */
function laneOf(span: Span, context: { calls: Span[]; split: Set<string>; orchestratorName?: string }): Lane {
  const name = span.name ?? '';

  switch (span.kind) {
    case 'orchestrator':
      return {
        key: ORCHESTRATOR_LANE,
        label: context.orchestratorName || name || ORCHESTRATOR_LANE,
        separate: false,
        orchestrator: true,
      };

    case 'timer': {
      const label = isRetryBackoff(span, context.calls) ? RETRY_BACKOFF_LABEL : TIMER_LABEL;

      return { key: `timer:${label}`, label, separate: false, orchestrator: false };
    }

    case 'eventWait':
      return {
        key: `wait:${name}`,
        label: name ? `wait ${name}` : UNKNOWN_WAIT_LABEL,
        separate: false,
        orchestrator: false,
      };

    case 'externalEvent':
      // The arrival lands on the lane of the wait it ended; a lane it opens itself is not a wait
      return {
        key: `wait:${name}`,
        label: name ? `event ${name}` : 'external event',
        separate: false,
        orchestrator: false,
      };

    default: {
      const base = nameKey(span);
      const separate = context.split.has(base);

      return {
        key: separate ? `${base}#${span.attempt}` : base,
        label: callLabel(span, separate && span.attempt > 1),
        separate,
        orchestrator: false,
      };
    }
  }
}

/** `ChargePayment`, `ChargePayment (retry 2)`, `NotifyCustomer (sub)`, `NotifyCustomer (sub, retry 2)`. */
function callLabel(span: Span, retry: boolean): string {
  const name = span.name || '(unnamed)';

  if (span.kind !== 'subOrchestration') {
    return retry ? `${name} (retry ${span.attempt})` : name;
  }

  return retry ? `${name} (sub, retry ${span.attempt})` : `${name} (sub)`;
}

/**
 * Whether a timer is the pause between two attempts of one activity (the mockup's `retry backoff`):
 * the call that ended last before it and the first one to start after it are the same activity, and
 * the later one is a retry of the earlier.
 */
function isRetryBackoff(timer: Span, calls: Span[]): boolean {
  const start = Date.parse(timer.start);
  const end = timer.end ? Date.parse(timer.end) : Number.POSITIVE_INFINITY;

  let before: Span | null = null;
  let beforeEnd = Number.NEGATIVE_INFINITY;

  for (const call of calls) {
    const callEnd = call.end ? Date.parse(call.end) : Number.NaN;

    if (Number.isFinite(callEnd) && callEnd <= start && callEnd > beforeEnd) {
      before = call;
      beforeEnd = callEnd;
    }
  }

  const after = calls.find((call) => Date.parse(call.start) >= end);

  return (
    before !== null &&
    after !== undefined &&
    before.kind === after.kind &&
    before.name === after.name &&
    after.attempt > before.attempt
  );
}

/**
 * The lane this bar goes in: the one its key names, or the next copy of it when the last bar there
 * has not ended yet. Two bars at once in one track would draw one over the other, and the picture
 * would say that a fan-out of ten calls was one call.
 *
 * The orchestrator is the exception: its episodes are one thing happening over and over (design §8:
 * "a thin ink bar at the top lane"), and a history that leaves an episode open - a batch that lost
 * its lease, and never wrote its `OrchestratorCompleted` - would otherwise push every later episode
 * onto a second lane with the same label.
 */
function laneFor(drafts: Draft[], byKey: Map<string, Draft>, lane: Lane, span: Span, bar: SwimlaneBar): Draft {
  const start = Date.parse(span.start);

  for (let copy = 1; ; copy++) {
    const key = copy === 1 ? lane.key : `${lane.key}~${copy}`;
    const existing = byKey.get(key);

    if (!existing) {
      // Keyed by its first span, so entering a lane names a span the history rows below share
      const draft: Draft = {
        key: bar.key,
        label: lane.label,
        orchestrator: lane.orchestrator,
        bars: [],
        texts: [],
        lastEnd: Number.NEGATIVE_INFINITY,
      };

      byKey.set(key, draft);
      drafts.push(draft);

      return draft;
    }

    if (lane.orchestrator || start >= existing.lastEnd) {
      return existing;
    }
  }
}

/** Where a span ends on the clock; an open one ends where the picture does. */
function endOf(span: Span, domain: TimeDomain): number {
  return span.end ? Date.parse(span.end) : domain.to.getTime();
}

/** How long a span took, counting an open one against the clock the response was built at. */
function durationOf(span: Span, now: number): number | null {
  if (span.durationMs !== null) {
    return span.durationMs;
  }

  const start = Date.parse(span.start);

  return Number.isFinite(now) && Number.isFinite(start) ? Math.max(0, now - start) : null;
}

/**
 * Why a span failed, from the history row it was built from - `Result` where the runtime wrote the
 * message and `Details` where it wrote the stack, which is the order the History tab reads them in.
 */
function reasonOf(span: Span, history?: readonly HistoryEvent[]): string | null {
  if (span.status !== 'failed' || !history?.length) {
    return null;
  }

  for (const event of history) {
    if (event.SequenceNumber === null || !span.sequenceNumbers.includes(event.SequenceNumber)) {
      continue;
    }

    const reason = resultOf(event);

    if (typeof reason === 'string' && reason.trim() !== '') {
      return reason;
    }
  }

  return null;
}

/** One bar, and what it would have said had it been wide enough to say it. */
function buildBar(
  span: Span,
  domain: TimeDomain,
  now: number,
  options: { reason: string | null; numbered: boolean },
): { bar: SwimlaneBar; text: string | undefined } {
  // An open span runs to now, not to the edge: the sliver past the now line is not time it ran for
  const open = Number.isFinite(now) ? new Date(now) : null;
  const placed = placeSpan(span.start, span.end ?? open, domain);
  const width = span.kind === 'externalEvent' ? MARKER_PERCENT : placed.width;
  const ms = durationOf(span, now);
  const text = barText(span, ms, options);

  return {
    bar: {
      key: span.id,
      cls: barClass(span),
      left: placed.left,
      width,
      text: isNarrow(width) ? undefined : text,
      title: barTitle(span, ms, options.reason),
      sequenceNumbers: span.sequenceNumbers,
    },
    text,
  };
}

/** What a bar says when it is wide enough to say anything. */
function barText(
  span: Span,
  ms: number | null,
  options: { reason: string | null; numbered: boolean },
): string | undefined {
  const duration = fmtDuration(ms);

  switch (span.kind) {
    case 'orchestrator':
    case 'externalEvent':
      // Thin bars, both of them: a replay episode and the instant an event arrived
      return undefined;

    case 'timer':
      return duration;

    case 'eventWait':
      return span.end === null ? `waiting ${duration}` : duration;

    default:
      break;
  }

  if (span.status === 'failed') {
    const short = shortReason(options.reason);

    return short ? `${short} ${duration}` : duration;
  }

  if (span.status === 'running') {
    return `running ${duration}`;
  }

  // A retry sharing its lane says which attempt it is; one with a lane of its own is labelled
  return options.numbered && span.attempt > 1 ? `retry ${span.attempt}` : duration;
}

/** What a bar says on hover: what it is, how it went, how long it took, and why it failed. */
function barTitle(span: Span, ms: number | null, reason: string | null): string {
  const duration = fmtDuration(ms);
  const name = span.name || '';

  switch (span.kind) {
    case 'orchestrator':
      return `replay · ${duration}`;

    case 'timer':
      return span.end === null ? 'timer, still pending' : `timer · ${duration}`;

    case 'eventWait':
      if (span.end === null) {
        return name ? `waiting for ${name}` : 'external event, still waiting';
      }

      return name ? `waited for ${name} · ${duration}` : `waited for an external event · ${duration}`;

    case 'externalEvent':
      return name ? `${name} raised` : 'external event raised';

    default:
      break;
  }

  const what = span.kind === 'subOrchestration' ? 'sub-orchestration' : 'activity';
  const head = `${what} ${span.status} · ${duration}`;

  return reason ? `${head} · ${reason}` : head;
}

/**
 * A finished lane. A lane holding one bar too narrow to carry its own text says it beside the bar
 * instead (mockup L302, L306); a lane of several such bars says nothing, and the titles are what is
 * left to read.
 */
function finish(draft: Draft, running: boolean): Swimlane {
  const lane: Swimlane = { key: draft.key, label: draft.label, bars: draft.bars };

  if (!draft.bars.some((bar) => bar.text !== undefined)) {
    const index = draft.texts.findIndex((text) => !!text);

    if (index >= 0) {
      lane.lbl = draft.texts[index];
      lane.lblLeft = Math.min(100, draft.bars[index].left + draft.bars[index].width + 0.6);
    }
  }

  if (running && draft.orchestrator) {
    lane.now = NOW_PERCENT;
  }

  return lane;
}
