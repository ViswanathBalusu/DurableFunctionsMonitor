// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '../api/client';
import type { Endpoints } from '../api/endpoints';
import { normalizeAbout } from '../api/endpoints';
import type { About } from '../api/types';
import type { Host } from '../host.svelte';
import { Router } from '../router.svelte';
import { Prefs } from './prefs.svelte';
import { AppState } from './app.svelte';

function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    kind: 'browser',
    vsCodeApi: null,
    routePrefix: '',
    apiRoutePrefix: 'a/p/i',
    clientConfig: {},
    viewMode: 0,
    functionGraphAvailable: false,
    orchestrationIdFromVsCode: '',
    stateFromVsCode: {},
    ...overrides,
  };
}

/** A client that never gets called: every test drives the endpoints object directly. */
const unusedClient = {} as BackendClient;

function fakeEndpoints(about: () => Promise<About>): Endpoints {
  return { about } as unknown as Endpoints;
}

function aboutBody(overrides: Partial<About> = {}): About {
  return normalizeAbout({
    accountName: 'mystorageaccount',
    hubName: 'DurableFunctionsHub',
    version: '6.9.0 (isolated)',
    permissions: ['DurableFunctionsMonitor.ReadWrite'],
    provider: 'AzureStorage',
    readOnly: false,
    dangerousOperations: false,
    capabilities: { stats: true } as never,
    ...overrides,
  });
}

function appWith(options: { about?: () => Promise<About>; host?: Host; path?: string } = {}) {
  const host = options.host ?? fakeHost();

  window.history.replaceState({}, '', options.path ?? '/DurableFunctionsHub/instances');

  return new AppState({
    host,
    client: unusedClient,
    endpoints: fakeEndpoints(options.about ?? (() => Promise.resolve(aboutBody()))),
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, {
      setItem: () => {},
      setItems: () => {},
      getItem: () => null,
      removeItem: () => {},
    }),
  });
}

