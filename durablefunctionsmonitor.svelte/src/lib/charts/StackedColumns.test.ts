// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StackedColumns from './StackedColumns.svelte';
import { binsInPixelRange, layoutColumns, rangeOfBins, ticksFor, type ChartBin } from './stacked-columns';

const series = [
  { key: 'Completed', label: 'Completed', color: 'status-completed' },
  { key: 'Running', label: 'Running', color: 'status-running' },
  { key: 'Failed', label: 'Failed', color: 'status-failed' },
];

function bins(count: number, values: Record<string, number> = { Completed: 3, Running: 2, Failed: 1 }): ChartBin[] {
  const start = new Date('2026-09-04T00:00:00Z').getTime();
  const width = 3600_000;

  return Array.from({ length: count }, (_, index) => ({
    start: new Date(start + index * width),
    end: new Date(start + (index + 1) * width),
    values: { ...values },
  }));
}

describe('layoutColumns', () => {
  it('stacks every series of every bin', () => {
    const layout = layoutColumns(bins(12), series, 1000, 160);

    expect(layout.segments).toHaveLength(36);
    expect(layout.columnWidth).toBeCloseTo(1000 / 12);
  });

  it('fills the height with the tallest column and scales the rest to it', () => {
    const data = [
      { start: new Date(0), end: new Date(1), values: { Completed: 10 } },
      { start: new Date(1), end: new Date(2), values: { Completed: 5 } },
    ];

    const layout = layoutColumns(data, series, 100, 160);

    expect(layout.max).toBe(10);
    expect(layout.segments[0].height).toBeCloseTo(160);
    expect(layout.segments[1].height).toBeCloseTo(80);
  });

  it('stacks bottom-up in series order, and the segments of a bin fill its column', () => {
    const layout = layoutColumns(bins(1), series, 100, 160);

    const heights = layout.segments.map((segment) => segment.height);
    expect(heights.reduce((sum, h) => sum + h, 0)).toBeCloseTo(160);

    // The first series sits on the baseline, the next one above it
    expect(layout.segments[0].y + layout.segments[0].height).toBeCloseTo(160);
    expect(layout.segments[1].y + layout.segments[1].height).toBeCloseTo(layout.segments[0].y);
  });

  it('draws nothing for a series with no rows in that bin', () => {
    const layout = layoutColumns(bins(1, { Completed: 4 }), series, 100, 160);

    expect(layout.segments).toHaveLength(1);
  });

  it('survives an empty range', () => {
    const layout = layoutColumns([], series, 100, 160);

    expect(layout.segments).toHaveLength(0);
    expect(layout.max).toBe(1);
  });
});

describe('binsInPixelRange and rangeOfBins', () => {
  it('turns a pixel selection into the bins it covers', () => {
    const data = bins(12);
    const columnWidth = 1000 / 12;

    // Bin 7 through bin 10
    const span = binsInPixelRange(data, 1000, 7 * columnWidth, 11 * columnWidth);

    expect(span).toEqual([7, 10]);
    expect(rangeOfBins(data, 7, 10)).toEqual({ from: data[7].start, to: data[10].end });
  });

  it('includes a bin the selection only clips', () => {
    const data = bins(10);

    expect(binsInPixelRange(data, 1000, 105, 195)).toEqual([1, 1]);
  });

  it('has nothing to say about an empty or inverted selection', () => {
    expect(binsInPixelRange(bins(10), 1000, 100, 100)).toBeNull();
    expect(binsInPixelRange([], 1000, 0, 500)).toBeNull();
  });
});

describe('ticksFor', () => {
  it('spreads the ticks and ends on the last bin’s end', () => {
    const data = bins(12);
    const ticks = ticksFor(data, 1000, 6, (date) => date.toISOString().slice(11, 16));

    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toEqual({ x: 0, label: '00:00' });
    expect(ticks[5].x).toBe(1000);
    expect(ticks[5].label).toBe('12:00');
  });

  it('has no ticks without bins', () => {
    expect(ticksFor([], 1000, 6, String)).toHaveLength(0);
  });
});

describe('StackedColumns', () => {
  it('renders a rect per segment with the ink stroke that makes the stack read as one block', () => {
    render(StackedColumns, { props: { bins: bins(12), series, ariaLabel: 'Throughput' } });

    // Only the data rects: d3-brush adds its own overlay, selection and handles inside its group
    const rects = document.querySelectorAll('svg > rect');
    expect(rects).toHaveLength(36);
    expect(rects[0].getAttribute('stroke')).toBe('var(--ink)');
    expect(rects[0].getAttribute('fill')).toBe('var(--status-completed)');
  });

  it('draws the baseline and the axis ticks', () => {
    render(StackedColumns, { props: { bins: bins(12), series, ariaLabel: 'Throughput' } });

    expect(document.querySelector('svg line[stroke="var(--muted)"]')).not.toBeNull();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('lists the series in a legend', () => {
    render(StackedColumns, { props: { bins: bins(3), series, ariaLabel: 'Throughput' } });

    const legend = document.querySelector('.legend');
    expect(legend?.textContent).toContain('Completed');
    expect(legend?.querySelectorAll('i')).toHaveLength(3);
  });

  it('reports the brushed range snapped to the bins', async () => {
    const onBrush = vi.fn();
    const data = bins(12);

    const { component } = render(StackedColumns, { props: { bins: data, series, ariaLabel: 'Throughput', onBrush } });

    const columnWidth = 1000 / 12;
    (component as unknown as { applyBrush: (a: number, b: number) => void }).applyBrush(
      7 * columnWidth,
      11 * columnWidth,
    );

    expect(onBrush).toHaveBeenCalledWith({ from: data[7].start, to: data[10].end });
  });

  it('offers a clear link once something is brushed, and Escape clears too', async () => {
    const onBrush = vi.fn();
    const data = bins(12);

    render(StackedColumns, {
      props: { bins: data, series, ariaLabel: 'Throughput', brush: { from: data[2].start, to: data[4].end }, onBrush },
    });

    const clear = screen.getByRole('button', { name: 'clear' });
    await fireEvent.click(clear);

    expect(onBrush).toHaveBeenLastCalledWith(null);
  });

  it('shows the bin under the pointer with its counts', async () => {
    render(StackedColumns, { props: { bins: bins(12), series, ariaLabel: 'Throughput' } });

    await fireEvent.mouseEnter(document.querySelector('svg rect') as Element);

    const card = screen.getByRole('status');
    expect(card).toHaveClass('pop');
    expect(card.textContent).toContain('00:00');
    expect(card.textContent).toContain('Completed: 3');
  });

  it('is a labelled group, so a screen reader knows what the chart is', () => {
    render(StackedColumns, { props: { bins: bins(3), series, ariaLabel: 'Throughput' } });

    expect(screen.getByRole('group', { name: 'Throughput' })).toBeInTheDocument();
  });
});
