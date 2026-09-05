// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { AuditQuery, AuditResponse, Capabilities } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { ACTIVITY_FAILED, ALL_OPERATIONS, Activity, OPERATIONS } from './activity.svelte';
import { AppState } from './app.svelte';
import { Prefs } from './prefs.svelte';
import { audit as auditFixture, auditDisabled, auditRow } from '../../../tests/unit/fixtures/audit';

const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

/** The default range, resolved against the clock below. */
const LAST_24H = { from: '2026-09-03T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' };

function makeApp(capabilities: Partial<Capabilities> = { audit: true }, path = '/DurableFunctionsHub/activity') {
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
function makeActivity(
  options: {
    capabilities?: Partial<Capabilities>;
    path?: string;
    answer?: () => Promise<AuditResponse>;
  } = {},
) {
  const app = makeApp(options.capabilities ?? { audit: true }, options.path);
  const queries: AuditQuery[] = [];

  app.endpoints.audit = async (query: AuditQuery = {}) => {
    queries.push(query);

    return options.answer ? await options.answer() : auditFixture();
  };

  return { app, queries, activity: new Activity({ app, now: () => NOW }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Activity', () => {
  it('asks for the audit trail of the shared range, newest first', async () => {
    const { activity, queries } = makeActivity();

    await activity.load();

    expect(queries).toEqual([{ ...LAST_24H, operation: undefined, top: 100, skip: 0 }]);

    // The backend orders and pages the rows; the screen shows them in the order they arrived
    expect(activity.rows.map((row) => row.operation)).toEqual([
      'Terminate',
      'Raise event',
      'Replay',
      'Update input and rewind',
      'Restart in place',
      'Purge history',
    ]);

    expect(activity.countLabel).toBe('6 entries');
    expect(activity.enabled).toBe(true);
    expect(activity.auditingOff).toBe(false);
    expect(activity.isEmpty).toBe(false);
    expect(activity.error).toBeNull();
  });

  it('follows the range the rest of the shell is on', async () => {
    const { app, activity, queries } = makeActivity();

    app.setTimeRange({ preset: '7d' });
    await activity.load();

    expect(queries[0]).toMatchObject({ from: '2026-08-28T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' });
    expect(activity.rangeLower).toBe('last 7 days');
  });

  describe('the operation filter', () => {
    it('sends the operation verbatim', async () => {
      const { activity, queries } = makeActivity({
        path: '/DurableFunctionsHub/activity?operation=Restart%20in%20place',
      });

      expect(activity.operation).toBe('Restart in place');

      await activity.load();

      expect(queries[0].operation).toBe('Restart in place');
    });

    it('sends no operation at all for All operations', async () => {
      const { activity, queries } = makeActivity();

      expect(activity.operation).toBe(ALL_OPERATIONS);

      await activity.load();

      expect(queries[0].operation).toBeUndefined();
    });

    it('writes the filter to the URL, and All operations clears it', () => {
      const { app, activity } = makeActivity();

      activity.setOperation('Purge history');

      expect(app.router.current.query.get('operation')).toBe('Purge history');
      expect(activity.operation).toBe('Purge history');

      activity.setOperation(ALL_OPERATIONS);

      expect(app.router.current.query.get('operation')).toBeNull();
      expect(activity.operation).toBe(ALL_OPERATIONS);
    });

    it('ignores an operation nothing could ever have recorded', () => {
      const { activity } = makeActivity({ path: '/DurableFunctionsHub/activity?operation=Nonsense' });

      expect(activity.operation).toBe(ALL_OPERATIONS);
    });

    it('offers every name the middleware writes, each of which matches exactly one', () => {
      // AuditOperations.cs maps every route to one of these
      expect(OPERATIONS).toContain('Set customStatus');
      expect(OPERATIONS).toContain('Start new instance');
      expect(OPERATIONS).toContain('Delete task hub');

      // A batch is audited under the action it ran (Batch.cs), so a bare `Batch` matches nothing
      expect(OPERATIONS).not.toContain('Batch');
      expect(OPERATIONS).toContain('Batch terminate');
      expect(OPERATIONS).toContain('Batch set-custom-status');

      expect(new Set(OPERATIONS).size).toBe(OPERATIONS.length);
      expect(OPERATIONS).not.toContain(ALL_OPERATIONS);
    });
  });

  describe('paging', () => {
    it('appends the next page and counts the rows it already has', async () => {
      const pages = [
        auditFixture({ rows: [auditRow()], hasMore: true }),
        auditFixture({ rows: [auditRow({ at: '2026-09-01T09:00:00Z', operation: 'Purge' })], hasMore: false }),
      ];
      let next = 0;
      const { activity, queries } = makeActivity({ answer: async () => pages[next++] });

      await activity.load();

      expect(activity.hasMore).toBe(true);
      expect(activity.countLabel).toBe('1+ entries');

      await activity.loadMore();

      expect(queries.map((query) => query.skip)).toEqual([0, 1]);
      expect(activity.rows).toHaveLength(2);
      expect(activity.hasMore).toBe(false);
      expect(activity.countLabel).toBe('2 entries');

      // Nothing more to ask for
      await activity.loadMore();

      expect(queries).toHaveLength(2);
    });

    it('starts again from the top when the filters change', async () => {
      const { activity, queries } = makeActivity({ answer: async () => auditFixture({ hasMore: true }) });

      await activity.load();
      await activity.loadMore();

      activity.setOperation('Replay');
      await activity.load();

      expect(queries.map((query) => query.skip)).toEqual([0, 6, 0]);
      expect(activity.rows).toHaveLength(6);
    });
  });

  describe('when there is no audit trail', () => {
    it('asks nothing at all of a backend without the capability', async () => {
      const { activity, queries } = makeActivity({ capabilities: {} });

      await activity.load();

      expect(queries).toEqual([]);
      expect(activity.supported).toBe(false);
      expect(activity.auditingOff).toBe(true);
      expect(activity.isEmpty).toBe(true);
    });

    it('takes the backend at its word when auditing is off', async () => {
      const { activity } = makeActivity({ answer: async () => auditDisabled() });

      await activity.load();

      // An empty page that says why - not an error, and not "nothing happened"
      expect(activity.enabled).toBe(false);
      expect(activity.auditingOff).toBe(true);
      expect(activity.isEmpty).toBe(true);
      expect(activity.error).toBeNull();
    });

    it('knows the difference between not loaded and nothing recorded', async () => {
      const { activity } = makeActivity({ answer: async () => auditFixture({ rows: [] }) });

      expect(activity.isEmpty).toBe(false);
      expect(activity.countLabel).toBe('0 entries');

      await activity.load();

      expect(activity.isEmpty).toBe(true);
      expect(activity.auditingOff).toBe(false);
    });
  });

  it('keeps the answer of the last load when two are in flight', async () => {
    const pending: ((response: AuditResponse) => void)[] = [];
    const { activity } = makeActivity({
      answer: () => new Promise<AuditResponse>((resolveWith) => pending.push(resolveWith)),
    });

    const first = activity.load();
    const second = activity.load();

    // The stale one answers last, and is thrown away for being stale rather than for being late
    pending[1](auditFixture({ rows: [auditRow({ operation: 'Suspend' })] }));
    pending[0](auditFixture());

    await Promise.all([first, second]);

    expect(activity.rows.map((row) => row.operation)).toEqual(['Suspend']);
    expect(activity.loading).toBe(false);
  });

  it('says why it could not refresh, once per outage, and keeps the rows it had', async () => {
    let fail = false;
    const { app, activity } = makeActivity({
      answer: async () => {
        if (fail) {
          throw new Error('500 Internal Server Error');
        }

        return auditFixture();
      },
    });

    await activity.load();
    fail = true;
    await activity.load();

    expect(activity.error).toBe('500 Internal Server Error');
    expect(activity.rows).toHaveLength(6);
    expect(app.toast.current?.message).toBe(`${ACTIVITY_FAILED}. 500 Internal Server Error`);
    expect(app.toast.current?.retry).toBeTypeOf('function');

    app.toast.dismiss();
    await activity.load();

    // An endpoint that is down stays down; saying so every five seconds helps nobody
    expect(app.toast.current).toBeNull();

    fail = false;
    await activity.load();
    fail = true;
    await activity.load();

    // ...and the next outage is a new one
    expect(app.toast.current?.message).toBe(`${ACTIVITY_FAILED}. 500 Internal Server Error`);
  });

  it('refreshes the first page on the interval in the preferences, and stops when it is told to', async () => {
    vi.useFakeTimers();

    const { app, activity, queries } = makeActivity({ answer: async () => auditFixture({ hasMore: true }) });

    await activity.load();
    await activity.loadMore();

    app.setAutoRefresh('instances', 5);
    activity.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(5_000);

    // The page someone is looking at, not the ones they paged past
    expect(queries.at(-1)?.skip).toBe(0);
    expect(queries).toHaveLength(3);

    activity.stopAutoRefresh();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(queries).toHaveLength(3);
  });

  it('does not start a timer when auto-refresh is off', async () => {
    vi.useFakeTimers();

    const { app, activity, queries } = makeActivity();

    app.setAutoRefresh('instances', 0);
    activity.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(queries).toEqual([]);
  });
});
