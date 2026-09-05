// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The "Needs attention" thresholds as the Settings screen types them (E6-S3-T1). The mockup shows
// `1 h`, `10 min` and `1,000` (ScreenSettings.dc.html L56-L58) - so a duration is written the way it
// is read, and parsed back to the minutes the preferences and the /stats query are in.

/** How many minutes each unit is worth. Everything is stored, sent and compared in minutes. */
const UNIT_MINUTES: Readonly<Record<string, number>> = {
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
  d: 1440,
  day: 1440,
  days: 1440,
};

/**
 * `1 h` → 60, `90 min` → 90, `2 d` → 2880, a bare `45` → 45. Null for anything that is not a
 * positive whole number of minutes: a threshold of zero would mark every instance as needing
 * attention, which is not a threshold.
 */
export function parseDuration(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(text.trim());

  if (!match) {
    return null;
  }

  const unit = match[2].toLowerCase();
  const factor = unit === '' ? 1 : UNIT_MINUTES[unit];

  if (factor === undefined) {
    return null;
  }

  const minutes = Number(match[1]) * factor;

  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

/** The largest unit the value is a whole number of: 2880 → `2 d`, 60 → `1 h`, 90 → `90 min`. */
export function formatDuration(minutes: number): string {
  if (minutes > 0 && minutes % 1440 === 0) {
    return `${minutes / 1440} d`;
  }

  if (minutes > 0 && minutes % 60 === 0) {
    return `${minutes / 60} h`;
  }

  return `${minutes} min`;
}

/** `1,000` → 1000. Null for anything that is not a positive whole number. */
export function parseCount(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);

  return value > 0 ? value : null;
}

/** 1000 → `1,000`, the way the mockup writes a queue depth. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
