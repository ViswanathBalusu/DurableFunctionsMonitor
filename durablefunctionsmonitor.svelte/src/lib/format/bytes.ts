// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Byte formatting and the inline-payload limit (contracts §10).

/** What the backend can still store inline; past this a payload moves to a blob. */
export const MAX_INLINE_BYTES = 61440;

/**
 * The size a string takes in the backend's storage: it writes payloads with Encoding.Unicode, so a
 * character is two bytes. This is an estimate of what the backend will measure, not of the UTF-8
 * length the browser would report.
 */
export function utf16Bytes(text: string): number {
  return (text ?? '').length * 2;
}

/**
 * `0.9 KB`, `41.2 KB`, `211 MB` (contracts §10): one decimal below 100 of a unit, none above, so a
 * column of sizes lines up without being noisy.
 */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
    return '—';
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
