// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { AuditQuery, Capabilities, StatsRequest } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { OVERVIEW_BINS, Overview, RECENT_ACTIVITY_ROWS } from './overview.svelte';
import { Prefs } from './prefs.svelte';
import { audit as auditFixture } from '../../../tests/unit/fixtures/audit';
import { partialStats, stats as statsFixture } from '../../../tests/unit/fixtures/stats';
import { storage as storageFixture } from '../../../tests/unit/fixtures/storage';

const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

const ALL: Partial<Capabilities> = { stats: true, storageHealth: true, audit: true };

function makeApp(capabilities: Partial<Capabilities>, path = '/DurableFunctionsHub') {
  window.history.replaceState({}, '', path);

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub', capabilities: capabilities as Capabilities });

  return app;
}

/** The three endpoints the screen reads, each answering with whatever the test gave it. */
function makeOverview(
  options: {
    capabilities?: Partial<Capabilities>;
    path?: string;
    stats?: () => Promise<unknown>;
    storage?: () => Promise<unknown>;
    audit?: () => Promise<unknown>;
  } = {},
) {
  const app = makeApp(options.capabilities ?? ALL, options.path);

  const statsRequests: StatsRequest[] = [];
  const auditRequests: AuditQuery[] = [];
  let storageCalls = 0;

  const endpoints = {
    stats: async (request: StatsRequest) => {
      statsRequests.push(request);

      return options.stats ? await options.stats() : statsFixture();
    },
    storage: async () => {
      storageCalls += 1;

      return options.storage ? await options.storage() : storageFixture();
    },
    audit: async (query: AuditQuery) => {
      auditRequests.push(query);

      return options.audit ? await options.audit() : auditFixture();
    },
  } as unknown as Endpoints;

  Object.defineProperty(app, 'endpoints', { value: endpoints, configurable: true });

  const overview = new Overview({ app, now: () => NOW });

  return { app, overview, statsRequests, auditRequests, storageCalls: () => storageCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Overview: what it asks for', () => {
  it('asks /stats for the shared range, 48 bins and the thresholds of the preferences', async () => {
    const { app, overview, statsRequests } = makeOverview();

    app.prefs.thresholds = { stuckMinutes: 90, pendingMinutes: 5, queueDepth: 500 };

    await overview.load();

    expect(statsRequests).toHaveLength(1);
    expect(statsRequests[0]).toEqual({
      from: '2026-09-03T14:00:00.000Z',
      to: '2026-09-04T14:00:00.000Z',
      bins: OVERVIEW_BINS,
      stuckAfterMinutes: 90,
      pendingAfterMinutes: 5,
    });
  });

  it('asks /audit for the same window and only the rows the panel shows', async () => {
    const { overview, auditRequests } = makeOverview();

    await overview.load();

    expect(auditRequests[0]).toEqual({
      from: '2026-09-03T14:00:00.000Z',
      to: '2026-09-04T14:00:00.000Z',
      top: RECENT_ACTIVITY_ROWS,
    });
  });

  it('calls none of the three without the capabilities that announce them', async () => {
    const { overview, statsRequests, auditRequests, storageCalls } = makeOverview({ capabilities: {} });

    await overview.load();

    expect(statsRequests).toHaveLength(0);
    expect(auditRequests).toHaveLength(0);
    expect(storageCalls()).toBe(0);
    expect(overview.supported).toBe(false);
  });

  it('loads stats without the two panels the backend does not offer', async () => {
    const { overview, statsRequests, auditRequests, storageCalls } = makeOverview({ capabilities: { stats: true } });

    await overview.load();

    expect(statsRequests).toHaveLength(1);
    expect(auditRequests).toHaveLength(0);
    expect(storageCalls()).toBe(0);
    expect(overview.storage).toBeNull();
    expect(overview.activity).toEqual([]);
  });
});

