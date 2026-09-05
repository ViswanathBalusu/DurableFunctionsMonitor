// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities, StorageQuery, StorageResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Storage, { NO_STORAGE_TEXT, NO_STORAGE_TITLE, STORAGE_EXPLANATION } from './Storage.svelte';
import { storage as storageFixture } from '../../tests/unit/fixtures/storage';

/** What the backend answers when nobody asked it to count rows. */
const uncounted = (overrides: Partial<StorageResponse> = {}) =>
  storageFixture({ counts: { instancesRows: null, historyRows: null, partial: false }, ...overrides });

function mount(
  options: {
    response?: StorageResponse;
    answer?: (query: StorageQuery) => StorageResponse;
    capabilities?: Partial<Capabilities>;
  } = {},
) {
  const queries: StorageQuery[] = [];

  const rendered = render(ScreenHarness, {
    props: {
      screen: Storage,
      path: '/DurableFunctionsHub/storage',
      capabilities: options.capabilities ?? { storageHealth: true },
      endpoints: {
        storage: async (query: StorageQuery = {}) => {
          queries.push(query);

          return options.answer ? options.answer(query) : (options.response ?? uncounted());
        },
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app, queries };
}

function table(label: string): HTMLElement {
  return screen.getByRole('table', { name: label });
}

function rowsOf(label: string): string[][] {
  return Array.from(table(label).querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  );
}

/** Renders the screen and waits for the answer it draws itself from. */
async function mounted(options: Parameters<typeof mount>[0] = {}) {
  const rendered = mount(options);

  await waitFor(() => expect(rowsOf('Queues')).toHaveLength(5));

  return rendered;
}

describe('Storage: the title row', () => {
  it('says which account and hub this is, and how fresh the answer is', async () => {
    const { app } = await mounted();

    expect(document.querySelector('section.page[data-screen-label="Storage"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Storage', level: 1 })).toHaveClass('display');

    // ScreenStorage.dc.html L18-L21
    expect(document.querySelector('.ptitle .chip')?.textContent).toBe('Azure Storage');
    expect(document.querySelector('.ptitle .mono.muted')?.textContent).toBe('dfmstorage001 · DurableFunctionsHub');

    app.now = Date.parse('2026-09-04T14:00:09Z');

    await waitFor(() => expect(document.querySelector('.ptitle .fine.muted')?.textContent).toBe('refreshed 9 s ago'));

    expect(document.querySelector('.page > p')?.textContent).toBe(STORAGE_EXPLANATION);
  });

  it('asks again when the Refresh button is pressed', async () => {
    const { queries } = await mounted();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(queries).toHaveLength(2));

    // A refresh is the cheap call: it never asks for the row counts
    expect(queries).toEqual([{}, {}]);
  });

  it('names the hub alone when the account has no name to give', async () => {
    await mounted({ response: uncounted({ accountName: '' }) });

    // /about knows one in this harness; an account with no name anywhere leaves the hub by itself
    expect(document.querySelector('.ptitle .mono.muted')?.textContent).toBe('mystorageaccount · DurableFunctionsHub');
  });
});

describe('Storage: the task hub panel', () => {
  it('reports what taskhub.json says, and the tables the hub is made of', async () => {
    await mounted();

    const panel = document.querySelector('.two.storage .panel') as HTMLElement;

    expect(within(panel).getByRole('heading', { name: 'Task hub' })).toBeVisible();
    expect(panel.querySelector('.panel-h .fine.muted')?.textContent).toBe('taskhub.json');

    const values = Array.from(panel.querySelectorAll('dl.kv'))[0].querySelectorAll('dd');
    const text = (index: number) => values[index].textContent?.replace(/\s+/g, ' ').trim();

    expect(text(0)).toBe('DurableFunctionsHub');
    expect(text(1)).toBe('4');
    expect(text(2)).toBe('2026-08-12 10:41:00');

    // Nobody has counted the rows yet, so neither number pretends to be one
    expect(text(3)).toBe('— Count rows');
    expect(text(4)).toBe('—');

    expect(text(5)).toBe('durablefunctionshub-largemessages exists');
    expect(within(values[5]).getByText('exists')).toHaveClass('chip', 'st-completed', 'sm');
    expect(text(6)).toBe('12 · 4.5 MB');

    const tables = Array.from(panel.querySelectorAll('dl.kv'))[1].querySelectorAll('dd');

    expect(Array.from(tables).map((cell) => cell.textContent)).toEqual([
      'DurableFunctionsHubInstances',
      'DurableFunctionsHubHistory',
      'DurableFunctionsHubPartitions',
      'DurableFunctionsHubDfmAudit',
    ]);
  });

  it('counts the rows when the user asks, and keeps them through the next refresh', async () => {
    const { queries } = await mounted({ answer: (query) => (query.counts ? storageFixture() : uncounted()) });

    await fireEvent.click(screen.getByRole('button', { name: 'Count rows' }));

    await waitFor(() => expect(queries).toEqual([{}, { counts: true }]));

    const panel = document.querySelector('.two.storage .panel') as HTMLElement;
    const values = () => Array.from(panel.querySelectorAll('dl.kv')[0].querySelectorAll('dd'));

    await waitFor(() => expect(values()[3].textContent?.replace(/\s+/g, ' ').trim()).toBe('1,229 rows Count rows'));
    expect(values()[4].textContent).toBe('38,104 rows');

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(queries).toHaveLength(3));

    // The refresh brought no counts back, and the last true ones are still on screen
    expect(values()[4].textContent).toBe('38,104 rows');
  });

  it('says a capped count is a lower bound', async () => {
    await mounted({
      answer: (query) =>
        query.counts
          ? storageFixture({ counts: { instancesRows: 50_000, historyRows: 50_000, partial: true } })
          : uncounted(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Count rows' }));

    const panel = document.querySelector('.two.storage .panel') as HTMLElement;

    await waitFor(() =>
      expect(panel.querySelectorAll('dl.kv')[0].querySelectorAll('dd')[4].textContent).toBe('50,000 rows (partial)'),
    );
  });

  it('shows no blob count where the backend counts none', async () => {
    await mounted({
      response: uncounted({
        largeMessages: {
          container: 'durablefunctionshub-largemessages',
          exists: true,
          blobCount: null,
          totalBytes: null,
        },
      }),
    });

    const panel = document.querySelector('.two.storage .panel') as HTMLElement;

    expect(panel.querySelectorAll('dl.kv')[0].querySelectorAll('dd')[6].textContent?.trim()).toBe('—');
  });

  it('says a missing large-message container is missing', async () => {
    await mounted({
      response: uncounted({
        largeMessages: {
          container: 'durablefunctionshub-largemessages',
          exists: false,
          blobCount: null,
          totalBytes: null,
        },
      }),
    });

    const panel = document.querySelector('.two.storage .panel') as HTMLElement;
    const cell = panel.querySelectorAll('dl.kv')[0].querySelectorAll('dd')[5];

    expect(cell.textContent?.replace(/\s+/g, ' ').trim()).toBe('durablefunctionshub-largemessages missing');
    expect(within(cell as HTMLElement).queryByText('exists')).toBeNull();
  });
});

describe('Storage: the queues', () => {
  it('lists the activities queue first and says what each depth means', async () => {
    await mounted();

    expect(rowsOf('Queues')).toEqual([
      ['durablefunctionshub-workitems', '2', 'Activities waiting for a worker.'],
      ['durablefunctionshub-control-00', '3', 'Orchestrator messages for partition 00.'],
      ['durablefunctionshub-control-01', '0', 'Idle.'],
      ['durablefunctionshub-control-02', '0', 'Idle.'],
      ['durablefunctionshub-control-03', '1', 'Orchestrator messages for partition 03.'],
    ]);
  });

  it('marks a backlog over the threshold, and says what to do about it', async () => {
    const deep = uncounted({
      queues: storageFixture().queues.map((queue) =>
        queue.kind === 'workitems' ? { ...queue, approximateMessageCount: 1_240 } : queue,
      ),
    });

    const { app } = await mounted({ response: deep });

    // The threshold is the preference, at its default (E6-S3-T1)
    expect(app.prefs.thresholds.queueDepth).toBe(1_000);

    const workitems = table('Queues').querySelectorAll('tbody tr')[0];

    expect(within(workitems as HTMLElement).getByText('1,240')).toHaveClass('chip', 'st-running');
    expect(workitems.querySelectorAll('td')[2].textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Activities waiting for a worker. Above the 1,000 threshold: scale out or check for a stuck worker.',
    );
  });

  it('claims nothing about a depth the backend could not read', async () => {
    await mounted({
      response: uncounted({
        queues: storageFixture().queues.map((queue) => ({ ...queue, approximateMessageCount: null })),
      }),
    });

    expect(rowsOf('Queues')[2]).toEqual([
      'durablefunctionshub-control-01',
      '—',
      'Orchestrator messages for partition 01.',
    ]);
  });
});

describe('Storage: the partitions', () => {
  it('says who owns each control queue, and who is taking it over', async () => {
    await mounted();

    expect(rowsOf('Partitions')).toEqual([
      ['control-00', 'dfm-orders-prod_ffe2', '2026-09-04 09:14:02', 'no'],
      ['control-01', 'dfm-orders-prod_ffe2', '2026-09-04 09:14:02', 'no'],
      ['control-02', 'dfm-orders-prod_a10c', '2026-09-04 09:14:02', 'no'],
      ['control-03', 'dfm-orders-prod_a10c', '2026-09-04 09:14:02', 'yes → dfm-orders-prod_ffe2'],
    ]);

    const draining = table('Partitions').querySelectorAll('tbody tr')[3];

    expect(within(draining as HTMLElement).getByText('yes → dfm-orders-prod_ffe2')).toHaveClass(
      'chip',
      'st-suspended',
      'sm',
    );

    // Where the ownership came from, and the way back to the backlog it explains
    expect(table('Partitions').parentElement?.querySelector('.tfoot .meta')?.textContent).toBe(
      'Ownership from the DurableFunctionsHubPartitions table; lease blobs are the fallback on older hubs.',
    );
  });

  it('goes back to the Overview the backlog is on', async () => {
    const { app } = await mounted();

    await fireEvent.click(screen.getByRole('button', { name: 'Backlog on Overview' }));

    expect(app.router.current.name).toBe('overview');
  });

  it('reports an unowned partition as unowned rather than as idle', async () => {
    await mounted({
      response: uncounted({
        partitions: storageFixture().partitions.map((row) => ({
          ...row,
          owner: null,
          ownedSince: null,
          isDraining: null,
          nextOwner: null,
          source: 'none' as const,
        })),
      }),
    });

    expect(rowsOf('Partitions')[0]).toEqual(['control-00', '—', '—', '—']);
    expect(table('Partitions').parentElement?.querySelector('.tfoot .meta')?.textContent).toBe(
      'Ownership is in neither the partitions table nor the lease blobs of this hub.',
    );
  });

  it('says when the leases came from the blobs instead', async () => {
    await mounted({
      response: uncounted({
        partitions: storageFixture().partitions.map((row) => ({ ...row, source: 'lease-blob' as const })),
      }),
    });

    expect(table('Partitions').parentElement?.querySelector('.tfoot .meta')?.textContent).toBe(
      'Ownership from the lease blobs.',
    );
  });
});

describe('Storage: a backend that cannot report it', () => {
  it('says so instead of drawing an empty hub', async () => {
    const { queries } = mount({ capabilities: {} });

    const empty = await screen.findByRole('heading', { name: NO_STORAGE_TITLE });

    expect(empty.closest('.empty')?.querySelector('p')?.textContent).toBe(NO_STORAGE_TEXT);
    expect(screen.queryByRole('table', { name: 'Queues' })).toBeNull();
    expect(queries).toEqual([]);
  });
});
