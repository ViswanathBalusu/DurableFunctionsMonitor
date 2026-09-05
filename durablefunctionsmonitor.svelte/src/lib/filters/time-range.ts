// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The global time range shared by Overview, Instances, Failures, Functions and Activity
// (contracts §4). It lives in the URL query (`range` for a preset, `from`/`to` for a custom
// window), so changing it on one screen changes it everywhere and links stay shareable.

export type TimeRangePreset = '15m' | '1h' | '24h' | '7d' | '30d';

export type TimeRange = { preset: TimeRangePreset } | { from: string; to: string };

/** Preset order as the mockups list it (`DFM App.dc.html` L336). */
export const TIME_RANGE_PRESETS: readonly TimeRangePreset[] = ['15m', '1h', '24h', '7d', '30d'];

/** Preset labels, verbatim from contracts §4. */
export const TIME_RANGE_LABELS: Readonly<Record<TimeRangePreset, string>> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const PRESET_MS: Readonly<Record<TimeRangePreset, number>> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

/** Contracts §4: "Default `24h`." */
export const DEFAULT_TIME_RANGE: TimeRange = { preset: '24h' };

export function isPreset(range: TimeRange): range is { preset: TimeRangePreset } {
  return 'preset' in range;
}

function isKnownPreset(value: string | null): value is TimeRangePreset {
  return !!value && (TIME_RANGE_PRESETS as readonly string[]).includes(value);
}

function isParsableDate(value: string | null): value is string {
  return !!value && !Number.isNaN(new Date(value).getTime());
}

/**
 * Reads the range out of a route query. An explicit, parsable `from`+`to` pair wins over
 * `range`; anything unrecognised falls back to the default 24 hours.
 */
export function parseTimeRange(query: URLSearchParams): TimeRange {
  const from = query.get('from');
  const to = query.get('to');
  if (isParsableDate(from) && isParsableDate(to)) {
    return { from, to };
  }

  const preset = query.get('range');
  return isKnownPreset(preset) ? { preset } : DEFAULT_TIME_RANGE;
}

/**
 * The query patch that puts `range` on the URL, as `Router.setQuery` wants it:
 * `null` deletes the key, so a preset clears `from`/`to` and a custom window clears `range`.
 */
export function toQuery(range: TimeRange): Record<string, string | null> {
  return isPreset(range)
    ? { range: range.preset, from: null, to: null }
    : { range: null, from: range.from, to: range.to };
}

/** Turns the range into the absolute window the backend endpoints take. */
export function resolve(range: TimeRange, now: Date = new Date()): { from: Date; to: Date } {
  if (isPreset(range)) {
    const to = new Date(now.getTime());
    return { from: new Date(to.getTime() - PRESET_MS[range.preset]), to };
  }
  return { from: new Date(range.from), to: new Date(range.to) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// Times are rendered in UTC here (contracts §8: time display defaults to UTC). The screens
// that honour the user's `showTimeAs` preference format the resolved dates themselves.
function datePart(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function timePart(date: Date): string {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** "Last 24 hours" for a preset, `2026-09-04 08:30 → 14:02` for a custom window. */
export function label(range: TimeRange): string {
  if (isPreset(range)) {
    return TIME_RANGE_LABELS[range.preset];
  }

  const { from, to } = resolve(range);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return '';
  }

  const fromDay = datePart(from);
  const toDay = datePart(to);
  const right = fromDay === toDay ? timePart(to) : `${toDay} ${timePart(to)}`;
  return `${fromDay} ${timePart(from)} → ${right}`;
}
