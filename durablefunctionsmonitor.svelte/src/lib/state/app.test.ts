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

  it('reports the user name the host injected', () => {
    const app = appWith({ host: fakeHost({ clientConfig: { userName: 'alice@contoso.com' } }) });

    expect(app.userName).toBe('alice@contoso.com');
  });
});
