// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Reading the design tokens from the document, for the one thing CSS variables cannot do: exporting.
// Components paint with `fill: var(--x)` so a theme change repaints them for free; these helpers exist
// so that a saved SVG carries real colours instead of variables no viewer can resolve.

import { statusClass } from '$lib/format/status';

/** The resolved value of a `--token`, or '' when the document has no such token. */
export function tokenColor(name: string): string {
  if (!globalThis.document) {
    return '';
  }

  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/** The colour of a runtime status, from the same token the chip uses. */
export function statusColor(status: string): string {
  const cls = statusClass(status);
  return cls ? tokenColor(cls.replace(/^st-/, 'status-')) : '';
}

/** The five categorical series colours, cycling for a sixth series and beyond. */
export function chartSeriesColor(index: number): string {
  return tokenColor(`chart-${(index % 5) + 1}`);
}

export function inkColor(): string {
  return tokenColor('ink');
}

/** The colour of a small solid mark - an arrowhead, a lifeline, a hatch. The ink in the papers (E13). */
export function glyphColor(): string {
  return tokenColor('glyph');
}

export function mutedColor(): string {
  return tokenColor('muted-foreground');
}
