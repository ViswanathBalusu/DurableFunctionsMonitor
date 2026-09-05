// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Counts and percentages (contracts §10). Thousands separators come from en-US rather than from the
// browser's locale, for the same reason the timestamps are not localised: these are numbers read
// beside machine data, and `1,204` has to mean the same thing in every screenshot.

/** `1,204`. Null, undefined and NaN read as an em dash, never as zero. */
export function fmtInt(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return Math.round(value).toLocaleString('en-US');
}

/**
 * `0.7 %`, one decimal and a space before the sign. Takes a fraction, which is what the backend's
 * failureRate is: 0.007 reads as `0.7 %`.
 */
export function fmtPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return `${(value * 100).toFixed(1)} %`;
}
