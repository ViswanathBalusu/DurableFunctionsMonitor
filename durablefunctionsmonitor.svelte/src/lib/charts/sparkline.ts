// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { scaleLinear } from 'd3-scale';

/** The viewBox the mockups draw sparklines in (ScreenOverview.dc.html L31). */
export const SPARKLINE_WIDTH = 100;
export const SPARKLINE_HEIGHT = 26;
const PADDING = 4;

/**
 * The `points` attribute of the sparkline polyline: values spread evenly across the width, the y
 * scale inverted (bigger is higher) and padded so the stroke is never clipped. A flat series - all
 * zeros, or one repeated value - draws along the bottom rather than through the middle, because a
 * line in the middle reads as "half of something".
 */
export function sparklinePoints(values: number[], width = SPARKLINE_WIDTH, height = SPARKLINE_HEIGHT): string {
  if (values.length === 0) {
    return '';
  }

  const max = Math.max(...values);
  const min = Math.min(...values);

  const x = scaleLinear()
    .domain([0, Math.max(1, values.length - 1)])
    .range([0, width]);

  const y = scaleLinear()
    .domain(max === min ? [0, Math.max(1, max)] : [min, max])
    .range([height - PADDING, PADDING]);

  const flat = max === min;

  return values.map((value, index) => `${round(x(index))},${round(flat ? height - PADDING : y(value))}`).join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
