// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen, waitFor } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { StatsResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import ThroughputPanel, { axisLabels, brushedLabel, statusToken, throughputSeries } from './ThroughputPanel.svelte';
import { bins, stats as statsFixture } from '../../../tests/unit/fixtures/stats';

/** The harness takes a screen, and this one has a prop the harness passes through. */
const Panel = ThroughputPanel as unknown as Component;

function mount(options: { stats?: StatsResponse; path?: string } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Panel,
      path: options.path ?? '/DurableFunctionsHub',
      capabilities: { stats: true },
      props: { stats: options.stats ?? statsFixture() },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/**
 * Drags the d3 brush across the chart. The SVG is drawn in a 1000-wide user space and jsdom measures
 * every element as being at the origin, so a client x is a user-space x here.
 */
async function drag(from: number, to: number): Promise<void> {
  const overlay = document.querySelector('.dfm-brush .overlay') as Element;

  fire(overlay, 'mousedown', from);
  fire(document, 'mousemove', to);
  fire(document, 'mouseup', to);

  await tick();

  // d3 blocks the click that follows a drag and takes that block off again on a timeout of its own,
  // so the drag is not over until a macrotask has run
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One mouse event of the drag. `view` is set after the event is built rather than passed in:
 * d3-drag reads `event.view.document` to suppress the browser's own drag, and jsdom refuses the
 * window vitest exposes as a `view` member while accepting it perfectly well as a property.
 */
function fire(target: EventTarget, type: string, clientX: number): void {
  const event = new MouseEvent(type, { clientX, clientY: 10, bubbles: true, button: 0 });

  Object.defineProperty(event, 'view', { value: document.defaultView });

  target.dispatchEvent(event);
}

describe('throughput series', () => {
  it('always stacks the four statuses of the mockup, bottom-up', () => {
    const series = throughputSeries(statsFixture({ bins: bins(4) }));

    expect(series.map((item) => item.key)).toEqual(['Completed', 'Failed', 'Running', 'Pending']);
    expect(series.map((item) => item.color)).toEqual([
      'status-completed',
      'status-failed',
      'status-running',
      'status-pending',
    ]);
  });

  it('adds the other statuses only when the range actually holds some', () => {
    const series = throughputSeries(
      statsFixture({
        bins: [
          { start: 'a', end: 'b', counts: { Completed: 2, Terminated: 1 } },
          { start: 'b', end: 'c', counts: { Suspended: 0, ContinuedAsNew: 3 } },
        ],
      }),
    );

    expect(series.map((item) => item.key)).toEqual([
      'Completed',
      'Failed',
      'Running',
      'Pending',
      'Terminated',
      'ContinuedAsNew',
    ]);
  });

  it('paints each series with the token behind its status chip', () => {
    expect(statusToken('Completed')).toBe('status-completed');
    expect(statusToken('ContinuedAsNew')).toBe('status-continued');
  });
});

describe('axis labels', () => {
  it('writes the day on the first tick and again when it turns over', () => {
    expect(
      axisLabels([
        '2026-09-03T14:00:00Z',
        '2026-09-03T20:00:00Z',
        '2026-09-04T02:00:00Z',
        '2026-09-04T08:00:00Z',
        '2026-09-04T14:00:00Z',
      ]),
    ).toEqual(['Sep 3, 14:00', '20:00', 'Sep 4, 02:00', '08:00', '14:00']);
  });

  it('says the brushed window the same way', () => {
    expect(brushedLabel('2026-09-04T08:30:00Z', '2026-09-04T14:02:00Z')).toBe('Brushed Sep 4, 08:30 to 14:02');
  });
});

describe('Throughput panel', () => {
  it('is the panel of the mockup: the columns, what they count and what the brush does', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Throughput', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('24 bins · brush sets the global range');

    expect(screen.getByRole('group', { name: 'Instances per 1 h by status' })).toBeInTheDocument();
  });

  it('draws one axis tick per label, dated where the day turns over', () => {
    mount();

    const ticks = Array.from(document.querySelectorAll('.chart > .row > .muted')).map((node) => node.textContent);

    expect(ticks).toEqual(['Sep 3, 14:00', '20:00', 'Sep 4, 02:00', '07:00', '14:00']);
  });

  it('names every series it stacked in the legend', () => {
    mount();

    const legend = Array.from(document.querySelectorAll('.legend > span')).map((node) => node.textContent?.trim());

    expect(legend).toEqual(['Completed', 'Failed', 'Running', 'Pending']);
  });

  it('makes the brushed window the shared range', async () => {
    const rendered = mount();

    await drag(500, 750);

    const range = appOf(rendered).timeRange;

    expect(range).toEqual({ from: '2026-09-04T02:00:00.000Z', to: '2026-09-04T08:00:00.000Z' });

    // The chart is redrawn over that window, so the panel now says which window it is
    expect(document.querySelector('.panel > .row > .meta')?.textContent).toContain('Brushed Sep 4, 02:00 to 08:00');
  });

  it('says which window is in force and puts the preset back', async () => {
    const rendered = mount({ path: '/DurableFunctionsHub?from=2026-09-04T08:30:00Z&to=2026-09-04T14:02:00Z' });

    expect(document.querySelector('.panel > .row > .meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Brushed Sep 4, 08:30 to 14:02 · clear',
    );

    await screen.getByRole('button', { name: 'clear' }).click();

    await waitFor(() => expect(appOf(rendered).timeRange).toEqual({ preset: '24h' }));
  });

  it('says nothing about a window while a preset is in force', () => {
    mount();

    expect(screen.queryByRole('button', { name: 'clear' })).toBeNull();
  });
});
