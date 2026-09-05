// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Time formatting (contracts §10). Every input is an ISO string from the backend, which is always
// UTC; `showTimeAs` decides which clock the user reads it on. No locale formatting anywhere: these
// are machine timestamps, and `2026-09-04 14:02:11` is the same everywhere.
//
// The parts come from Intl rather than from Date's getters. Both agree on the browser's zone, but
// only Intl re-reads it, which is what lets a test pin a zone (and what keeps this in step with
// @internationalized/date, which the date field uses).

export type ShowTimeAs = 'UTC' | 'Local';

interface TimeParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const utcFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function localFormatter(): Intl.DateTimeFormat {
  // Rebuilt per call: the resolved zone can change (a test pins TZ, a machine crosses DST)
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function parts(date: Date, showTimeAs: ShowTimeAs): TimeParts {
  const formatted = (showTimeAs === 'UTC' ? utcFormatter : localFormatter()).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatted.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),

    // Intl renders midnight as 24 in some locales' 24-hour cycle
    hours: value('hour') % 24,
    minutes: value('minute'),
    seconds: value('second'),

    // Milliseconds are the same on every clock
    ms: date.getUTCMilliseconds(),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** `2026-09-04 14:02:11`. */
export function fmtDateTime(iso: string | null | undefined, showTimeAs: ShowTimeAs = 'UTC'): string {
  const date = parse(iso);
  if (!date) {
    return '—';
  }

  const p = parts(date, showTimeAs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
}

/** `2026-09-04 14:02:11.913` - history rows and input events, where milliseconds order the events. */
export function fmtDateTimeMs(iso: string | null | undefined, showTimeAs: ShowTimeAs = 'UTC'): string {
  const date = parse(iso);
  if (!date) {
    return '—';
  }

  return `${fmtDateTime(iso, showTimeAs)}.${pad(parts(date, showTimeAs).ms, 3)}`;
}

/** `14:02:11`. */
export function fmtTime(iso: string | null | undefined, showTimeAs: ShowTimeAs = 'UTC'): string {
  const date = parse(iso);
  if (!date) {
    return '—';
  }

  const p = parts(date, showTimeAs);
  return `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
}

/** `14:02:11.913`. */
export function fmtTimeMs(iso: string | null | undefined, showTimeAs: ShowTimeAs = 'UTC'): string {
  const date = parse(iso);
  if (!date) {
    return '—';
  }

  return `${fmtTime(iso, showTimeAs)}.${pad(parts(date, showTimeAs).ms, 3)}`;
}

/**
 * `47 s ago`, `11 min ago`, `1 h 52 min ago`, `1 d ago` (contracts §10). A time in the future - clock
 * skew between the browser and the storage account - reads `just now` rather than a negative age.
 */
export function fmtAgo(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) {
    return '—';
  }

  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 1) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${seconds} s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  }

  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * `UTC`, `UTC+2`, `UTC-5.5` - what the Local half of the time toggle actually means on this machine.
 * Read from Intl's long offset, so it follows daylight saving and whatever zone the process is in.
 */
export function timeZoneLabel(now: Date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'longOffset' }).formatToParts(now);
  const name = formatted.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';

  // 'GMT' alone means no offset; otherwise 'GMT+02:00' / 'GMT-05:30'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);

  if (!match) {
    return 'UTC';
  }

  const hours = Number(match[2]) + Number(match[3]) / 60;

  if (hours === 0) {
    return 'UTC';
  }

  return `UTC${match[1]}${Number.isInteger(hours) ? hours : hours.toFixed(1)}`;
}
