// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities, StatsRequest } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { Functions, isLayout } from './functions.svelte';
import { Prefs } from './prefs.svelte';
import { functionMap as functionMapFixture } from '../../../tests/unit/fixtures/function-map';
import { stats as statsFixture } from '../../../tests/unit/fixtures/stats';

const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

function makeFunctions(
  options: {
    path?: string;
    capabilities?: Partial<Capabilities>;
    functionGraph?: boolean;
    viewMode?: 0 | 1;
    stats?: () => Promise<unknown>;
    map?: () => Promise<unknown>;
  } = {},
) {
  window.history.replaceState({}, '', options.path ?? '/DurableFunctionsHub/functions');

  const app = new AppState({
    host: {
      ...host,
      functionGraphAvailable: options.functionGraph ?? true,
      viewMode: options.viewMode ?? 0,
    },
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({
    hubName: 'DurableFunctionsHub',
    capabilities: (options.capabilities ?? { stats: true }) as Capabilities,
  });

  const statsRequests: StatsRequest[] = [];
  let mapCalls = 0;

  Object.defineProperty(app, 'endpoints', {
    configurable: true,
    value: {
      stats: async (request: StatsRequest) => {
        statsRequests.push(request);

        return options.stats ? await options.stats() : statsFixture();
      },
      functionMap: async () => {
        mapCalls += 1;

        return options.map ? await options.map() : functionMapFixture();
      },
    } as unknown as Endpoints,
  });

  return { app, functions: new Functions({ app, now: () => NOW }), statsRequests, mapCalls: () => mapCalls };
}

describe('layout', () => {
  it('knows the three the segment offers, and nothing else', () => {
    expect(isLayout('table')).toBe(true);
    expect(isLayout('both')).toBe(true);
    expect(isLayout('graph')).toBe(true);
    expect(isLayout('sideways')).toBe(false);
    expect(isLayout(null)).toBe(false);
  });

  it('opens on both, and follows the URL when it says otherwise', () => {
    expect(makeFunctions().functions.layout).toBe('both');
    expect(makeFunctions({ path: '/DurableFunctionsHub/functions?layout=graph' }).functions.layout).toBe('graph');

    // A layout this screen does not have is not a layout
    expect(makeFunctions({ path: '/DurableFunctionsHub/functions?layout=sideways' }).functions.layout).toBe('both');
  });

  it('is only the half that exists when the other one does not', () => {
    const noGraph = makeFunctions({ functionGraph: false, path: '/DurableFunctionsHub/functions?layout=graph' });

    expect(noGraph.functions.layout).toBe('table');
    expect(noGraph.functions.showGraph).toBe(false);

    const noStats = makeFunctions({ capabilities: {}, path: '/DurableFunctionsHub/functions?layout=table' });

    expect(noStats.functions.layout).toBe('graph');
    expect(noStats.functions.showTable).toBe(false);
  });

  it('is the graph alone in the VS Code function-graph view, whatever the URL says', () => {
    const { functions } = makeFunctions({ viewMode: 1, path: '/DurableFunctionsHub/functions?layout=table' });

    expect(functions.layout).toBe('graph');
    expect(functions.showTable).toBe(false);
  });

  it('writes the chosen layout to the URL', () => {
    const { app, functions } = makeFunctions();

    functions.setLayout('table');

    expect(app.router.current.query.get('layout')).toBe('table');
    expect(functions.layout).toBe('table');
  });
});

describe('Functions: what it asks for', () => {
  it('asks /stats for the shared range and the map once', async () => {
    const { functions, statsRequests, mapCalls } = makeFunctions();

    await functions.load();

    expect(statsRequests).toEqual([{ from: '2026-09-03T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' }]);
    expect(mapCalls()).toBe(1);

    await functions.load();

    // The range moved the numbers; the map did not move at all
    expect(statsRequests).toHaveLength(2);
    expect(mapCalls()).toBe(1);
  });

  it('asks for neither when the backend and the host have neither', async () => {
    const { functions, statsRequests, mapCalls } = makeFunctions({ capabilities: {}, functionGraph: false });

    await functions.load();

    expect(statsRequests).toHaveLength(0);
    expect(mapCalls()).toBe(0);
    expect(functions.rows).toEqual([]);
    expect(functions.graph.nodes).toEqual([]);
  });

  it('keeps the graph when /stats fails, and says so once', async () => {
    const { app, functions } = makeFunctions({
      stats: async () => {
        throw new Error('nope');
      },
    });

    await functions.load();

    expect(functions.error).toBe('nope');
    expect(functions.graph.nodes.length).toBeGreaterThan(0);
    expect(app.toast.current?.message).toContain('Statistics failed');
  });

  it('keeps the table when the map fails', async () => {
    const { app, functions } = makeFunctions({
      map: async () => {
        throw new Error('no map');
      },
    });

    await functions.load();

    expect(functions.rows).toHaveLength(4);
    expect(functions.graph.nodes).toEqual([]);
    expect(app.toast.current?.message).toContain('Function map failed');
  });

  it('drops the answer of a load that has been superseded', async () => {
    let release!: () => void;

    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });

    let first = true;

    const { functions } = makeFunctions({
      stats: async () => {
        if (first) {
          first = false;
          await slow;

          return statsFixture({ scanned: 1 });
        }

        return statsFixture({ scanned: 2 });
      },
    });

    const stale = functions.load();

    await functions.load();
    release();
    await stale;

    expect(functions.scanned).toBe(2);
  });
});

