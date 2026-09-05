// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Router,
  parsePath,
  queryString,
  routePath,
  toSearchParams,
  toTarget,
  type Route,
  type RouteStateField,
  type RouteStateStorage,
} from './router.svelte';

const HUB = 'DurableFunctionsHub';

/** A stand-in for `ViewStateStorage('route')` (E0-S2-T2). */
function fakeStorage(seed: Partial<Record<RouteStateField, string>> = {}) {
  const values = new Map<RouteStateField, string>(Object.entries(seed) as [RouteStateField, string][]);
  const setItems = vi.fn((items: { fieldName: RouteStateField; value: string | null }[]) => {
    for (const { fieldName, value } of items) {
      if (value === null) {
        values.delete(fieldName);
      } else {
        values.set(fieldName, value);
      }
    }
  });
  const storage: RouteStateStorage & { values: Map<RouteStateField, string>; setItems: typeof setItems } = {
    values,
    setItems,
    getItem: (fieldName) => values.get(fieldName) ?? null,
  };
  return storage;
}

function goTo(url: string) {
  window.history.replaceState(null, '', url);
}

function historySpies() {
  return {
    pushState: vi.spyOn(window.history, 'pushState'),
    replaceState: vi.spyOn(window.history, 'replaceState'),
  };
}

function historyRouter(url: string, routePrefix = '') {
  goTo(url);
  const router = new Router({ mode: 'history', routePrefix });
  routers.push(router);
  return router;
}

const routers: Router[] = [];

afterEach(() => {
  while (routers.length) {
    routers.pop()?.dispose();
  }
  goTo('/');
  vi.restoreAllMocks();
});

describe('parsePath', () => {
  it('maps the empty path to login', () => {
    expect(parsePath('/')).toEqual({ name: 'login' });
    expect(parsePath('')).toEqual({ name: 'login' });
    expect(parsePath('/prefix/', 'prefix')).toEqual({ name: 'login' });
  });

  it('maps a bare hub to overview', () => {
    expect(parsePath(`/${HUB}`)).toEqual({ name: 'overview', hub: HUB });
  });

  it('maps every hub sub-path to its screen', () => {
    for (const name of ['instances', 'failures', 'entities', 'functions', 'storage', 'activity', 'settings']) {
      expect(parsePath(`/${HUB}/${name}`)).toEqual({ name, hub: HUB });
    }
  });

  it('maps an unknown sub-path under a hub to overview', () => {
    expect(parsePath(`/${HUB}/nonsense`)).toEqual({ name: 'overview', hub: HUB });
    expect(parsePath(`/${HUB}/nonsense/deeper`)).toEqual({ name: 'overview', hub: HUB });
  });

  it('reads the instance route with the prefix stripped', () => {
    expect(parsePath('/prefix/DurableFunctionsHub/instances/order-1', 'prefix')).toEqual({
      name: 'instance',
      hub: 'DurableFunctionsHub',
      instanceId: 'order-1',
    });
  });

  it('strips the prefix case-insensitively', () => {
    expect(parsePath(`/DFM/${HUB}/failures`, 'dfm')).toEqual({ name: 'failures', hub: HUB });
    expect(parsePath(`/dfm/${HUB}/failures`, 'DFM')).toEqual({ name: 'failures', hub: HUB });
  });

  it('strips a multi-segment prefix', () => {
    expect(parsePath(`/durable-functions-monitor/${HUB}`, 'durable-functions-monitor')).toEqual({
      name: 'overview',
      hub: HUB,
    });
  });

  it('strips the prefix once only', () => {
    // The second `dfm` is the hub segment, not a second prefix.
    expect(parsePath('/dfm/dfm/failures', 'dfm')).toEqual({ name: 'failures', hub: 'dfm' });
  });

  it('leaves a path that does not start with the prefix alone', () => {
    expect(parsePath(`/${HUB}/failures`, 'dfm')).toEqual({ name: 'failures', hub: HUB });
  });

  it('decodes the instance id', () => {
    expect(parsePath(`/${HUB}/instances/${encodeURIComponent('@Counter@order-1')}`)).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: '@Counter@order-1',
    });
    expect(parsePath(`/${HUB}/instances/a%27b`)).toEqual({ name: 'instance', hub: HUB, instanceId: "a'b" });
  });

  it('redirects the two legacy alias forms to the instance route', () => {
    expect(parsePath(`/${HUB}/durable-instances/x`)).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'x',
      redirectTo: `/${HUB}/instances/x`,
    });
    expect(parsePath(`/${HUB}/orchestrations/x`)).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'x',
      redirectTo: `/${HUB}/instances/x`,
    });
  });

  it('keeps the prefix in the redirect target', () => {
    expect(parsePath(`/dfm/${HUB}/durable-instances/x`, 'dfm')).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'x',
      redirectTo: `/dfm/${HUB}/instances/x`,
    });
  });

  it('redirects a bare alias to the instances list', () => {
    expect(parsePath(`/${HUB}/orchestrations`)).toEqual({
      name: 'instances',
      hub: HUB,
      redirectTo: `/${HUB}/instances`,
    });
  });
});