describe('Overview: what it loaded', () => {
  it('keeps the three answers apart', async () => {
    const { overview } = makeOverview();

    await overview.load();

    expect(overview.stats?.totals.all).toBe(1_229);
    expect(overview.storage?.taskHub.name).toBe('DurableFunctionsHub');
    expect(overview.activity).toHaveLength(4);
    expect(overview.loading).toBe(false);
    expect(overview.loadedAt).toBe('2026-09-04T14:00:00.000Z');
  });

  it('remembers the range the numbers are for', async () => {
    const { app, overview } = makeOverview();

    await overview.load();

    expect(overview.loadedRangeKey).toBe(JSON.stringify(app.timeRange));
  });

  it('says how much was scanned, and whether that was all of it', async () => {
    const full = makeOverview();

    await full.overview.load();

    expect(full.overview.scannedLabel).toBe('1,229 (full)');
    expect(full.overview.partial).toBe(false);

    const capped = makeOverview({ stats: async () => partialStats() });

    await capped.overview.load();

    expect(capped.overview.scannedLabel).toBe('20,000 (partial)');
    expect(capped.overview.partial).toBe(true);
  });

  it('is empty only when the range holds neither orchestrations nor entities', async () => {
    const empty = makeOverview({
      stats: async () => statsFixture({ totals: { all: 0, entities: 0 }, byName: [], entitiesByName: [] }),
    });

    await empty.overview.load();

    expect(empty.overview.isEmpty).toBe(true);

    const entitiesOnly = makeOverview({
      stats: async () => statsFixture({ totals: { all: 0, entities: 12 }, byName: [] }),
    });

    await entitiesOnly.overview.load();

    expect(entitiesOnly.overview.isEmpty).toBe(false);
  });

  it('is not empty before /stats has answered', () => {
    const { overview } = makeOverview();

    expect(overview.isEmpty).toBe(false);
    expect(overview.scannedLabel).toBe('—');
  });

  it('counts the age of the numbers off the app clock', async () => {
    const { app, overview } = makeOverview();

    await overview.load();

    app.now = NOW + 4_000;

    expect(overview.refreshedAgo).toBe('4 s ago');
  });
});

describe('Overview: when a part fails', () => {
  it('renders the stats it has when /storage answers 500, and toasts once', async () => {
    const { app, overview } = makeOverview({
      storage: async () => {
        throw new Error('Request failed with status code 500');
      },
    });

    await overview.load();

    expect(overview.stats?.totals.all).toBe(1_229);
    expect(overview.activity).toHaveLength(4);
    expect(overview.storage).toBeNull();
    expect(overview.error).toBeNull();
    expect(app.toast.current?.message).toContain('Storage health failed');

    // A second load of the same outage is not a second toast
    app.toast.dismiss();
    await overview.load();

    expect(app.toast.current).toBeNull();
  });

  it('says so again once the endpoint has recovered and failed anew', async () => {
    let fail = true;

    const { app, overview } = makeOverview({
      storage: async () => {
        if (fail) {
          throw new Error('boom');
        }

        return storageFixture();
      },
    });

    await overview.load();
    app.toast.dismiss();

    fail = false;
    await overview.load();

    expect(overview.storage).not.toBeNull();

    fail = true;
    await overview.load();

    expect(app.toast.current?.message).toContain('Storage health failed');
  });

  it('reports a failing /stats as the error of the screen itself, with a retry', async () => {
    const { app, overview } = makeOverview({
      stats: async () => {
        throw new Error('nope');
      },
    });

    await overview.load();

    expect(overview.stats).toBeNull();
    expect(overview.error).toBe('nope');
    expect(app.toast.current?.message).toContain('Statistics failed');
    expect(app.toast.current?.retry).toBeTypeOf('function');
  });

  it('drops the answer of a load that has been superseded', async () => {
    let release!: () => void;

    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });

    let first = true;

    const { overview } = makeOverview({
      stats: async () => {
        if (first) {
          first = false;
          await slow;

          return statsFixture({ scanned: 1 });
        }

        return statsFixture({ scanned: 2 });
      },
    });

    const stale = overview.load();

    await overview.load();
    release();
    await stale;

    expect(overview.stats?.scanned).toBe(2);
  });
});

describe('Overview: auto-refresh', () => {
  it('reloads on the interval of the preferences, and stops when asked', async () => {
    vi.useFakeTimers();

    const { app, overview, statsRequests } = makeOverview();

    app.prefs.autoRefresh = { instances: 5, instance: 0 };

    overview.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(11_000);

    expect(statsRequests.length).toBe(2);

    overview.stopAutoRefresh();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(statsRequests.length).toBe(2);
  });

  it('does not tick at all when the interval is off', async () => {
    vi.useFakeTimers();

    const { app, overview, statsRequests } = makeOverview();

    app.prefs.autoRefresh = { instances: 0, instance: 0 };

    overview.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(statsRequests).toHaveLength(0);
  });
});