describe('Functions: what the two halves agree on', () => {
  it('carries the selection in the URL', () => {
    const { app, functions } = makeFunctions();

    expect(functions.selected).toBeNull();

    functions.select('ProcessOrderOrchestrator');

    expect(app.router.current.query.get('selected')).toBe('ProcessOrderOrchestrator');
    expect(functions.selected).toBe('ProcessOrderOrchestrator');

    functions.select(null);

    expect(functions.selected).toBeNull();
  });

  it('relates a function to everything an edge joins it to, itself included', async () => {
    const { functions } = makeFunctions();

    await functions.load();

    expect(functions.related('ProcessOrderOrchestrator').sort()).toEqual(
      [
        'ProcessOrderOrchestrator',
        'StartOrder',
        'OnPaymentSettled',
        'ReserveInventory',
        'ChargePayment',
        'SendConfirmation',
        'NotifyCustomer',
        'Counter',
      ].sort(),
    );
  });

  it('relates nothing at all when nothing is selected', async () => {
    const { functions } = makeFunctions();

    await functions.load();

    expect(functions.related()).toEqual([]);
    expect(functions.activeEdges().size).toBe(0);
  });

  it('marks the edges that touch the selection', async () => {
    const { functions } = makeFunctions();

    await functions.load();

    const edges = functions.activeEdges('ReconcileLedgerOrchestrator');

    expect(edges.has('NightlyReconcile->ReconcileLedgerOrchestrator')).toBe(true);
    expect(edges.has('ReconcileLedgerOrchestrator->ExportReport')).toBe(true);
    expect(edges.has('StartOrder->ProcessOrderOrchestrator')).toBe(false);
  });

  it('counts what each orchestrator did, for the cards to carry', async () => {
    const { functions } = makeFunctions();

    await functions.load();

    expect(functions.metrics.ProcessOrderOrchestrator).toEqual({ completed: 1_080, running: 3, failed: 19 });
    expect(functions.metrics.NotifyCustomer).toEqual({ completed: 1_096, running: 0, failed: 0 });
    expect(functions.metrics.StartOrder).toBeUndefined();
  });

  it('says how much of the hub the numbers came from', async () => {
    const { functions } = makeFunctions();

    expect(functions.scanned).toBe(0);

    await functions.load();

    expect(functions.scanned).toBe(1_229);
    expect(functions.partial).toBe(false);
  });
});

describe('Functions: the range', () => {
  it('remembers which range the numbers are for', async () => {
    const { app, functions } = makeFunctions();

    await functions.load();

    expect(functions.loadedRangeKey).toBe(JSON.stringify(app.timeRange));

    app.setTimeRange({ preset: '7d' });

    expect(functions.loadedRangeKey).not.toBe(JSON.stringify(app.timeRange));
  });

  it('asks for whatever window the range resolves to', async () => {
    const { app, functions, statsRequests } = makeFunctions();

    app.setTimeRange({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' });

    await functions.load();

    expect(statsRequests[0]).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' });
  });
});

describe('Functions: loading', () => {
  it('is loading while it loads, and not afterwards', async () => {
    const pending = vi.fn();
    const { functions } = makeFunctions({
      stats: async () => {
        pending();

        return statsFixture();
      },
    });

    const load = functions.load();

    expect(functions.loading).toBe(true);

    await load;

    expect(functions.loading).toBe(false);
    expect(pending).toHaveBeenCalledOnce();
  });
});
