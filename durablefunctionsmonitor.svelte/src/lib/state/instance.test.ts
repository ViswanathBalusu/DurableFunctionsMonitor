// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type {
  Capabilities,
  FunctionMapResponse,
  HistoryEvent,
  HistoryQuery,
  OrchestrationDetails,
} from '$lib/api/types';
import { host, type Host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { InstanceState, clearFunctionMapCache, customTab } from './instance.svelte';
import { HISTORY_PAGE_SIZE } from './instance-history.svelte';
import { Prefs } from './prefs.svelte';
import { children as childrenFixture } from '../../../tests/unit/fixtures/children';
import { childDetails, details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture, historyEvent } from '../../../tests/unit/fixtures/history';
import { spansResponse } from '../../../tests/unit/fixtures/spans';

const INSTANCE_ID = 'order-2026-09-04-000913';

const ENTITY_ID = '@counter@warehouse-07';

/** The workspace clock, so a running duration is a number the test can name. */
const NOW = new Date('2026-09-04T14:03:00.000Z').getTime();

function entityDetails(): OrchestrationDetails {
  return detailsFixture({
    instanceId: ENTITY_ID,
    name: 'Counter',
    entityType: 'DurableEntity',
    entityId: { name: 'counter', key: 'warehouse-07' },
    runtimeStatus: 'Pending',
    input: { value: 1284 },
  });
}

const functionMap: FunctionMapResponse = {
  functions: {
    ProcessOrderOrchestrator: { bindings: [{ type: 'orchestrationTrigger', direction: 'in' }] },
    counter: { bindings: [{ type: 'entityTrigger', direction: 'in' }] },
  },
  proxies: {},
};

interface Calls {
  history: HistoryQuery[];
  actions: { action: string; body?: unknown }[];
  raised: { name: string; data: unknown }[];
  customStatus: unknown[];
  restarts: boolean[];
  purges: number;
  functionMaps: number;
  spans: number;
  children: number;
}

function makeInstance(
  options: {
    id?: string;
    query?: string;
    details?: OrchestrationDetails | (() => Promise<OrchestrationDetails>);
    history?: HistoryEvent[] | ((query: HistoryQuery) => HistoryEvent[]);
    capabilities?: Partial<Capabilities>;
    functionGraph?: boolean;
    fail?: (action: string) => Error | null;
  } = {},
) {
  const id = options.id ?? INSTANCE_ID;

  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${encodeURIComponent(id)}${options.query ?? ''}`);

  const calls: Calls = {
    history: [],
    actions: [],
    raised: [],
    customStatus: [],
    restarts: [],
    purges: 0,
    functionMaps: 0,
    spans: 0,
    children: 0,
  };

  const fail = options.fail ?? (() => null);
  const raise = (action: string) => {
    const error = fail(action);

    if (error) {
      throw error;
    }
  };

  const endpoints = {
    getOrchestration: async () => {
      raise('getOrchestration');

      const value = options.details ?? detailsFixture();

      return typeof value === 'function' ? await value() : value;
    },
    getHistory: async (_instanceId: string, query: HistoryQuery) => {
      raise('getHistory');
      calls.history.push(query);

      const rows = options.history ?? historyFixture;

      return { history: typeof rows === 'function' ? rows(query) : rows };
    },
    functionMap: async () => {
      calls.functionMaps += 1;
      return functionMap;
    },
    postAction: async (_instanceId: string, action: string, body?: unknown) => {
      raise(action);
      calls.actions.push({ action, body });
    },
    raiseEvent: async (_instanceId: string, name: string, data: unknown) => {
      raise('raise-event');
      calls.raised.push({ name, data });
    },
    setCustomStatus: async (_instanceId: string, value: unknown) => {
      raise('set-custom-status');
      calls.customStatus.push(value);
    },
    restart: async (_instanceId: string, withNewId: boolean) => {
      raise('restart');
      calls.restarts.push(withNewId);
    },
    purge: async () => {
      raise('purge');
      calls.purges += 1;
    },
    spans: async () => {
      raise('spans');
      calls.spans += 1;

      return spansResponse();
    },
    children: async () => {
      raise('children');
      calls.children += 1;

      return childrenFixture();
    },
  } as unknown as Endpoints;

  const instanceHost: Host = options.functionGraph ? { ...host, functionGraphAvailable: true } : host;

  const app = new AppState({
    host: instanceHost,
    client: {} as BackendClient,
    endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({
    hubName: 'DurableFunctionsHub',
    capabilities: (options.capabilities ?? {}) as Capabilities,
  });
  app.now = NOW;

  return { app, calls, instance: new InstanceState({ app, instanceId: id }) };
}

beforeEach(() => {
  clearFunctionMapCache();
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InstanceState: the details', () => {
  it('loads the details and says what the instance is', async () => {
    const { instance } = makeInstance();

    await instance.loadDetails();

    expect(instance.details?.instanceId).toBe(INSTANCE_ID);
    expect(instance.isEntity).toBe(false);
    expect(instance.functionName).toBe('ProcessOrderOrchestrator');
    expect(instance.status).toBe('Running');
  });

  it('does not ask for a function map when the host publishes no graph', async () => {
    const { instance, calls } = makeInstance();

    await instance.loadDetails();

    expect(calls.functionMaps).toBe(0);
    expect(instance.functionMap).toBeNull();

    // No map, so nothing to match against - but the Graph tab is still there, drawn from the
    // instance's own history instead
    expect(instance.isOnFunctionMap).toBe(false);
    expect(instance.hasGraph).toBe(true);
  });

  it('asks for the function map once per hub, however many instances are opened', async () => {
    const first = makeInstance({ functionGraph: true });

    await first.instance.loadDetails();

    const second = makeInstance({ functionGraph: true, details: childDetails() });

    await second.instance.loadDetails();

    expect(first.calls.functionMaps + second.calls.functionMaps).toBe(1);
    expect(second.instance.functionMap).toEqual(functionMap);
  });

  it('says Load failed, stops the auto-refresh and keeps the screen usable', async () => {
    const { app, instance } = makeInstance({
      fail: (action) => (action === 'getOrchestration' ? new Error('404') : null),
    });

    app.prefs.setAutoRefresh('instance', 5);
    instance.startAutoRefresh();

    await instance.loadDetails();

    expect(instance.details).toBeNull();
    expect(instance.error).toBe('404');
    expect(app.toast.current?.message).toBe('Load failed. 404');
    expect(app.prefs.autoRefresh.instance).toBe(0);
  });
});

describe('InstanceState: the tabs', () => {
  it('offers the orchestration tabs of the mockup, and no Timeline without /spans', async () => {
    const { instance } = makeInstance();

    await instance.loadDetails();

    // Graph without a published map is the history-derived one (E5-S6 follow-up)
    expect(instance.tabs).toEqual(['history', 'inputs', 'sequence', 'graph', 'raw', customTab('Order summary')]);
    expect(instance.tab).toBe('history');
  });

  it('opens on Timeline where the backend has spans', async () => {
    const { instance } = makeInstance({ capabilities: { spans: true } });

    await instance.loadDetails();

    expect(instance.tabs[0]).toBe('timeline');
    expect(instance.defaultTab).toBe('timeline');
    expect(instance.tab).toBe('timeline');
  });

  it('gives an entity History, Raw and its custom tabs, and nothing else', async () => {
    const { instance } = makeInstance({ id: ENTITY_ID, details: entityDetails(), capabilities: { spans: true } });

    await instance.loadDetails();

    expect(instance.isEntity).toBe(true);
    expect(instance.functionName).toBe('counter');
    expect(instance.tabs).toEqual(['history', 'raw', customTab('Order summary')]);
  });

  it('offers Graph when the instance is on the function map, matching its name case-insensitively', async () => {
    const orchestration = makeInstance({ functionGraph: true });

    await orchestration.instance.loadDetails();

    expect(orchestration.instance.tabs).toContain('graph');
    expect(orchestration.instance.isOnFunctionMap).toBe(true);

    // The map lowers entity names, which is why React matched them case-insensitively
    const entity = makeInstance({ id: ENTITY_ID, details: entityDetails(), functionGraph: true });

    await entity.instance.loadDetails();

    expect(entity.instance.isOnFunctionMap).toBe(true);
    expect(entity.instance.hasGraph).toBe(true);

    // A function nobody published is not on the map; the tab is still offered, and the tab draws
    // the history-derived graph rather than the hub's
    const unknown = makeInstance({ functionGraph: true, details: detailsFixture({ name: 'SomethingElse' }) });

    await unknown.instance.loadDetails();

    expect(unknown.instance.isOnFunctionMap).toBe(false);
    expect(unknown.instance.tabs).toContain('graph');
  });

  it('gives an entity no Graph tab, with a map or without one', async () => {
    // An entity is signalled, calls nothing and has no history of calls to derive a graph from
    const { instance } = makeInstance({ id: ENTITY_ID, details: entityDetails() });

    await instance.loadDetails();

    expect(instance.isOnFunctionMap).toBe(false);
    expect(instance.hasGraph).toBe(false);
    expect(instance.tabs).not.toContain('graph');
  });

  it('takes the tab off the URL, and falls back when it is one this instance has not got', async () => {
    const { instance } = makeInstance({ query: '?tab=raw' });

    await instance.loadDetails();

    expect(instance.tab).toBe('raw');

    // Summary is the column on a wide screen and a tab on a narrow one: always a legal value
    expect(instance.isTabAvailable('summary')).toBe(true);

    instance.setTab('summary');

    expect(new URLSearchParams(window.location.search).get('tab')).toBe('summary');
    expect(instance.tab).toBe('summary');

    instance.setTab('timeline');

    expect(instance.tab).toBe('history');
  });
});

describe('InstanceState: the clock', () => {
  it('counts a running instance against the clock and a finished one against its own end', async () => {
    const running = makeInstance();

    await running.instance.loadDetails();

    // created 14:02:11, clock 14:03:00
    expect(running.instance.liveDuration).toBe(49_000);

    running.app.now = NOW + 1_000;
    expect(running.instance.liveDuration).toBe(50_000);

    const finished = makeInstance({
      details: detailsFixture({ runtimeStatus: 'Completed', lastUpdatedTime: '2026-09-04T14:02:58Z' }),
    });

    await finished.instance.loadDetails();

    expect(finished.instance.liveDuration).toBe(47_000);

    finished.app.now = NOW + 60_000;
    expect(finished.instance.liveDuration).toBe(47_000);
  });

  it('has no duration before the details arrive', () => {
    const { instance } = makeInstance();

    expect(instance.liveDuration).toBeNull();
  });
});

describe('InstanceHistoryState', () => {
  it('asks for a page of 200 and knows a short page is the last one', async () => {
    const { instance, calls } = makeInstance();

    await instance.history.load();

    expect(calls.history[0]).toEqual({ top: HISTORY_PAGE_SIZE, skip: 0, filter: '' });
    expect(instance.history.rows).toHaveLength(historyFixture.length);
    expect(instance.history.hasMore).toBe(false);
  });

  it('appends the next page while there are more, and offers no more when there are not', async () => {
    const full = Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) => historyEvent({ SequenceNumber: index + 1 }));

    const { instance, calls } = makeInstance({
      history: (query) => (query.skip === 0 ? full : [historyEvent({ SequenceNumber: 999 })]),
    });

    await instance.history.load();

    expect(instance.history.hasMore).toBe(true);
    expect(instance.history.skip).toBe(HISTORY_PAGE_SIZE);

    await instance.history.loadMore();

    expect(calls.history[1].skip).toBe(HISTORY_PAGE_SIZE);
    expect(instance.history.rows).toHaveLength(HISTORY_PAGE_SIZE + 1);
    expect(instance.history.hasMore).toBe(false);

    // Nothing more to ask for
    await instance.history.loadMore();
    expect(calls.history).toHaveLength(2);
  });

  it('filters from a moment, keeps it on the URL and lets Back undo it', async () => {
    const { app, instance, calls } = makeInstance();

    await instance.history.load();

    instance.history.setTimeFrom('2026-09-04T14:02:14.000Z');

    expect(instance.history.timeFrom).toBe('2026-09-04T14:02:14.000Z');
    expect(instance.history.filter).toBe("timestamp ge '2026-09-04T14:02:14.000Z'");
    expect(new URLSearchParams(window.location.search).get('timeFrom')).toBe('2026-09-04T14:02:14.000Z');

    await instance.history.load();

    expect(calls.history[1].filter).toBe("timestamp ge '2026-09-04T14:02:14.000Z'");

    // The filter is pushed, not replaced, so the route before it is still there to go back to -
    // and the state reads the filter off the route, which is what makes Back undo it
    app.router.setQuery({ timeFrom: null }, { replace: false });

    expect(instance.history.timeFrom).toBeNull();
    expect(instance.history.filter).toBe('');
  });

  it('says why it is empty when the page fails', async () => {
    const { app, instance } = makeInstance({ fail: (action) => (action === 'getHistory' ? new Error('500') : null) });

    await instance.history.load();

    expect(instance.history.rows).toEqual([]);
    expect(instance.history.error).toBe('500');
    expect(app.toast.current?.message).toBe('Failed to load history. 500');
  });
});

describe('InstanceState: refreshing', () => {
  it('reloads the details, the first page of history and everything that registered a hook', async () => {
    const { instance, calls } = makeInstance();

    let hookRuns = 0;
    const dispose = instance.onReload(() => void (hookRuns += 1));

    await instance.refreshAll();

    expect(instance.details).not.toBeNull();
    expect(calls.history).toHaveLength(1);
    expect(calls.history[0].skip).toBe(0);
    expect(hookRuns).toBe(1);

    dispose();
    await instance.refreshAll();

    expect(hookRuns).toBe(1);
  });

  it('reloads the spans with the rest of the workspace, and only where there are any', async () => {
    const without = makeInstance();

    await without.instance.refreshAll();

    expect(without.calls.spans).toBe(0);
    expect(without.calls.children).toBe(0);

    const { instance, calls } = makeInstance({ capabilities: { spans: true, children: true } });

    await instance.refreshAll();

    expect(calls.spans).toBe(1);
    expect(calls.children).toBe(1);
    expect(instance.spans.historyRows).toBe(31);
    expect(instance.spans.childrenCount).toBe(2);
  });

  it('ticks the spans too: a running timeline that never moves is a picture of the past', async () => {
    vi.useFakeTimers();

    const { app, instance, calls } = makeInstance({ capabilities: { spans: true, children: true } });

    app.prefs.setAutoRefresh('instance', 5);
    instance.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls.spans).toBe(1);

    instance.stopAutoRefresh();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(calls.spans).toBe(1);
  });

  it('ticks on the interval in the preferences, and never over a request in flight', async () => {
    vi.useFakeTimers();

    const { app, instance, calls } = makeInstance();

    app.prefs.setAutoRefresh('instance', 5);
    instance.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(instance.details).not.toBeNull();
    expect(calls.history).toHaveLength(1);

    // An action is running: a tick over it would show the state from before it finished
    instance.busy = true;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls.history).toHaveLength(1);

    instance.busy = false;
    instance.stopAutoRefresh();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(calls.history).toHaveLength(1);
  });
});

describe('InstanceState: the actions', () => {
  it('suspends and resumes with the reason, and says which one it did', async () => {
    const { app, instance, calls } = makeInstance();

    await instance.suspend('holding for stock');

    expect(calls.actions[0]).toEqual({ action: 'suspend', body: 'holding for stock' });
    expect(app.toast.current?.message).toBe(`Suspended ${INSTANCE_ID}`);

    // The workspace is reloaded afterwards, which is what makes the header show the new status
    expect(instance.details).not.toBeNull();
    expect(calls.history).toHaveLength(1);

    await instance.resume();

    expect(calls.actions[1]).toEqual({ action: 'resume', body: undefined });
    expect(app.toast.current?.message).toBe(`Resumed ${INSTANCE_ID}`);
  });

  it('sends rewind, terminate, restart, raise-event and set-custom-status', async () => {
    const { app, instance, calls } = makeInstance();

    await instance.rewind('re-run the failed steps');
    expect(calls.actions[0]).toEqual({ action: 'rewind', body: 're-run the failed steps' });
    expect(app.toast.current?.message).toBe(`Rewind sent for ${INSTANCE_ID}`);

    await instance.terminate('cancelled by the customer');
    expect(calls.actions[1]).toEqual({ action: 'terminate', body: 'cancelled by the customer' });
    expect(app.toast.current?.message).toBe(`Terminate sent for ${INSTANCE_ID}`);

    await instance.restart(false);
    expect(calls.restarts).toEqual([false]);
    expect(app.toast.current?.message).toBe(`Restart sent for ${INSTANCE_ID}`);

    await instance.raiseEvent('PaymentApproved', { transactionId: 'tx_9c2d' });
    expect(calls.raised).toEqual([{ name: 'PaymentApproved', data: { transactionId: 'tx_9c2d' } }]);
    expect(app.toast.current?.message).toBe(`Raise event sent for ${INSTANCE_ID}`);

    // Null clears it, which is why it is passed through rather than dropped
    await instance.setCustomStatus(null);
    expect(calls.customStatus).toEqual([null]);
    expect(app.toast.current?.message).toBe(`Set customStatus sent for ${INSTANCE_ID}`);
  });

  it('purges, says so and leaves for the list the instance is no longer in', async () => {
    const { app, instance, calls } = makeInstance();

    await instance.purge();

    expect(calls.purges).toBe(1);
    expect(app.toast.current?.message).toBe(`Purged ${INSTANCE_ID}`);
    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances');

    // Nothing is reloaded: there is no instance left to load
    expect(calls.history).toHaveLength(0);
  });

  it('says what failed and why, and changes nothing else', async () => {
    const { app, instance, calls } = makeInstance({
      fail: (action) => (action === 'terminate' ? new Error('403 Forbidden') : null),
    });

    const done = await instance.terminate();

    expect(done).toBe(false);
    expect(app.toast.current?.message).toBe('Failed to terminate. 403 Forbidden');
    expect(instance.busy).toBe(false);
    expect(calls.history).toHaveLength(0);
  });

  it('runs one action at a time', async () => {
    const { instance, calls } = makeInstance();

    instance.busy = true;

    expect(await instance.suspend('later')).toBe(false);
    expect(calls.actions).toHaveLength(0);
  });
});
