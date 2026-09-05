// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities, OrchestrationStatus, OrchestrationsQuery, StatsResponse } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import type { ITypedLocalStorage } from '$lib/storage/typed-local-storage';
import { AppState } from './app.svelte';
import { DEFAULT_HIDDEN_COLUMNS, Instances, PAGE_SIZE, type InstancesViewState } from './instances.svelte';
import { Prefs } from './prefs.svelte';
import { instance, page } from '../../../tests/unit/fixtures/instances';
import { stats as statsFixture } from '../../../tests/unit/fixtures/stats';

const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

/** Records what was asked for, and answers with whatever the test queued. */
function fakeEndpoints(pages: OrchestrationStatus[][], stats?: () => Promise<StatsResponse>) {
  const queries: OrchestrationsQuery[] = [];
  let call = 0;

  const endpoints = {
    listOrchestrations: async (query: OrchestrationsQuery) => {
      queries.push(query);

      return pages[Math.min(call++, pages.length - 1)] ?? [];
    },
    stats: stats ?? (async () => statsFixture()),
  } as unknown as Endpoints;

  return { endpoints, queries, lastQuery: () => queries[queries.length - 1] };
}

function memoryStorage(initial: Partial<InstancesViewState> = {}): ITypedLocalStorage<InstancesViewState> {
  const values = new Map<string, string>(Object.entries(initial) as [string, string][]);

  return {
    getItem: (field) => values.get(field) ?? null,
    setItem: (field, value) => void values.set(field, value),
    setItems: (items) => {
      for (const { fieldName, value } of items) {
        if (value === null) {
          values.delete(fieldName);
        } else {
          values.set(fieldName, value);
        }
      }
    },
    removeItem: (field) => void values.delete(field),
  };
}