describe('helpers', () => {
  it('drops the redirect marker with toTarget', () => {
    expect(toTarget(parsePath(`/${HUB}/durable-instances/x`))).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'x',
    });
    expect(toTarget({ name: 'login' })).toEqual({ name: 'login' });
  });

  it('builds route paths without the prefix', () => {
    expect(routePath({ name: 'login' })).toBe('/');
    expect(routePath({ name: 'overview', hub: HUB })).toBe(`/${HUB}`);
    expect(routePath({ name: 'instance', hub: HUB, instanceId: "a'b" })).toBe(`/${HUB}/instances/a'b`);
  });

  it('drops null and undefined from a query patch', () => {
    expect(toSearchParams({ range: '7d', top: 50, entities: true, from: null, to: undefined }).toString()).toBe(
      'range=7d&top=50&entities=true',
    );
    expect(toSearchParams(new URLSearchParams('a=1')).toString()).toBe('a=1');
    expect(toSearchParams('a=1').toString()).toBe('a=1');
    expect(toSearchParams().toString()).toBe('');
  });

  it('prefixes a non-empty query with a question mark', () => {
    expect(queryString(new URLSearchParams('a=1'))).toBe('?a=1');
    expect(queryString(new URLSearchParams())).toBe('');
    expect(queryString()).toBe('');
  });
});

describe('Router.href', () => {
  it('builds a hub route with and without a prefix', () => {
    expect(historyRouter('/').href({ name: 'failures', hub: HUB })).toBe(`/${HUB}/failures`);
    expect(historyRouter('/', 'dfm').href({ name: 'failures', hub: HUB })).toBe(`/dfm/${HUB}/failures`);
  });

  it('builds the overview, login and instance routes', () => {
    const router = historyRouter(`/dfm/${HUB}`, 'dfm');

    expect(router.href({ name: 'overview', hub: HUB })).toBe(`/dfm/${HUB}`);
    expect(router.href({ name: 'login' })).toBe('/dfm/');
    expect(router.href({ name: 'instance', hub: HUB, instanceId: '@Counter@order-1' })).toBe(
      `/dfm/${HUB}/instances/%40Counter%40order-1`,
    );
  });

  it('treats a string path as hub-relative', () => {
    const router = historyRouter(`/dfm/${HUB}/instances`, 'dfm');

    expect(router.href('/instances')).toBe(`/dfm/${HUB}/instances`);
    expect(router.href('/')).toBe(`/dfm/${HUB}`);
  });

  it('appends the query', () => {
    const router = historyRouter('/');

    expect(router.href({ name: 'instances', hub: HUB }, { range: '7d', status: 'Failed' })).toBe(
      `/${HUB}/instances?range=7d&status=Failed`,
    );
    expect(router.href({ name: 'instances', hub: HUB }, {})).toBe(`/${HUB}/instances`);
  });
});

