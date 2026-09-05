// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities, StorageQuery, StorageResponse } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { Prefs } from './prefs.svelte';
import { STORAGE_FAILED, Storage } from './storage.svelte';
import { storage as storageFixture } from '../../../tests/unit/fixtures/storage';

/** What the backend answers when nobody asked it to count rows. */
const uncounted = (overrides: Partial<StorageResponse> = {}) =>
  storageFixture({ counts: { instancesRows: null, historyRows: null, partial: false }, ...overrides });

function makeStorage(
  options: {
    capabilities?: Partial<Capabilities>;
    answer?: (query: StorageQuery) => Promise<StorageResponse>;
  } = {},
) {
  window.history.replaceState({}, '', '/DurableFunctionsHub/storage');

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({
    accountName: 'mystorageaccount',
    hubName: 'DurableFunctionsHub',
    capabilities: (options.capabilities ?? { storageHealth: true }) as Capabilities,
  });

  const queries: StorageQuery[] = [];

  app.endpoints.storage = async (query: StorageQuery = {}) => {
    queries.push(query);

    return options.answer ? await options.answer(query) : uncounted();
  };

  return { app, queries, storage: new Storage({ app }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Storage', () => {
  it('reports the hub, its queues and the leases of its partitions', async () => {
    const { storage } = makeStorage();

    await storage.load();

    expect(storage.taskHub).toMatchObject({ name: 'DurableFunctionsHub', partitionCount: 4 });
    expect(storage.accountName).toBe('dfmstorage001');
    expect(storage.tables?.instances).toBe('DurableFunctionsHubInstances');
    expect(storage.largeMessages?.container).toBe('durablefunctionshub-largemessages');
    expect(storage.error).toBeNull();
    expect(storage.loading).toBe(false);

    // The activities queue is the one the backlog is in, whichever order it was listed in
    expect(storage.workitems?.name).toBe('durablefunctionshub-workitems');
    expect(storage.workitems?.approximateMessageCount).toBe(2);

    // ...and the control queues are read in partition order
    expect(storage.controlQueues.map((queue) => queue.partition)).toEqual([0, 1, 2, 3]);

    expect(storage.ownedCount).toBe(4);
    expect(storage.partitionSource).toBe('table');
  });

  it('counts the unowned partitions as unowned', async () => {
    const { storage } = makeStorage({
      answer: async () =>
        uncounted({
          partitions: storageFixture().partitions.map((row, index) =>
            index < 2 ? { ...row, owner: null, ownedSince: null } : row,
          ),
        }),
    });

    await storage.load();

    expect(storage.ownedCount).toBe(2);
  });

  it('names the hub itself when the account has no name to give', async () => {
    const { app, storage } = makeStorage({ answer: async () => uncounted({ accountName: '' }) });

    await storage.load();

    // Azurite answers with an empty account; /about is the next thing that might know
    expect(storage.accountName).toBe('mystorageaccount');

    app.about = { ...app.about!, accountName: '' };

    expect(storage.accountName).toBe('');
  });

  it('does not count table rows unless it is asked to', async () => {
    const { storage, queries } = makeStorage();

    await storage.load();

    expect(queries).toEqual([{}]);
    expect(storage.counts).toBeNull();
  });

  it('counts them when the user asks, and keeps the answer through the next refresh', async () => {
    let counted = false;
    const { storage, queries } = makeStorage({
      answer: async (query) => {
        counted = !!query.counts;

        return counted ? storageFixture() : uncounted();
      },
    });

    await storage.load();
    await storage.countRows();

    expect(queries).toEqual([{}, { counts: true }]);
    expect(storage.counts).toEqual({ instancesRows: 1_229, historyRows: 38_104, partial: false });

    // The plain refresh brings no counts back, and the ones on screen are still the last true ones
    await storage.load();

    expect(queries).toEqual([{}, { counts: true }, {}]);
    expect(storage.counts).toEqual({ instancesRows: 1_229, historyRows: 38_104, partial: false });
    expect(storage.counting).toBe(false);
  });

  it('says the counts are a lower bound when the backend stopped at its cap', async () => {
    const { storage } = makeStorage({
      answer: async () => storageFixture({ counts: { instancesRows: 50_000, historyRows: null, partial: true } }),
    });

    await storage.countRows();

    expect(storage.counts).toMatchObject({ instancesRows: 50_000, partial: true });
  });

  it('asks nothing at all of a backend that does not serve /storage', async () => {
    const { storage, queries } = makeStorage({ capabilities: {} });

    await storage.load();

    expect(queries).toEqual([]);
    expect(storage.supported).toBe(false);
    expect(storage.response).toBeNull();
  });

  it('counts the seconds since the answer it is showing', async () => {
    const { app, storage } = makeStorage();

    expect(storage.refreshedAgo).toBe('—');

    await storage.load();

    app.now = Date.parse('2026-09-04T14:00:04Z');

    // generatedAt is when the backend answered, which is what "refreshed 4 s ago" means
    expect(storage.refreshedAgo).toBe('4 s ago');
  });

  it('keeps the answer of the last load when two are in flight', async () => {
    const pending: ((response: StorageResponse) => void)[] = [];
    const { storage } = makeStorage({
      answer: () => new Promise<StorageResponse>((resolveWith) => pending.push(resolveWith)),
    });

    const first = storage.load();
    const second = storage.load();

    pending[1](uncounted({ elapsedMs: 2 }));
    pending[0](uncounted({ elapsedMs: 99 }));

    await Promise.all([first, second]);

    expect(storage.response?.elapsedMs).toBe(2);
    expect(storage.loading).toBe(false);
  });

  it('says why it could not refresh, once per outage', async () => {
    let fail = true;
    const { app, storage } = makeStorage({
      answer: async () => {
        if (fail) {
          throw new Error('500 Internal Server Error');
        }

        return uncounted();
      },
    });

    await storage.load();

    expect(storage.error).toBe('500 Internal Server Error');
    expect(app.toast.current?.message).toBe(`${STORAGE_FAILED}. 500 Internal Server Error`);
    expect(app.toast.current?.retry).toBeTypeOf('function');

    app.toast.dismiss();
    await storage.load();

    // An endpoint that is down stays down; saying so every five seconds helps nobody
    expect(app.toast.current).toBeNull();

    fail = false;
    await storage.load();

    expect(storage.error).toBeNull();
  });

  it('refreshes on the interval the preferences hold, without ever counting rows', async () => {
    vi.useFakeTimers();

    const { app, storage, queries } = makeStorage();

    app.setAutoRefresh('instances', 5);
    storage.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(11_000);

    expect(queries).toEqual([{}, {}]);

    storage.stopAutoRefresh();
    await vi.advanceTimersByTimeAsync(11_000);

    expect(queries).toHaveLength(2);
  });

  it('does not start a timer for an interval of never', async () => {
    vi.useFakeTimers();

    const { storage, queries } = makeStorage();

    storage.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(queries).toHaveLength(0);
  });
});
