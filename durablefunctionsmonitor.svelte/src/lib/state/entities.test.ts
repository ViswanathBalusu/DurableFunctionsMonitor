// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type {
  Capabilities,
  EntitiesQuery,
  EntitiesResponse,
  OrchestrationStatus,
  OrchestrationsQuery,
  StatsRequest,
  StatsResponse,
} from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { ENTITIES_FAILED, Entities, entityState, toEntityRow } from './entities.svelte';
import { Prefs } from './prefs.svelte';
import { entities as entitiesFixture, entityRow } from '../../../tests/unit/fixtures/entities';
import { entity } from '../../../tests/unit/fixtures/instances';
import { stats as statsFixture } from '../../../tests/unit/fixtures/stats';

const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

/** The default window, resolved against that clock. */
const LAST_7_DAYS = { from: '2026-08-28T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' };

interface Options {
  capabilities?: Partial<Capabilities>;
  path?: string;
  answer?: () => Promise<EntitiesResponse>;
  rows?: () => Promise<OrchestrationStatus[]>;
  stats?: () => Promise<StatsResponse>;
}

function makeEntities(options: Options = {}) {
  window.history.replaceState({}, '', options.path ?? '/DurableFunctionsHub/entities');

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({
    hubName: 'DurableFunctionsHub',
    capabilities: (options.capabilities ?? { entities: true, stats: true }) as Capabilities,
  });

  const queries: EntitiesQuery[] = [];
  const lists: OrchestrationsQuery[] = [];
  const statsQueries: StatsRequest[] = [];

  app.endpoints.entities = async (query: EntitiesQuery = {}) => {
    queries.push(query);

    return options.answer ? await options.answer() : entitiesFixture();
  };

  app.endpoints.listOrchestrations = async (query: OrchestrationsQuery) => {
    lists.push(query);

    return options.rows ? await options.rows() : [];
  };

  app.endpoints.stats = async (query: StatsRequest) => {
    statsQueries.push(query);

    return options.stats ? await options.stats() : statsFixture();
  };

  return { app, queries, lists, statsQueries, entities: new Entities({ app, now: () => NOW }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Entities', () => {
  it('asks /entities for the window in the URL and shows what came back', async () => {
    const { entities, queries } = makeEntities();

    await entities.reload();

    expect(queries).toEqual([
      {
        name: undefined,
        keyPrefix: undefined,
        updatedFrom: LAST_7_DAYS.from,
        updatedTo: LAST_7_DAYS.to,
        top: 50,
        skip: 0,
      },
    ]);

    // Newest first, which is the order the table's header claims
    expect(entities.rows.map((row) => row.key)).toEqual(['warehouse-07', 'warehouse-12', 'main']);
    expect(entities.rows[0].state).toEqual({ value: 1284, lastSku: 'SKU-4471' });
    expect(entities.rows[0].stateSummary).toBe('{"value":1284,"lastSku":"SKU-4471"}');
    expect(entities.hasMore).toBe(false);
    expect(entities.loading).toBe(false);
    expect(entities.error).toBeNull();
  });

  it('carries the filters of the URL into the query', async () => {
    const { entities, queries } = makeEntities({
      path: '/DurableFunctionsHub/entities?name=counter&key=warehouse-0&updated=1h',
    });

    expect(entities.name).toBe('counter');
    expect(entities.keyPrefix).toBe('warehouse-0');
    expect(entities.window).toBe('1h');
    expect(entities.hasFilters).toBe(true);

    await entities.reload();

    expect(queries[0]).toEqual({
      name: 'counter',
      keyPrefix: 'warehouse-0',
      updatedFrom: '2026-09-04T13:00:00.000Z',
      updatedTo: '2026-09-04T14:00:00.000Z',
      top: 50,
      skip: 0,
    });
  });

  it('asks for every entity there has ever been when the window is Any time', async () => {
    const { entities, queries } = makeEntities({ path: '/DurableFunctionsHub/entities?updated=any' });

    await entities.reload();

    // No bound at all, rather than a very old one
    expect(queries[0].updatedFrom).toBeUndefined();
    expect(queries[0].updatedTo).toBeUndefined();
    expect(entities.updatedRange).toBeNull();
  });

  it('writes a filter to the URL, and takes the default window off it', () => {
    const { app, entities } = makeEntities();

    entities.setName('counter');
    entities.setKeyPrefix('warehouse-0');
    entities.setWindow('24h');

    expect(app.router.current.query.get('name')).toBe('counter');
    expect(app.router.current.query.get('key')).toBe('warehouse-0');
    expect(app.router.current.query.get('updated')).toBe('24h');

    entities.setName(null);
    entities.setKeyPrefix('');
    entities.setWindow('7d');

    expect(app.router.current.query.get('name')).toBeNull();
    expect(app.router.current.query.get('key')).toBeNull();
    expect(app.router.current.query.get('updated')).toBeNull();
    expect(entities.window).toBe('7d');
  });

  it('reads the next page from where the last one ended', async () => {
    const pages = [
      entitiesFixture({ entities: [entityRow()], hasMore: true }),
      entitiesFixture({
        entities: [entityRow({ instanceId: '@counter@warehouse-99', key: 'warehouse-99' })],
        hasMore: false,
      }),
    ];
    let next = 0;
    const { entities, queries } = makeEntities({ answer: async () => pages[next++] });

    await entities.reload();

    expect(entities.hasMore).toBe(true);

    await entities.loadMore();

    expect(queries.map((query) => query.skip)).toEqual([0, 1]);
    expect(entities.rows).toHaveLength(2);
    expect(entities.hasMore).toBe(false);

    // Nothing more to ask for
    await entities.loadMore();

    expect(queries).toHaveLength(2);
  });

  describe('without the entities capability', () => {
    it('asks /orchestrations for the entities of the window', async () => {
      const { entities, lists } = makeEntities({
        capabilities: { stats: true },
        rows: async () => [entity()],
      });

      expect(entities.supported).toBe(false);

      await entities.reload();

      expect(lists).toHaveLength(1);
      expect(lists[0].filter).toBe(
        `createdTime ge '${LAST_7_DAYS.from}' and createdTime le '${LAST_7_DAYS.to}'` +
          ` and runtimeStatus in ('DurableEntities')`,
      );
      expect(lists[0].orderBy).toBe('lastUpdatedTime desc');
      expect(lists[0].top).toBe(50);

      // The input is where the state is, so it is the one payload that must not be left out
      expect(lists[0].hiddenColumns).not.toContain('input');
    });

    it('asks for entities and nothing else when the window is Any time', async () => {
      const { entities, lists } = makeEntities({
        capabilities: {},
        path: '/DurableFunctionsHub/entities?updated=any',
        rows: async () => [],
      });

      await entities.reload();

      expect(lists[0].filter).toBe(`runtimeStatus in ('DurableEntities')`);
    });

    it('maps the framework envelope to the entity state', async () => {
      const { entities } = makeEntities({
        capabilities: {},
        rows: async () => [entity({ input: '{"exists":true,"state":"{\\"value\\":1284}"}' })],
      });

      await entities.reload();

      expect(entities.rows).toHaveLength(1);
      expect(entities.rows[0]).toMatchObject({
        instanceId: '@counter@warehouse-07',
        entityName: 'counter',
        key: 'warehouse-07',
        state: { value: 1284 },
        stateSummary: '{"value":1284}',
      });
    });

    it('shows no state at all when the backend sends none', async () => {
      const { entities } = makeEntities({ capabilities: {}, rows: async () => [entity({ input: null })] });

      await entities.reload();

      // What the isolated backend really answers: it lists entities with IncludeState = false
      expect(entities.rows[0]).toMatchObject({ state: null, stateSummary: null, stateError: null });
    });

    it('pushes a name down into the filter, key prefix and all', async () => {
      const { entities, lists } = makeEntities({
        capabilities: {},
        path: '/DurableFunctionsHub/entities?name=counter&key=warehouse-0',
        rows: async () => [entity()],
      });

      await entities.reload();

      // An entity id is `@name@key`, so this is a prefix of the id - values encoded as React encoded them
      expect(lists[0].filter).toContain(`startswith(instanceId, '%40counter%40warehouse-0')`);
      expect(entities.rows).toHaveLength(1);
    });

    it('applies a key prefix on its own to the rows that came back', async () => {
      const rows = [
        entity(),
        entity({ instanceId: '@counter@warehouse-12', entityId: { name: 'counter', key: 'warehouse-12' } }),
      ];
      const { entities, lists } = makeEntities({
        capabilities: {},
        path: '/DurableFunctionsHub/entities?key=warehouse-1',
        rows: async () => rows,
      });

      await entities.reload();

      // Nothing can be said about the middle of a string in OData, so the filter says nothing about it
      expect(lists[0].filter).not.toContain('startswith');
      expect(entities.rows.map((row) => row.key)).toEqual(['warehouse-12']);
    });

    it('counts what the backend sent, not what survived the key prefix, when paging', async () => {
      const page = Array.from({ length: 50 }, (_, index) =>
        entity({
          instanceId: `@counter@warehouse-${index}`,
          entityId: { name: 'counter', key: `warehouse-${index}` },
        }),
      );
      const { entities, lists } = makeEntities({
        capabilities: {},
        path: '/DurableFunctionsHub/entities?key=warehouse-4',
        rows: async () => page,
      });

      await entities.reload();

      // warehouse-4, -40..-49: eleven of the fifty
      expect(entities.rows).toHaveLength(11);
      expect(entities.hasMore).toBe(true);

      await entities.loadMore();

      expect(lists.map((list) => list.skip)).toEqual([0, 50]);
    });
  });

  describe('facets', () => {
    it('offers every entity name of the window, with a count each', async () => {
      const { entities, statsQueries } = makeEntities({
        stats: async () =>
          statsFixture({
            entitiesByName: [
              { name: 'counter', count: 204 },
              { name: 'cartaggregate', count: 8 },
            ],
            totals: { ...statsFixture().totals, entities: 212 },
          }),
      });

      await entities.loadFacets();

      expect(statsQueries).toEqual([LAST_7_DAYS]);
      expect(entities.names).toEqual([
        { name: 'counter', count: 204 },
        { name: 'cartaggregate', count: 8 },
      ]);
      expect(entities.total).toBe(212);
      expect(entities.summary).toBe('212 durable entities · 2 entity names');
    });

    it('counts over the longest window /stats takes when the filter asks for any time', async () => {
      const { entities, statsQueries } = makeEntities({ path: '/DurableFunctionsHub/entities?updated=any' });

      await entities.loadFacets();

      // 92 days, which is what the endpoint answers at all
      expect(statsQueries).toEqual([{ from: '2026-06-04T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' }]);
    });

    it('says the count is a lower bound when /stats stopped at its cap', async () => {
      const { entities } = makeEntities({
        stats: async () => statsFixture({ partial: true, totals: { ...statsFixture().totals, entities: 5_000 } }),
      });

      await entities.loadFacets();

      expect(entities.summary).toBe('5,000+ durable entities · 1 entity name');
    });

    it('asks once for as long as the window holds', async () => {
      const { entities, statsQueries } = makeEntities();

      await entities.loadFacets();
      await entities.loadFacets();

      expect(statsQueries).toHaveLength(1);

      entities.setWindow('24h');
      await entities.loadFacets();

      // A different window is a different question
      expect(statsQueries).toHaveLength(2);
    });

    it('names what is on screen when there is no /stats to ask', async () => {
      const { entities, statsQueries } = makeEntities({ capabilities: { entities: true } });

      await entities.reload();
      await entities.loadFacets();

      expect(statsQueries).toEqual([]);
      expect(entities.names).toEqual([
        { name: 'counter', count: 2 },
        { name: 'ledger', count: 1 },
      ]);

      // The screen counts what it loaded, and says so is all it can say
      expect(entities.total).toBeNull();
      expect(entities.summary).toBe('3 durable entities · 2 entity names');
    });

    it('admits there is more than it loaded', async () => {
      const { entities } = makeEntities({
        capabilities: { entities: true },
        answer: async () => entitiesFixture({ hasMore: true }),
      });

      await entities.reload();

      expect(entities.summary).toBe('3+ durable entities · 2 entity names');
    });

    it('does not toast a facet it could not fill', async () => {
      const { app, entities } = makeEntities({
        stats: async () => {
          throw new Error('500 Internal Server Error');
        },
      });

      await entities.loadFacets();

      expect(app.toast.current).toBeNull();
      expect(entities.total).toBeNull();
    });
  });

  it('knows the difference between not loaded and nothing matching', async () => {
    const { entities } = makeEntities({ answer: async () => entitiesFixture({ entities: [] }) });

    await entities.reload();

    expect(entities.isEmpty).toBe(true);
    expect(entities.rows).toEqual([]);
  });

  it('keeps the answer of the last load when two are in flight', async () => {
    const pending: ((response: EntitiesResponse) => void)[] = [];
    const { entities } = makeEntities({
      answer: () => new Promise<EntitiesResponse>((resolveWith) => pending.push(resolveWith)),
    });

    const first = entities.reload();
    const second = entities.reload();

    pending[1](entitiesFixture({ entities: [entityRow({ key: 'the-one-asked-for-last' })] }));
    pending[0](entitiesFixture());

    await Promise.all([first, second]);

    expect(entities.rows.map((row) => row.key)).toEqual(['the-one-asked-for-last']);
    expect(entities.loading).toBe(false);
  });

  it('says why it could not refresh, once per outage', async () => {
    let fail = true;
    const { app, entities } = makeEntities({
      answer: async () => {
        if (fail) {
          throw new Error('500 Internal Server Error');
        }

        return entitiesFixture();
      },
    });

    await entities.reload();

    expect(entities.error).toBe('500 Internal Server Error');
    expect(app.toast.current?.message).toBe(`${ENTITIES_FAILED}. 500 Internal Server Error`);

    app.toast.dismiss();
    await entities.reload();

    expect(app.toast.current).toBeNull();

    fail = false;
    await entities.reload();

    expect(entities.error).toBeNull();
  });

  it('refreshes on the interval the preferences hold, until it is told to stop', async () => {
    vi.useFakeTimers();

    const { app, entities, queries } = makeEntities();

    app.setAutoRefresh('instances', 5);
    entities.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(11_000);

    expect(queries).toHaveLength(2);

    entities.stopAutoRefresh();
    await vi.advanceTimersByTimeAsync(11_000);

    expect(queries).toHaveLength(2);
  });

  it('does not start a timer for an interval of never', async () => {
    vi.useFakeTimers();

    const { entities, queries } = makeEntities();

    entities.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(queries).toHaveLength(0);
  });
});

describe('entityState', () => {
  it('takes the state out of the framework envelope', () => {
    expect(entityState('{"exists":true,"state":"{\\"value\\":1284}"}')).toEqual({ value: 1284 });
    expect(entityState({ exists: true, state: { value: 1284 } })).toEqual({ value: 1284 });
    expect(entityState({ exists: false, state: null })).toBeNull();
  });

  it('leaves everything else exactly as it is', () => {
    // An entity whose own state has a `state` field keeps it: only the envelope is an envelope
    expect(entityState({ state: 'open', since: '2026-09-04T09:12:41Z' })).toEqual({
      state: 'open',
      since: '2026-09-04T09:12:41Z',
    });

    expect(entityState({ value: 1284 })).toEqual({ value: 1284 });
    expect(entityState('not json at all')).toBe('not json at all');
    expect(entityState(null)).toBeNull();
    expect(entityState(undefined)).toBeNull();
  });
});

describe('toEntityRow', () => {
  it('reads the name and the key the backend already split out', () => {
    expect(toEntityRow(entity())).toMatchObject({
      instanceId: '@counter@warehouse-07',
      entityName: 'counter',
      key: 'warehouse-07',
      lastUpdatedTime: '2026-09-04T14:01:47Z',
      runtimeStatus: 'Pending',
      stateError: null,
    });
  });
});