describe('Router in history mode', () => {
  it('starts on the route in the address bar, query included', () => {
    const router = historyRouter(`/${HUB}/instances?range=7d`);

    expect(router.current.name).toBe('instances');
    expect(router.hub).toBe(HUB);
    expect(router.current.query.get('range')).toBe('7d');
  });

  it('replaces a legacy alias URL with the instance URL, keeping the query', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const router = historyRouter(`/${HUB}/durable-instances/order-1?tab=history`);

    expect(replaceState).toHaveBeenCalledWith(null, '', `/${HUB}/instances/order-1?tab=history`);
    expect(router.current).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'order-1',
      query: new URLSearchParams('tab=history'),
    });
    expect(window.location.pathname).toBe(`/${HUB}/instances/order-1`);
  });

  it('pushes on navigate and replaces when asked', () => {
    const router = historyRouter(`/${HUB}`);
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    router.navigate({ name: 'failures', hub: HUB }, { query: { range: '7d' } });

    expect(pushState).toHaveBeenCalledWith(null, '', `/${HUB}/failures?range=7d`);
    expect(router.current.name).toBe('failures');

    router.navigate({ name: 'settings', hub: HUB }, { replace: true });

    expect(replaceState).toHaveBeenCalledWith(null, '', `/${HUB}/settings`);
    expect(router.current.name).toBe('settings');
  });

  it('re-reads the route on popstate', () => {
    const router = historyRouter(`/${HUB}`);

    goTo(`/${HUB}/instances/order-1?tab=raw`);
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(router.current).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'order-1',
      query: new URLSearchParams('tab=raw'),
    });
  });

  it('stops listening to popstate after dispose', () => {
    const router = historyRouter(`/${HUB}`);
    router.dispose();

    goTo(`/${HUB}/failures`);
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(router.current.name).toBe('overview');
  });

  it('delegates back() to the browser history', () => {
    const router = historyRouter(`/${HUB}`);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    router.back();

    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('Router.setQuery', () => {
  it('merges the patch, deletes null values and keeps the rest', () => {
    const router = historyRouter(`/${HUB}/instances?range=24h&from=2026-09-04T08:30:00Z&status=Failed`);

    router.setQuery({ range: '7d', from: null });

    expect(router.current.query.get('range')).toBe('7d');
    expect(router.current.query.has('from')).toBe(false);
    expect(router.current.query.get('status')).toBe('Failed');
    expect(window.location.search).toBe('?range=7d&status=Failed');
  });

  it('replaces by default and pushes when asked, staying on the same route', () => {
    const router = historyRouter(`/${HUB}/instances/order-1`);
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    router.setQuery({ tab: 'history' });

    expect(replaceState).toHaveBeenCalledWith(null, '', `/${HUB}/instances/order-1?tab=history`);
    expect(pushState).not.toHaveBeenCalled();
    expect(router.current.name).toBe('instance');

    router.setQuery({ seq: 27 }, { replace: false });

    expect(pushState).toHaveBeenCalledWith(null, '', `/${HUB}/instances/order-1?tab=history&seq=27`);
  });
});

describe('Router in memory mode', () => {
  it('starts on overview and never touches window.history', () => {
    const { pushState, replaceState } = historySpies();
    const router = new Router({ mode: 'memory', hub: HUB });

    expect(router.current).toEqual({ name: 'overview', hub: HUB, query: new URLSearchParams() });

    router.navigate({ name: 'failures', hub: HUB }, { query: { range: '7d' } });

    expect(router.current).toEqual({ name: 'failures', hub: HUB, query: new URLSearchParams('range=7d') });

    router.setQuery({ range: '30d' });

    expect(router.current.query.get('range')).toBe('30d');

    // setQuery replaced, so Back leaves the screen instead of undoing the filter.
    router.back();

    expect(router.current.name).toBe('overview');
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('walks back through the pushed routes', () => {
    const router = new Router({ mode: 'memory', hub: HUB });

    router.navigate({ name: 'failures', hub: HUB });
    router.navigate({ name: 'settings', hub: HUB });
    router.back();

    expect(router.current.name).toBe('failures');

    router.back();

    expect(router.current.name).toBe('overview');
  });

  it('persists route and query through the injected storage', () => {
    const storage = fakeStorage();
    const router = new Router({ mode: 'memory', hub: HUB, storage });

    router.navigate({ name: 'instance', hub: HUB, instanceId: 'order-1' }, { query: { tab: 'history' } });

    expect(storage.setItems).toHaveBeenCalledWith([
      { fieldName: 'route', value: `/${HUB}/instances/order-1` },
      { fieldName: 'query', value: 'tab=history' },
    ]);
  });

  it('restores the persisted route on construction', () => {
    const { replaceState } = historySpies();
    const storage = fakeStorage({ route: `/${HUB}/instances/order-1`, query: 'tab=history' });

    const router = new Router({ mode: 'memory', hub: HUB, storage });

    expect(router.current).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'order-1',
      query: new URLSearchParams('tab=history'),
    });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('starts on the instance route when an instance id is injected', () => {
    const storage = fakeStorage({ route: `/${HUB}/failures` });

    const router = new Router({ mode: 'memory', hub: HUB, instanceId: 'order-1', storage });

    expect(router.current).toEqual({
      name: 'instance',
      hub: HUB,
      instanceId: 'order-1',
      query: new URLSearchParams(),
    });
  });
});

describe('Router in the VS Code host', () => {
  const GLOBALS = ['acquireVsCodeApi', 'OrchestrationIdFromVsCode'] as const;

  function clearGlobals() {
    for (const key of GLOBALS) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }

  afterEach(() => {
    clearGlobals();
    vi.resetModules();
  });

  it('runs in memory mode and starts on host.orchestrationIdFromVsCode', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: vi.fn() });
    (globalThis as Record<string, unknown>).OrchestrationIdFromVsCode = 'order-2026-09-04-000913';
    vi.resetModules();

    const { Router: VsCodeRouter } = await import('./router.svelte');
    const pushState = vi.spyOn(window.history, 'pushState');
    const router = new VsCodeRouter();

    expect(router.mode).toBe('memory');
    expect(router.current).toEqual({
      name: 'instance',
      hub: '',
      instanceId: 'order-2026-09-04-000913',
      query: new URLSearchParams(),
    } satisfies Route);
    expect(pushState).not.toHaveBeenCalled();
  });

  it('runs in memory mode on overview when no instance id is injected', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: vi.fn() });
    vi.resetModules();

    const { Router: VsCodeRouter } = await import('./router.svelte');
    const router = new VsCodeRouter({ hub: HUB });

    expect(router.mode).toBe('memory');
    expect(router.current.name).toBe('overview');
  });
});
