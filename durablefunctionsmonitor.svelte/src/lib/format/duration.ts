// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Duration formatting (contracts §10). Durations arrive as milliseconds - the backend computes them
// as `lastUpdatedTime - createdTime` - and are read at three different sizes: a sentence ("41 min"),
// a clock in a header tile ("00:00:47") and a label that has to fit inside a Gantt bar ("2h13m").

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What every function here shows for "no duration": not zero, which would be a claim. */
export const NO_DURATION = '—';

function isDuration(ms: number | null | undefined): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0;
}

/** One decimal, except when it would be `.0`: the table's `2 d` and its `2.3 min` are both examples. */
function scaled(value: number, unit: string): string {
  const text = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${text.endsWith('.0') ? text.slice(0, -2) : text} ${unit}`;
}

/**
 * The readable form, one unit and at most one decimal: `250 ms`, `47 s`, `2.3 min`, `41 min`,
 * `14 h`, `2 d`. Below a second the value is exact to the millisecond; above it the unit changes
 * every time the number would otherwise pass 60 (or 24, or nothing at all for days).
 */
export function fmtDuration(ms: number | null | undefined): string {
  if (!isDuration(ms)) {
    return NO_DURATION;
  }

  if (ms < SECOND) {
    return `${Math.round(ms)} ms`;
  }

  if (ms < MINUTE) {
    return `${Math.round(ms / SECOND)} s`;
  }

  if (ms < HOUR) {
    return scaled(ms / MINUTE, 'min');
  }

  if (ms < DAY) {
    return scaled(ms / HOUR, 'h');
  }

  return scaled(ms / DAY, 'd');
}

/** `HH:MM:SS`, with the days in front when there are any: `00:00:47`, `1d 02:03:04`. */
export function fmtDurationClock(ms: number | null | undefined): string {
  if (!isDuration(ms)) {
    return NO_DURATION;
  }

  const total = Math.floor(ms / SECOND);
  const days = Math.floor(total / 86400);
  const clock = [Math.floor((total % 86400) / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * The two most significant units, without spaces, for a label that has to fit inside a bar:
 * `1d2h`, `2h13m`, `17s`, `250ms`. A port of React's `DateTimeHelpers.formatDuration`, down to
 * `0ms` for a zero duration - the only place where zero is a real answer rather than a missing one.
 */
export function fmtDurationCompact(ms: number | null | undefined): string {
  if (!isDuration(ms)) {
    return NO_DURATION;
  }

  let rest = Math.round(ms);
  let units = 0;
  let text = '';

  for (const [size, suffix] of [
    [DAY, 'd'],
    [HOUR, 'h'],
    [MINUTE, 'm'],
    [SECOND, 's'],
  ] as const) {
    const value = Math.floor(rest / size);

    if (value > 0) {
      text += `${value}${suffix}`;
      rest = rest % size;

      if (++units > 1) {
        return text;
      }
    }
  }

  if (rest > 0) {
    text += `${rest}ms`;
  }

  return text || '0ms';
}