describe('AppState', () => {
  beforeEach(() => {
    document.title = 'test';
  });

  it('takes the hub from the current route', () => {
    const app = appWith({ path: '/DurableFunctionsHub/instances' });

    expect(app.hub).toBe('DurableFunctionsHub');
    expect(app.router.current.name).toBe('instances');
  });

  it('reports every capability as false until /about has answered', () => {
    const app = appWith();

    expect(app.about).toBeNull();
    expect(Object.values(app.capabilities).every((c) => c === false)).toBe(true);

    // Unknown counts as read-only: better to hide an action than to offer one that 403s
    expect(app.readOnly).toBe(true);
    expect(app.dangerous).toBe(false);
  });

  it('loads /about and publishes what it said', async () => {
    const app = appWith();

    await app.loadAbout();

    expect(app.about?.hubName).toBe('DurableFunctionsHub');
    expect(app.capabilities.stats).toBe(true);
    expect(app.readOnly).toBe(false);
    expect(app.aboutError).toBeNull();
  });

  it('sets the document title the way the React app did', async () => {
    const app = appWith();

    await app.loadAbout();

    expect(document.title).toBe('Durable Functions Monitor (mystorageaccount/DurableFunctionsHub) v6.9.0 (isolated)');
  });

  it('marks a read-only endpoint in the title', async () => {
    const app = appWith({ about: () => Promise.resolve(aboutBody({ readOnly: true, permissions: [] })) });

    await app.loadAbout();

    expect(app.readOnly).toBe(true);
    expect(document.title).toBe(
      'Durable Functions Monitor (mystorageaccount/DurableFunctionsHub, ReadOnly) v6.9.0 (isolated)',
    );
  });

  it('keeps working when /about fails', async () => {
    const app = appWith({ about: () => Promise.reject(new Error('Task Hub is not allowed')) });

    const result = await app.loadAbout();

    expect(result).toBeNull();
    expect(app.aboutError).toBe('Task Hub is not allowed');
    expect(app.about).toBeNull();

    // And the progress counter came back down
    expect(app.progress).toBe(0);
    expect(app.busy).toBe(false);
  });

  it('does not call /about without a hub', async () => {
    const about = vi.fn(() => Promise.resolve(aboutBody()));
    const app = appWith({ about, path: '/' });

    expect(app.hub).toBe('');
    await app.loadAbout();

    expect(about).not.toHaveBeenCalled();
  });

  it('counts work in flight', async () => {
    const app = appWith();

    let release = () => {};
    const inFlight = app.track(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    expect(app.busy).toBe(true);
    expect(app.progress).toBe(1);

    release();
    await inFlight;

    expect(app.busy).toBe(false);
  });

  it('counts a promise it is handed, and comes back down on a rejection', async () => {
    const app = appWith();

    const inFlight = app.track(Promise.reject(new Error('500 Internal Server Error')));

    expect(app.busy).toBe(true);

    await expect(inFlight).rejects.toThrow('500 Internal Server Error');

    // The caller still sees the rejection; the bar does not stay up because of it
    expect(app.busy).toBe(false);
    expect(app.progress).toBe(0);
  });

  it('holds the bar up until the last of several requests is done', async () => {
    const app = appWith();

    let releaseFirst = () => {};
    let releaseSecond = () => {};

    const first = app.track(new Promise<void>((resolve) => (releaseFirst = resolve)));
    const second = app.track(new Promise<void>((resolve) => (releaseSecond = resolve)));

    expect(app.progress).toBe(2);

    releaseFirst();
    await first;
    expect(app.busy).toBe(true);

    releaseSecond();
    await second;
    expect(app.busy).toBe(false);
  });

  it('never counts below zero', () => {
    const app = appWith();

    app.end();

    expect(app.progress).toBe(0);
  });

  it('reads the shared time range from the route and writes it back', () => {
    const app = appWith({ path: '/DurableFunctionsHub/instances?range=7d' });

    expect(app.timeRange).toEqual({ preset: '7d' });

    app.setTimeRange({ from: '2026-09-04T00:00:00Z', to: '2026-09-04T12:00:00Z' });

    expect(app.timeRange).toEqual({ from: '2026-09-04T00:00:00Z', to: '2026-09-04T12:00:00Z' });

    // The preset key is gone from the URL, so a link carries one range, not two
    expect(app.router.current.query.get('range')).toBeNull();
  });

  it('defaults the time range to the last 24 hours', () => {
    expect(appWith().timeRange).toEqual({ preset: '24h' });
  });

  it('exposes the per-screen auto-refresh intervals', () => {
    const app = appWith();

    app.prefs.setAutoRefresh('instances', 15);

    expect(app.autoRefreshSeconds('instances')).toBe(15);
    expect(app.autoRefreshSeconds('instance')).toBe(0);
  });

  it('sets an auto-refresh interval through the preferences', () => {
    const app = appWith();

    app.setAutoRefresh('instance', 5);

    expect(app.autoRefreshSeconds('instance')).toBe(5);
    expect(app.prefs.autoRefresh.instance).toBe(5);
  });

  it('refreshes whatever the screen on show registered', () => {
    const app = appWith();
    const load = vi.fn();

    const dispose = app.onRefresh(load);
    app.refresh();
    app.refresh();

    expect(load).toHaveBeenCalledTimes(2);

    dispose();
    app.refresh();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('calls every handler of the screen, in the order they registered', () => {
    const app = appWith();
    const order: string[] = [];

    app.onRefresh(() => order.push('list'));
    app.onRefresh(() => order.push('histogram'));

    app.refresh();

    expect(order).toEqual(['list', 'histogram']);
  });

  it('survives a handler that unregisters while it runs', () => {
    const app = appWith();
    const second = vi.fn();

    const dispose = app.onRefresh(() => dispose());
    app.onRefresh(second);

    expect(() => app.refresh()).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
  });

  it('drops the handlers of the screen that is leaving, and keeps the arriving one', () => {
    const app = appWith({ path: '/DurableFunctionsHub' });
    const leaving = vi.fn();
    const arriving = vi.fn();

    app.onRefresh(leaving);

    // Whichever way round the outgoing cleanup and the incoming registration run: the outlet names
    // the screen it is unmounting, so the arriving screen's handler is never caught by it
    app.router.navigate({ name: 'entities', hub: app.hub });
    app.onRefresh(arriving);
    app.clearRefreshHandlers('overview');
    app.refresh();

    expect(leaving).not.toHaveBeenCalled();
    expect(arriving).toHaveBeenCalledOnce();
  });

  it('names the workspace of one instance apart from another', () => {
    const app = appWith({ path: '/DurableFunctionsHub/instances/order-1' });

    expect(app.screenKey).toBe('instance:order-1');

    app.router.navigate({ name: 'instance', hub: app.hub, instanceId: 'order-2' });
    expect(app.screenKey).toBe('instance:order-2');

    // A filter or a range change is the same screen
    app.setTimeRange({ preset: '7d' });
    expect(app.screenKey).toBe('instance:order-2');
  });

  it('drops every handler when it is not told which screen', () => {
    const app = appWith();
    const load = vi.fn();

    app.onRefresh(load);
    app.clearRefreshHandlers();
    app.refresh();

    expect(load).not.toHaveBeenCalled();
  });

  it('reports the user name the host injected', () => {
    const app = appWith({ host: fakeHost({ clientConfig: { userName: 'alice@contoso.com' } }) });

    expect(app.userName).toBe('alice@contoso.com');
  });
});
