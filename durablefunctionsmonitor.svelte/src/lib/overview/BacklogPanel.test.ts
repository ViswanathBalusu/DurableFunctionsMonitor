// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { StorageResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import BacklogPanel, { BACKLOG_META, partitionsLine, queueLabel } from './BacklogPanel.svelte';
import { partition, queue, storage as storageFixture } from '../../../tests/unit/fixtures/storage';

/** The harness takes a screen, and this one has a prop the harness passes through. */
const Backlog = BacklogPanel as unknown as Component;

function mount(options: { storage?: StorageResponse } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Backlog,
      path: '/DurableFunctionsHub',
      capabilities: { stats: true, storageHealth: true },
      props: { storage: options.storage ?? storageFixture() },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/** The rows as term and value. */
function rows(): [string, string][] {
  return Array.from(document.querySelectorAll('dl.kv dt')).map((dt) => [
    dt.textContent ?? '',
    dt.nextElementSibling?.textContent?.trim() ?? '',
  ]);
}

describe('backlog lines', () => {
  it('names a control queue by its partition, not by the hub prefix in front of it', () => {
    expect(queueLabel('durablefunctionshub-control-00', 0)).toBe('control-00');
    expect(queueLabel('durablefunctionshub-control-11', 11)).toBe('control-11');

    // A queue the backend gave no partition keeps the name it came with
    expect(queueLabel('durablefunctionshub-workitems', null)).toBe('durablefunctionshub-workitems');
  });

  it('says how many partitions have an owner', () => {
    expect(partitionsLine(storageFixture())).toBe('4 · all owned');

    expect(partitionsLine(storageFixture({ partitions: [partition(), partition({ name: 'b', owner: null })] }))).toBe(
      '1 of 2 owned',
    );
  });
});

describe('Backlog panel', () => {
  it('is the panel of the mockup: the queues, then the partitions', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Backlog', level: 2 })).toBeInTheDocument();

    // The provider the storage answer named, in the words a person uses for it
    expect(document.querySelector('.panel-h .chip')?.textContent).toBe('Azure Storage');

    expect(rows()).toEqual([
      ['workitems', '2'],
      ['control-00', '3'],
      ['control-01', '0'],
      ['control-02', '0'],
      ['control-03', '1'],
      ['partitions', '4 · all owned'],
    ]);
  });

  it('marks a work-item queue deeper than the threshold, and only then', async () => {
    const rendered = mount({
      storage: storageFixture({
        queues: [queue({ name: 'hub-workitems', kind: 'workitems', partition: null, approximateMessageCount: 1_240 })],
      }),
    });

    expect(rows()[0]).toEqual(['workitems', '1,240']);
    expect(document.querySelector('dl.kv .chip')?.textContent).toBe('deep');

    appOf(rendered).prefs.thresholds = { stuckMinutes: 60, pendingMinutes: 10, queueDepth: 2_000 };
    await tick();

    expect(document.querySelector('dl.kv .chip')).toBeNull();
  });

  it('leaves the work-item row out when the backend reported no such queue', () => {
    mount({ storage: storageFixture({ queues: [queue()] }) });

    expect(rows().map(([term]) => term)).toEqual(['control-00', 'partitions']);
  });

  it('says what a deep queue means, and where to look at it', async () => {
    const rendered = mount();

    expect(document.querySelector('.panel > .meta')?.textContent).toContain(BACKLOG_META);

    await screen.getByRole('button', { name: 'Storage' }).click();

    expect(appOf(rendered).router.current.name).toBe('storage');
  });
});