function makeApp(path = '/DurableFunctionsHub/instances', capabilities: Partial<Capabilities> = {}) {
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

function makeInstances(
  options: {
    path?: string;
    capabilities?: Partial<Capabilities>;
    pages?: OrchestrationStatus[][];
    storage?: Partial<InstancesViewState>;
    stats?: () => Promise<StatsResponse>;
  } = {},
) {
  const app = makeApp(options.path, options.capabilities);
  const fake = fakeEndpoints(options.pages ?? [page(3)], options.stats);

  Object.defineProperty(app, 'endpoints', { value: fake.endpoints, configurable: true });

  const instances = new Instances({ app, storage: memoryStorage(options.storage), now: () => NOW });

  return { app, instances, ...fake };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/DurableFunctionsHub/instances');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Instances: what it asks for', () => {
  it('asks for the first page with the shared range and every status', async () => {
    const { instances, lastQuery } = makeInstances();

    await instances.reload();

    expect(lastQuery()).toMatchObject({ top: PAGE_SIZE, skip: 0, orderBy: 'createdTime desc' });
    expect(lastQuery().filter).toContain("createdTime ge '2026-09-03T14:00:00.000Z'");
    expect(lastQuery().filter).toContain("runtimeStatus in ('Completed','Running','Failed'");
  });

  it('sends only the payload columns the backend can leave out', async () => {
    const { instances, lastQuery } = makeInstances();

    await instances.reload();

    // input and output are hidden by default; parentInstanceId and lastEvent mean nothing on the wire
    expect(lastQuery().hiddenColumns).toEqual(['input', 'output']);
  });

  it('sends the statuses and the orchestrator names that are selected', async () => {
    const { instances, lastQuery } = makeInstances();

    instances.setStatuses(['Running', 'Failed']);
    await instances.reload();

    expect(lastQuery().filter).toContain("runtimeStatus in ('Running','Failed')");

    instances.setNames(['ProcessOrderOrchestrator']);
    await instances.reload();

    expect(lastQuery().filter).toContain("name in ('ProcessOrderOrchestrator')");
  });

  it('lets the entities in through the status list', async () => {
    const { instances, lastQuery } = makeInstances();

    instances.setIncludeEntities(true);
    await instances.reload();

    expect(lastQuery().filter).toContain("'DurableEntities')");
  });

  it('appends the free filter only once it is applied', async () => {
    const { instances, lastQuery } = makeInstances();

    instances.value = 'order-';
    await instances.reload();
    expect(lastQuery().filter).not.toContain('startswith');

    instances.applyFilter('instanceId', 'StartsWith', 'order-');
    await instances.reload();
    expect(lastQuery().filter).toContain("startswith(instanceId, 'order-')");
  });

  it('sorts through the backend', async () => {
    const { instances, lastQuery } = makeInstances();

    instances.setOrder('lastUpdatedTime', 'asc');
    await instances.reload();

    expect(lastQuery().orderBy).toBe('lastUpdatedTime');
  });
});

describe('Instances: the URL', () => {
  it('mirrors every filter, so a link carries the view', () => {
    const { app, instances } = makeInstances();

    instances.setStatuses(['Running']);
    instances.setNames(['ProcessOrderOrchestrator']);
    instances.setIncludeEntities(true);
    instances.applyFilter('name', 'Contains', 'Order');
    instances.setOrder('name', 'asc');

    const query = app.router.current.query;

    expect(query.get('status')).toBe('Running');
    expect(query.get('name')).toBe('ProcessOrderOrchestrator');
    expect(query.get('entities')).toBe('1');
    expect(query.get('col')).toBe('name');
    expect(query.get('op')).toBe('Contains');
    expect(query.get('val')).toBe('Order');
    expect(query.get('orderby')).toBe('name');
    expect(query.get('dir')).toBe('asc');
  });

  it('takes what is empty back off the URL', () => {
    const { app, instances } = makeInstances();

    instances.setStatuses(['Running']);
    instances.clearAll();

    expect(app.router.current.query.get('status')).toBeNull();
    expect(app.router.current.query.get('entities')).toBeNull();
  });

  it('reads the filters back out of a link', () => {
    const { instances } = makeInstances({
      path: '/DurableFunctionsHub/instances?status=Running,Failed&name=A,B&col=name&op=Contains&val=Order&entities=1&view=timeline&orderby=name&dir=asc&hidden=input',
    });

    expect(instances.statuses).toEqual(['Running', 'Failed']);
    expect(instances.names).toEqual(['A', 'B']);
    expect(instances.column).toBe('name');
    expect(instances.op).toBe('Contains');
    expect(instances.applied).toBe('Order');
    expect(instances.includeEntities).toBe(true);
    expect(instances.view).toBe('timeline');
    expect(instances.orderBy).toBe('name');
    expect(instances.dir).toBe('asc');
    expect(instances.hiddenColumns).toEqual(['input']);
  });

  it('falls back to what was stored, then to the defaults', () => {
    const stored = makeInstances({ storage: { status: 'Failed', hidden: 'output' } });

    expect(stored.instances.statuses).toEqual(['Failed']);
    expect(stored.instances.hiddenColumns).toEqual(['output']);

    const bare = makeInstances();

    expect(bare.instances.statuses).toEqual([]);
    expect(bare.instances.hiddenColumns).toEqual(DEFAULT_HIDDEN_COLUMNS);
    expect(bare.instances.column).toBe('instanceId');
    expect(bare.instances.op).toBe('StartsWith');
  });

  it('takes a one-shot flag off the URL as it reads it', () => {
    const { app, instances } = makeInstances({ path: '/DurableFunctionsHub/instances?start=1' });

    expect(instances.takeFlag('start')).toBe(true);
    expect(app.router.current.query.get('start')).toBeNull();
    expect(instances.takeFlag('start')).toBe(false);
  });
});

describe('Instances: paging', () => {
  it('appends the next page and knows when the list is complete', async () => {
    const { instances, queries } = makeInstances({ pages: [page(PAGE_SIZE), page(7)] });

    await instances.reload();
    expect(instances.rows).toHaveLength(PAGE_SIZE);
    expect(instances.hasMore).toBe(true);

    await instances.loadMore();

    expect(queries[1].skip).toBe(PAGE_SIZE);
    expect(instances.rows).toHaveLength(PAGE_SIZE + 7);
    expect(instances.hasMore).toBe(false);
  });

  it('does not ask for more when there is no more', async () => {
    const { instances, queries } = makeInstances({ pages: [page(3)] });

    await instances.reload();
    await instances.loadMore();

    expect(queries).toHaveLength(1);
  });

  it('says how many are loaded, and how many match once the list is complete', async () => {
    const { instances } = makeInstances({ pages: [page(PAGE_SIZE), page(2)] });

    await instances.reload();
    expect(instances.matchLabel).toBe('50 loaded · Last 24 hours');

    await instances.loadMore();
    expect(instances.matchLabel).toBe('52 match · Last 24 hours');
  });

  it('applies only the answer to the request that is still current', async () => {
    const app = makeApp();
    const resolvers: ((rows: OrchestrationStatus[]) => void)[] = [];

    Object.defineProperty(app, 'endpoints', {
      value: {
        listOrchestrations: () => new Promise<OrchestrationStatus[]>((resolve) => resolvers.push(resolve)),
      } as unknown as Endpoints,
      configurable: true,
    });

    const instances = new Instances({ app, storage: memoryStorage(), now: () => NOW });

    const first = instances.reload();
    const second = instances.reload();

    // The first request answers last, with rows nobody is waiting for any more
    resolvers[1]([instance({ instanceId: 'from-the-second' })]);
    resolvers[0]([instance({ instanceId: 'from-the-first' })]);

    await Promise.all([first, second]);

    expect(instances.rows.map((row) => row.instanceId)).toEqual(['from-the-second']);
  });
});

describe('Instances: auto-refresh', () => {
  it('replaces the rows with page one on every tick', async () => {
    vi.useFakeTimers();

    const { app, instances, queries } = makeInstances({ pages: [page(PAGE_SIZE), page(PAGE_SIZE), page(3)] });

    await instances.reload();
    await instances.loadMore();
    expect(instances.rows).toHaveLength(PAGE_SIZE * 2);

    app.prefs.setAutoRefresh('instances', 5);
    instances.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(queries[2].skip).toBe(0);
    expect(instances.rows).toHaveLength(3);

    instances.stopAutoRefresh();
  });

  it('is off when the preference says never', () => {
    vi.useFakeTimers();

    const { instances, queries } = makeInstances();

    instances.startAutoRefresh();
    vi.advanceTimersByTime(60_000);

    expect(queries).toHaveLength(0);
  });

  it('stops on a failure, says so, and offers the retry', async () => {
    const app = makeApp();
    let fail = true;

    Object.defineProperty(app, 'endpoints', {
      value: {
        listOrchestrations: async () => {
          if (fail) {
            throw new Error('503 Service Unavailable');
          }
          return page(2);
        },
      } as unknown as Endpoints,
      configurable: true,
    });

    app.prefs.setAutoRefresh('instances', 5);

    const instances = new Instances({ app, storage: memoryStorage(), now: () => NOW });
    instances.startAutoRefresh();

    await instances.reload();

    expect(instances.error).toBe('503 Service Unavailable');
    expect(app.prefs.autoRefresh.instances).toBe(0);
    expect(app.toast.current?.message).toContain('503 Service Unavailable');

    fail = false;
    app.toast.current?.retry?.();

    await vi.waitFor(() => expect(instances.rows).toHaveLength(2));
    expect(instances.error).toBeNull();
  });
});

describe('Instances: the facets and the selection', () => {
  it('offers the orchestrator names /stats reports, once', async () => {
    const stats = vi.fn(async () => statsFixture());
    const { instances } = makeInstances({ capabilities: { stats: true }, stats });

    await instances.loadNameOptions();
    await instances.loadNameOptions();

    expect(stats).toHaveBeenCalledOnce();
    expect(instances.nameOptions.map((row) => row.name)).toContain('ProcessOrderOrchestrator');
  });

  it('offers no names at all without the capability, and does not ask', async () => {
    const stats = vi.fn(async () => statsFixture());
    const { instances } = makeInstances({ stats });

    await instances.loadNameOptions();

    expect(stats).not.toHaveBeenCalled();
    expect(instances.nameOptions).toEqual([]);
  });

  it('selects every loaded row for the batch-ops command', async () => {
    const { instances } = makeInstances({ pages: [page(4)] });

    await instances.reload();
    instances.selectAllLoaded();

    expect(instances.selection.count).toBe(4);
    expect(instances.selection.nameOf(instances.rows[0].instanceId)).toBe('ProcessOrderOrchestrator');
  });

  it('shows a column that is being filtered on even when it is hidden', () => {
    const { instances } = makeInstances();

    expect(instances.effectiveHiddenColumns).toContain('lastEvent');

    instances.applyFilter('lastEvent', 'Equals', 'TaskCompleted');

    expect(instances.effectiveHiddenColumns).not.toContain('lastEvent');
  });

  it('knows when anything is filtering the list', () => {
    const { instances } = makeInstances();

    expect(instances.hasFilters).toBe(false);

    instances.setStatuses(['Failed']);
    expect(instances.hasFilters).toBe(true);

    instances.clearAll();
    expect(instances.hasFilters).toBe(false);
  });
});
