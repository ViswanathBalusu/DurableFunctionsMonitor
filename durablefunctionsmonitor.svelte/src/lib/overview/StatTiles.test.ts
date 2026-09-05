// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities, StatsResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import StatTiles, { binCounts, entityLine } from './StatTiles.svelte';
import { bins, stats as statsFixture } from '../../../tests/unit/fixtures/stats';

/** The harness takes a screen, and this one has a prop the harness passes through. */
const Tiles = StatTiles as unknown as Component;

function mount(options: { stats?: StatsResponse; capabilities?: Partial<Capabilities>; path?: string } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Tiles,
      path: options.path ?? '/DurableFunctionsHub',
      capabilities: options.capabilities ?? {},
      props: { stats: options.stats ?? statsFixture() },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/** One tile, by the label it carries. */
function tile(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`) });
}

describe('stat tile values', () => {
  it('reads one status out of the bins, counting a missing key as zero', () => {
    const stats = statsFixture({
      bins: [
        { start: 'a', end: 'b', counts: { Running: 2, Failed: 1 } },
        { start: 'b', end: 'c', counts: { Completed: 9 } },
      ],
    });

    expect(binCounts(stats, 'Running')).toEqual([2, 0]);
    expect(binCounts(stats, 'Failed')).toEqual([1, 0]);
    expect(binCounts(stats, 'Completed')).toEqual([0, 9]);
  });

  it('draws the entities as the flat line they are counted as', () => {
    const stats = statsFixture({ bins: bins(3), totals: { all: 10, entities: 212 } });

    expect(entityLine(stats)).toEqual([212, 212, 212]);
  });
});

describe('Stat tiles', () => {
  it('is the six tiles of the mockup, in its order and with its fills', () => {
    mount();

    const tiles = Array.from(document.querySelectorAll('.tiles > .stat-tile'));

    expect(tiles.map((node) => node.querySelector('.lbl')?.textContent)).toEqual([
      'Running',
      'Pending',
      'Failed',
      'Completed',
      'Suspended',
      'Entities',
    ]);

    expect(tiles.map((node) => node.className)).toEqual([
      'stat-tile st-running',
      'stat-tile st-pending',
      'stat-tile st-failed',
      'stat-tile st-completed',
      'stat-tile st-suspended',
      'stat-tile kind-entity',
    ]);
  });

  it('shows the totals /stats reported, and nothing for a status it did not', () => {
    mount();

    expect(tile('Running').querySelector('.num')?.textContent).toBe('3');
    expect(tile('Failed').querySelector('.num')?.textContent).toBe('24');
    expect(tile('Completed').querySelector('.num')?.textContent).toBe('1,180');
    expect(tile('Entities').querySelector('.num')?.textContent).toBe('2');

    // Terminated is not one of the six, and Canceled was never counted at all
    expect(tile('Suspended').querySelector('.num')?.textContent).toBe('1');
  });

  it('draws a line per tile from the bins of the range', () => {
    mount();

    const points = tile('Failed').querySelector('polyline')?.getAttribute('points') ?? '';

    expect(points.split(' ')).toHaveLength(24);
  });

  it('opens the filtered list of its status, over the range on screen', async () => {
    const rendered = mount({ path: '/DurableFunctionsHub?range=7d' });

    await tile('Running').click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('instances');
    expect(route.query.get('status')).toBe('Running');
    expect(route.query.get('range')).toBe('7d');
  });

  it('carries a brushed window rather than a preset when that is the range', async () => {
    const rendered = mount({
      path: '/DurableFunctionsHub?from=2026-09-04T08:00:00Z&to=2026-09-04T14:00:00Z',
    });

    await tile('Pending').click();

    const route = appOf(rendered).router.current;

    expect(route.query.get('from')).toBe('2026-09-04T08:00:00Z');
    expect(route.query.get('to')).toBe('2026-09-04T14:00:00Z');
    expect(route.query.get('range')).toBeNull();
  });

  it('sends Failed to the grouped failures when the backend can group them', async () => {
    const rendered = mount({ capabilities: { failures: true } });

    await tile('Failed').click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('failures');
    expect(route.query.get('status')).toBeNull();
  });

  it('sends Failed to the filtered list when it cannot', async () => {
    const rendered = mount();

    await tile('Failed').click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('instances');
    expect(route.query.get('status')).toBe('Failed');
  });

  it('sends the entities tile to the entities screen', async () => {
    const rendered = mount();

    await tile('Entities').click();

    expect(appOf(rendered).router.current.name).toBe('entities');
  });
});
