// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Turning times into the percentages the swimlane's CSS positions bars with. Pure, so the arithmetic
// that decides where a bar sits is unit tested rather than eyeballed against a screenshot.

export interface TimeDomain {
  from: Date;
  to: Date;
}

export interface SwimlaneBar {
  key: string;
  /** Extra classes from dfm-ui.css: `wait` (dotted, still waiting), `orch` (the thin episode bar). */
  cls?: string;
  left: number;
  width: number;
  text?: string;
  title?: string;
  /** History rows behind this bar, so a click can scroll the History tab to them. */
  sequenceNumbers?: number[];
}

export interface Swimlane {
  key: string;
  label: string;
  /** Where the label points: the lane is a thing in its own right (an instance, a span). */
  href?: string;
  bars: SwimlaneBar[];
  /** A label drawn after a bar too narrow to hold its own text. */
  lbl?: string;
  lblLeft?: number;
  /** The dashed "now" line, for a lane that is still running. */
  now?: number;
}

/** Bars narrower than this carry their text beside them instead of inside (ScreenInstances L264). */
export const NARROW_BAR_PERCENT = 6;

/**
 * Where a span sits in the domain, as percentages of it. An open span (no end) runs to the right
 * edge, which is what "still running" looks like; anything outside the domain is clamped rather than
 * dropped, so a bar that started before the window still shows where it ends.
 */
export function placeSpan(
  start: Date | string,
  end: Date | string | null,
  domain: TimeDomain,
): { left: number; width: number } {
  const from = domain.from.getTime();
  const to = domain.to.getTime();
  const span = Math.max(1, to - from);

  const startMs = new Date(start).getTime();
  const endMs = end === null ? to : new Date(end).getTime();

  const left = clampPercent(((startMs - from) / span) * 100);
  const right = clampPercent(((endMs - from) / span) * 100);

  return { left, width: Math.max(0, round(right - left)) };
}

/** True when a bar is too narrow to hold its own text. */
export function isNarrow(width: number): boolean {
  return width < NARROW_BAR_PERCENT;
}

/** How far a label drawn beside a bar sits from it, in pixels (the `+ 6px` of `.blbl`'s position). */
export const SPILL_GAP_PX = 6;

/** Where a bar's text is drawn: in the bar, or beside it on one side. */
export type SpillSide = 'inside' | 'right' | 'left';

/**
 * Where the text of a bar wide enough to be given some goes. `isNarrow` decides on percentages, before
 * anything is drawn, so a bar can pass it and still be narrower than its words: "Timeout 4 s" was cut
 * to "Timeo" inside a failed retry. Measured after layout, then: inside when it fits; beside the bar
 * on the right when there is room before the next bar of the lane (or the end of the track); on the
 * left when there is room after the previous one; and, with room on neither side, inside after all,
 * where the bar cuts it with an ellipsis rather than mid-letter.
 *
 * Everything in pixels: `textPx` the text's own width, `innerPx` the room inside the bar, `beforePx`
 * and `afterPx` the free track on either side of it.
 */
export function spillSide(textPx: number, innerPx: number, beforePx: number, afterPx: number): SpillSide {
  if (textPx <= innerPx + 0.5) {
    return 'inside';
  }

  // The gap from this bar, and as much again before whatever comes next
  const needed = textPx + SPILL_GAP_PX * 2;

  if (afterPx >= needed) {
    return 'right';
  }

  if (beforePx >= needed) {
    return 'left';
  }

  return 'inside';
}

/** Evenly spaced tick times across the domain, including both ends. */
export function domainTicks(domain: TimeDomain, count: number): Date[] {
  if (count < 2) {
    return [domain.from];
  }

  const from = domain.from.getTime();
  const span = domain.to.getTime() - from;

  return Array.from({ length: count }, (_, index) => new Date(from + (span * index) / (count - 1)));
}

function clampPercent(value: number): number {
  return round(Math.min(100, Math.max(0, value)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
