// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities, StatsResponse, StorageResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import NeedsAttention, { THRESHOLDS_META, workItemsQueued } from './NeedsAttention.svelte';
import { stats as statsFixture } from '../../../tests/unit/fixtures/stats';
import { queue, storage as storageFixture } from '../../../tests/unit/fixtures/storage';

/** The harness takes a screen, and this one has props the harness passes through. */
const Attention = NeedsAttention as unknown as Component;

/** Two seconds past the end of the fixture's range, so "suspended for" is a fixed 14 hours. */
const NOW = Date.parse('2026-09-04T14:00:02Z');

async function mount(
  options: {
    stats?: Partial<StatsResponse>;
    storage?: StorageResponse | null;
    capabilities?: Partial<Capabilities>;
    path?: string;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Attention,
      path: options.path ?? '/DurableFunctionsHub',
      capabilities: options.capabilities ?? {},
      props: { stats: statsFixture(options.stats ?? {}), storage: options.storage ?? null },
    },
  });

  // The clock this panel counts against is the app's, which the screen ticks; pin it here
  appOf(rendered).now = NOW;
  await tick();

  return rendered;
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/** The rows as they read: the count, then the sentence, then the link. */
function rows(): string[][] {
  return Array.from(document.querySelectorAll('.attn > div')).map((row) => [
    row.querySelector('.n')?.textContent ?? '',
    row.querySelector('span:not(.n)')?.textContent ?? '',
    row.querySelector('.link')?.textContent ?? '',
  ]);
}

describe('work-item queue', () => {
  it('finds the one queue that is not a control queue', () => {
    expect(workItemsQueued(storageFixture())).toBe(2);
  });

  it('is unknown rather than zero when the backend reports no queues at all', () => {
    expect(workItemsQueued(null)).toBeNull();
    expect(workItemsQueued(storageFixture({ queues: [queue()] }))).toBeNull();
  });
});

describe('Needs attention', () => {
  it('is the panel of the mockup, with the thresholds spelled out in words', async () => {
    await mount();

    expect(screen.getByRole('heading', { name: 'Needs attention', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe(THRESHOLDS_META);

    expect(rows()).toEqual([
      ['1', 'running longer than 1 h', 'Instances'],
      ['24', 'failed in range', 'Instances'],
      ['1', 'pending older than 10 min', 'Instances'],
      ['1', 'suspended for 14 h', 'Instances'],
    ]);
  });

  it('counts the suspended row up from the moment the instance stopped', async () => {
    const rendered = await mount();

    appOf(rendered).now = Date.parse('2026-09-05T00:00:02Z');
    await tick();

    expect(rows()[3][1]).toBe('suspended for 1 d');
  });

  it('spells the thresholds the way the preferences hold them', async () => {
    const rendered = await mount();

    appOf(rendered).prefs.thresholds = { stuckMinutes: 90, pendingMinutes: 45, queueDepth: 1 };
    await tick();

    expect(rows()[0][1]).toBe('running longer than 1.5 h');
    expect(rows()[2][1]).toBe('pending older than 45 min');
  });

  it('hides a row nobody needs to look at, but says when nothing failed', async () => {
    await mount({
      stats: {
        totals: { all: 4, entities: 0, Failed: 0 },
        stuck: { count: 0, sampleIds: [], oldestLastUpdatedAt: null },
        oldestPending: { count: 0, sampleIds: [], oldestCreatedAt: null },
        suspended: { count: 0, sampleIds: [], oldestLastUpdatedAt: null },
      },
    });

    expect(rows()).toEqual([['0', 'failed in range', 'Instances']]);
  });

  it('adds the queue row only when the backend reports one deeper than the threshold', async () => {
    const shallow = await mount({ storage: storageFixture(), capabilities: { storageHealth: true } });

    expect(rows().map((row) => row[1])).not.toContain('work items queued');

    shallow.unmount();

    await mount({
      storage: storageFixture({
        queues: [queue({ name: 'hub-workitems', kind: 'workitems', partition: null, approximateMessageCount: 1_240 })],
      }),
      capabilities: { storageHealth: true },
    });

    expect(rows()[3]).toEqual(['1,240', 'work items queued', 'Storage']);
  });

  it('opens the stuck instances oldest first, over the range on screen', async () => {
    const rendered = await mount({ path: '/DurableFunctionsHub?range=7d' });

    await screen.getAllByRole('button', { name: 'Instances' })[0].click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('instances');
    expect(route.query.get('status')).toBe('Running');
    expect(route.query.get('stuck')).toBe('1');
    expect(route.query.get('orderby')).toBe('lastUpdatedTime');
    expect(route.query.get('dir')).toBe('asc');
    expect(route.query.get('range')).toBe('7d');
  });

  it('sends the failures row where the backend can group them', async () => {
    const rendered = await mount({ capabilities: { failures: true } });

    expect(rows()[1][2]).toBe('Failures');

    await screen.getByRole('button', { name: 'Failures' }).click();

    expect(appOf(rendered).router.current.name).toBe('failures');
  });

  it('sends the queue row to Storage', async () => {
    const rendered = await mount({
      storage: storageFixture({
        queues: [queue({ name: 'hub-workitems', kind: 'workitems', partition: null, approximateMessageCount: 1_240 })],
      }),
      capabilities: { storageHealth: true },
    });

    await screen.getByRole('button', { name: 'Storage' }).click();

    expect(appOf(rendered).router.current.name).toBe('storage');
  });
});
