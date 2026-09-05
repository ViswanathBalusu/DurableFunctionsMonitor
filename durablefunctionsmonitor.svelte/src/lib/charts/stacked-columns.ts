// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The geometry behind StackedColumns. Pure, so the stacking, the tick placement and the brush
// snapping are unit tested rather than inspected by eye in a browser.

export interface ChartBin {
  start: Date;
  end: Date;
  /** Count per series key; a missing key is zero. */
  values: Record<string, number>;
}

export interface ChartSeries {
  key: string;
  label: string;
  /** A token name (`status-failed`, `chart-1`), used as `var(--name)`. */
  color: string;
}

export interface Segment {
  binIndex: number;
  seriesKey: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

export interface Layout {
  segments: Segment[];
  /** Bin index → total of its series. */
  totals: number[];
  /** The largest column, which is what the y scale is fitted to. */
  max: number;
  columnWidth: number;
}

export interface Range {
  from: Date;
  to: Date;
}

/**
 * Stacks the bins bottom-up in series order into `width` × `height`.
 *
 * Columns touch (the mockups' `.col` has a -2px margin, so the 2px ink strokes overlap into one
 * line); a bin with nothing in it contributes no segments at all rather than a zero-height rect,
 * which would draw as a stray line.
 */
export function layoutColumns(bins: ChartBin[], series: ChartSeries[], width: number, height: number): Layout {
  const totals = bins.map((bin) => series.reduce((sum, s) => sum + (bin.values[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const columnWidth = bins.length > 0 ? width / bins.length : width;

  const segments: Segment[] = [];

  bins.forEach((bin, binIndex) => {
    let bottom = height;

    for (const s of series) {
      const value = bin.values[s.key] ?? 0;

      if (value <= 0) {
        continue;
      }

      const segmentHeight = (value / max) * height;
      bottom -= segmentHeight;

      segments.push({
        binIndex,
        seriesKey: s.key,
        color: s.color,
        x: binIndex * columnWidth,
        y: bottom,
        width: columnWidth,
        height: segmentHeight,
        value,
      });
    }
  });

  return { segments, totals, max, columnWidth };
}

/**
 * The bin indexes an x range covers, as [first, last]. Both ends are inclusive, and a selection that
 * clips a bin at all includes it: the user is picking bins, not pixels.
 */
export function binsInPixelRange(bins: ChartBin[], width: number, x0: number, x1: number): [number, number] | null {
  if (bins.length === 0 || x1 <= x0) {
    return null;
  }

  const columnWidth = width / bins.length;

  // The epsilon is not decoration: a selection that starts exactly on a bin edge computes to
  // 6.999999999 with floating point, and would silently include the bin before it.
  const epsilon = 1e-9;
  const first = Math.max(0, Math.floor(x0 / columnWidth + epsilon));
  const last = Math.min(bins.length - 1, Math.ceil(x1 / columnWidth - epsilon) - 1);

  return last < first ? null : [first, last];
}

/** The time range of a bin span, snapped to the bins' own edges. */
export function rangeOfBins(bins: ChartBin[], first: number, last: number): Range {
  return { from: bins[first].start, to: bins[last].end };
}

/** Where a tick sits, in pixels, and what it says. */
export interface Tick {
  x: number;
  label: string;
}

/**
 * `count` ticks spread over the bins, always including the first and the last edge, so the axis
 * always says where the range starts and where it ends.
 */
export function ticksFor(bins: ChartBin[], width: number, count: number, format: (date: Date) => string): Tick[] {
  if (bins.length === 0 || count < 2) {
    return [];
  }

  const step = (bins.length - 1) / (count - 1);

  return Array.from({ length: count }, (_, index) => {
    const binIndex = Math.min(bins.length - 1, Math.round(index * step));
    const isLast = index === count - 1;

    return {
      x: (isLast ? bins.length : binIndex) * (width / bins.length),
      label: format(isLast ? bins[bins.length - 1].end : bins[binIndex].start),
    };
  });
}
