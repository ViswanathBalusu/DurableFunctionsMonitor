// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import { AppState } from './app.svelte';
import { DEFAULT_PURGE_STATUSES, PurgeHistory } from './purge-history.svelte';
import { Router } from '$lib/router.svelte';
import { host } from '$lib/host.svelte';
import { Prefs } from './prefs.svelte';

function makeApp(endpoints: Partial<Endpoints> = {}): AppState {
  return new AppState({
    host,
    endpoints: endpoints as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, {
      setItem: () => {},
      setItems: () => {},
      getItem: () => null,
      removeItem: () => {},
    }),
  });
}

describe('PurgeHistory', () => {
  it('opens on the last 24 hours with the three statuses of the mockup', () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    const purge = new PurgeHistory({ app: makeApp() });

    purge.reset(now);

    expect(purge.timeTill).toBe('2026-09-05T12:00:00.000Z');
    expect(purge.timeFrom).toBe('2026-09-04T12:00:00.000Z');
    expect(new Date(purge.timeTill!).getTime() - new Date(purge.timeFrom!).getTime()).toBe(24 * 3600_000);
    expect(purge.statuses).toEqual([...DEFAULT_PURGE_STATUSES]);
    expect(purge.includeEntities).toBe(false);
    expect(purge.result).toBeNull();
  });

  it('keeps the statuses in the order the dialog shows them, whatever the order of the clicks', () => {
    const purge = new PurgeHistory({ app: makeApp() });

    purge.toggle('Completed', false);
    purge.toggle('Terminated', false);
    purge.toggle('Canceled', false);

    expect(purge.statuses).toEqual([]);
    expect(purge.valid).toBe(false);

    purge.toggle('Canceled', true);
    purge.toggle('Completed', true);
    purge.toggle('Failed', true);

    expect(purge.statuses).toEqual(['Completed', 'Failed', 'Canceled']);
    expect(purge.has('Terminated')).toBe(false);
    expect(purge.valid).toBe(true);
  });

  it('is not valid while a date the backend could not read is in the field', () => {
    const purge = new PurgeHistory({ app: makeApp() });

    expect(purge.valid).toBe(true);

    purge.timeTill = null;
    expect(purge.valid).toBe(false);

    purge.timeTill = 'the day before yesterday';
    expect(purge.valid).toBe(false);
  });

  it('posts the range, the checked statuses and the entity type, then says what went', async () => {
    const purgeHistory = vi.fn<Endpoints['purgeHistory']>(async () => ({ instancesDeleted: 412 }));
    const app = makeApp({ purgeHistory });
    const refresh = vi.spyOn(app, 'refresh');

    const purge = new PurgeHistory({ app });

    purge.reset(new Date('2026-09-05T12:00:00.000Z'));
    purge.toggle('Failed', true);

    await purge.run();

    expect(purgeHistory.mock.calls[0][0]).toEqual({
      timeFrom: '2026-09-04T12:00:00.000Z',
      timeTill: '2026-09-05T12:00:00.000Z',
      statuses: ['Completed', 'Terminated', 'Failed', 'Canceled'],
      entityType: 'Orchestration',
    });

    expect(purge.result).toBe(412);
    expect(app.toast.current?.message).toBe('Purged 412 instances');
    expect(refresh).toHaveBeenCalledOnce();
    expect(purge.busy).toBe(false);
  });

  it('purges entities as their own entity type', async () => {
    const purgeHistory = vi.fn<Endpoints['purgeHistory']>(async () => ({ instancesDeleted: 0 }));
    const purge = new PurgeHistory({ app: makeApp({ purgeHistory }) });

    purge.includeEntities = true;

    expect(purge.entityType).toBe('DurableEntity');

    await purge.run();

    expect(purgeHistory.mock.calls[0][0].entityType).toBe('DurableEntity');
  });

  it('keeps the filter and says why when the purge fails', async () => {
    const app = makeApp({
      purgeHistory: async () => {
        throw new Error('400 Purging entities is not supported in Isolated mode');
      },
    });

    const purge = new PurgeHistory({ app });

    expect(await purge.run()).toBeNull();

    expect(app.toast.current?.kind).toBe('error');
    expect(app.toast.current?.message).toBe(
      'Failed to purge history. 400 Purging entities is not supported in Isolated mode',
    );
    expect(purge.result).toBeNull();
    expect(purge.statuses).toEqual([...DEFAULT_PURGE_STATUSES]);
    expect(purge.busy).toBe(false);
  });

  it('sends nothing when no status is checked', async () => {
    const purgeHistory = vi.fn(async () => ({ instancesDeleted: 1 }));
    const purge = new PurgeHistory({ app: makeApp({ purgeHistory }) });

    for (const status of [...DEFAULT_PURGE_STATUSES]) {
      purge.toggle(status, false);
    }

    expect(await purge.run()).toBeNull();
    expect(purgeHistory).not.toHaveBeenCalled();
  });
});
