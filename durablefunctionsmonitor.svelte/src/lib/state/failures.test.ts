// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities, FailuresQuery, FailuresResponse } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { FAILURES_FAILED, Failures } from './failures.svelte';
import { Prefs } from './prefs.svelte';
import { failureGroup, failures as failuresFixture } from '../../../tests/unit/fixtures/failures';

const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

function makeApp(capabilities: Partial<Capabilities> = { failures: true }, path = '/DurableFunctionsHub/failures') {
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

/** The screen and the one endpoint it calls, answering with whatever the test gave it. */
function makeFailures(
  options: {
    capabilities?: Partial<Capabilities>;
    path?: string;
    answer?: () => Promise<FailuresResponse>;
  } = {},
) {
  const app = makeApp(options.capabilities ?? { failures: true }, options.path);
  const queries: FailuresQuery[] = [];

  app.endpoints.failures = async (query: FailuresQuery) => {
    queries.push(query);

    return options.answer ? await options.answer() : failuresFixture();
  };

  return { app, queries, failures: new Failures({ app, now: () => NOW }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Failures', () => {
  it('asks for the failures of the shared range and shows what came back', async () => {
    const { failures, queries } = makeFailures();

    await failures.load();

    // The default range, resolved against the clock the screen was given
    expect(queries).toEqual([{ from: '2026-09-03T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' }]);

    expect(failures.groups.map((group) => group.signature)).toEqual([
      'InventoryUnavailable',
      'TimeoutException',
      'LedgerOutOfBalance',
    ]);

    expect(failures.totalFailed).toBe(18);
    expect(failures.summary).toBe('18 failed in 3 groups');
    expect(failures.scannedLabel).toBe('scanned 1,229 · full');
    expect(failures.partial).toBe(false);
    expect(failures.isEmpty).toBe(false);
    expect(failures.loading).toBe(false);
    expect(failures.error).toBeNull();
  });

  it('says the numbers are a lower bound when the backend stopped at its cap', async () => {
    const { failures } = makeFailures({ answer: async () => failuresFixture({ partial: true, scanned: 20_000 }) });

    await failures.load();

    expect(failures.scannedLabel).toBe('scanned 20,000 · partial');
    expect(failures.partial).toBe(true);
  });

  it('counts one group as one group', async () => {
    const { failures } = makeFailures({
      answer: async () => failuresFixture({ groups: [failureGroup()], totalFailed: 12 }),
    });

    await failures.load();

    expect(failures.summary).toBe('12 failed in 1 group');
  });

  it('knows the difference between not loaded and nothing failed', async () => {
    const { failures } = makeFailures({ answer: async () => failuresFixture({ groups: [], totalFailed: 0 }) });

    expect(failures.isEmpty).toBe(false);
    expect(failures.scannedLabel).toBe('—');

    await failures.load();

    expect(failures.isEmpty).toBe(true);
    expect(failures.summary).toBe('0 failed in 0 groups');
  });

  it('asks nothing at all of a backend that does not serve /failures', async () => {
    const { failures, queries } = makeFailures({ capabilities: {} });

    await failures.load();

    expect(queries).toEqual([]);
    expect(failures.supported).toBe(false);
    expect(failures.response).toBeNull();
  });

  it('opens the first group, and leaves the rest to the user', async () => {
    const { failures } = makeFailures();

    await failures.load();

    // ScreenFailures.dc.html L96: the biggest group is the one worth looking at first
    expect([...failures.open]).toEqual(['ProcessOrderOrchestrator|InventoryUnavailable']);
    expect(failures.isOpen('ProcessOrderOrchestrator|TimeoutException')).toBe(false);

    failures.toggle('ProcessOrderOrchestrator|TimeoutException');
    failures.toggle('ProcessOrderOrchestrator|InventoryUnavailable');

    expect([...failures.open]).toEqual(['ProcessOrderOrchestrator|TimeoutException']);

    // A reload keeps what the user opened rather than opening the first one over them again
    await failures.load();

    expect([...failures.open]).toEqual(['ProcessOrderOrchestrator|TimeoutException']);
  });

  it('does not re-open a group the user closed, even when that leaves nothing open', async () => {
    const { failures } = makeFailures();

    await failures.load();
    failures.toggle('ProcessOrderOrchestrator|InventoryUnavailable');

    expect([...failures.open]).toEqual([]);

    await failures.load();

    expect([...failures.open]).toEqual([]);
  });

  it('drops a group that is no longer in the range', async () => {
    let groups = failuresFixture().groups;
    const { failures } = makeFailures({ answer: async () => failuresFixture({ groups }) });

    await failures.load();
    failures.toggle('ReconcileLedgerOrchestrator|LedgerOutOfBalance');

    expect(failures.isOpen('ReconcileLedgerOrchestrator|LedgerOutOfBalance')).toBe(true);

    groups = groups.slice(0, 1);
    await failures.load();

    // The group that is gone is gone; the one still there stays open
    expect([...failures.open]).toEqual(['ProcessOrderOrchestrator|InventoryUnavailable']);
  });

  it('keeps the answer of the last load when two are in flight', async () => {
    const pending: ((response: FailuresResponse) => void)[] = [];
    const { failures } = makeFailures({
      answer: () => new Promise<FailuresResponse>((resolveWith) => pending.push(resolveWith)),
    });

    const first = failures.load();
    const second = failures.load();

    // The stale one answers last, and is thrown away for being stale rather than for being late
    pending[1](failuresFixture({ totalFailed: 2 }));
    pending[0](failuresFixture({ totalFailed: 99 }));

    await Promise.all([first, second]);

    expect(failures.totalFailed).toBe(2);
    expect(failures.loading).toBe(false);
  });

  it('says why it could not refresh, once per outage', async () => {
    let fail = true;
    const { app, failures } = makeFailures({
      answer: async () => {
        if (fail) {
          throw new Error('500 Internal Server Error');
        }

        return failuresFixture();
      },
    });

    await failures.load();

    expect(failures.error).toBe('500 Internal Server Error');
    expect(app.toast.current?.message).toBe(`${FAILURES_FAILED}. 500 Internal Server Error`);
    expect(app.toast.current?.retry).toBeTypeOf('function');

    app.toast.dismiss();
    await failures.load();

    // An endpoint that is down stays down; saying so every five seconds helps nobody
    expect(app.toast.current).toBeNull();

    fail = false;
    await failures.load();

    expect(failures.error).toBeNull();

    fail = true;
    app.toast.dismiss();
    await failures.load();

    // ...and the next outage is a new one
    expect(app.toast.current?.message).toBe(`${FAILURES_FAILED}. 500 Internal Server Error`);
  });

  it('gives the nav badge the count it just loaded', async () => {
    const { app, failures } = makeFailures();

    expect(app.failuresCount).toBe(0);

    await failures.load();

    expect(app.failuresCount).toBe(18);
  });

  it('reloads on the interval in the preferences, and stops when it is told to', async () => {
    vi.useFakeTimers();

    const { app, failures, queries } = makeFailures();

    app.setAutoRefresh('instances', 5);
    failures.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(queries.length).toBe(1);

    failures.stopAutoRefresh();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(queries.length).toBe(1);
  });

  it('does not start a timer when auto-refresh is off', async () => {
    vi.useFakeTimers();

    const { app, failures, queries } = makeFailures();

    app.setAutoRefresh('instances', 0);
    failures.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(queries).toEqual([]);
  });
});
