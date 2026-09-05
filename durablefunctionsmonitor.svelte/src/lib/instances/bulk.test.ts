// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { ConflictError } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { BatchRequest, Capabilities } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from '$lib/state/app.svelte';
import { Prefs } from '$lib/state/prefs.svelte';
import { BackendError } from '$lib/api/client';
import { BATCH_CHUNK, BULK_CONCURRENCY, bulkToast, runBulk } from './bulk';
import { BULK_BATCH_NOTE, BULK_FANOUT_NOTE, bulkNote } from './bulk-defs';

function makeApp(endpoints: Partial<Endpoints>, capabilities: Partial<Capabilities> = {}) {
  window.history.replaceState({}, '', '/DurableFunctionsHub/instances');

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: endpoints as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub', capabilities: capabilities as Capabilities });

  return app;
}

describe('runBulk', () => {
  it('fans out one request per instance and keeps every outcome', async () => {
    const postAction = vi.fn(async (instanceId: string) => {
      if (instanceId === 'b') {
        throw new ConflictError('409 Conflict: instance is not running');
      }
    });

    const app = makeApp({ postAction });

    const response = await runBulk(app, { action: 'terminate', ids: ['a', 'b', 'c'], payload: { reason: 'why' } });

    expect(response.okCount).toBe(2);
    expect(response.failedCount).toBe(1);
    expect(response.results.map((result) => result.instanceId)).toEqual(['a', 'b', 'c']);
    expect(response.results[1]).toMatchObject({
      ok: false,
      status: 409,
      message: '409 Conflict: instance is not running',
    });

    // The reason goes in the body, as the action endpoints take it
    expect(postAction).toHaveBeenCalledWith('a', 'terminate', 'why');
  });

  it('sends the same event and payload to every instance', async () => {
    const raiseEvent = vi.fn(async () => {});
    const app = makeApp({ raiseEvent });

    await runBulk(app, {
      action: 'raise-event',
      ids: ['a', 'b'],
      payload: { name: 'PaymentApproved', data: { approved: true } },
    });

    expect(raiseEvent).toHaveBeenCalledTimes(2);
    expect(raiseEvent).toHaveBeenLastCalledWith('b', 'PaymentApproved', { approved: true });
  });

  it('purges through the purge endpoint', async () => {
    const purge = vi.fn(async () => {});
    const app = makeApp({ purge });

    const response = await runBulk(app, { action: 'purge', ids: ['a'] });

    expect(purge).toHaveBeenCalledWith('a');
    expect(response.okCount).toBe(1);
  });

  it('never has more than eight requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;

    const release: (() => void)[] = [];

    const postAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);

          release.push(() => {
            inFlight -= 1;
            resolve();
          });
        }),
    );

    const app = makeApp({ postAction });

    const ids = Array.from({ length: 20 }, (_, index) => `id-${index}`);
    const running = runBulk(app, { action: 'suspend', ids });

    // Let the first wave start, then drain the queue one by one
    await Promise.resolve();
    expect(peak).toBe(BULK_CONCURRENCY);

    for (let index = 0; index < ids.length; index += 1) {
      await waitForCall(release, index + 1);
      release[index]();
    }

    const response = await running;

    expect(response.okCount).toBe(20);
    expect(peak).toBe(BULK_CONCURRENCY);
  });

  it('uses the batch endpoint when the backend has one', async () => {
    const batch = vi.fn(async (request: BatchRequest) => ({
      action: request.action,
      results: request.instanceIds.map((instanceId) => ({ instanceId, ok: true, status: 200 })),
      okCount: request.instanceIds.length,
      failedCount: 0,
      elapsedMs: 12,
    }));

    const postAction = vi.fn(async () => {});
    const app = makeApp({ batch, postAction }, { batch: true });

    const response = await runBulk(app, { action: 'suspend', ids: ['a', 'b'], payload: { reason: 'why' } });

    expect(batch).toHaveBeenCalledWith({ action: 'suspend', instanceIds: ['a', 'b'], payload: { reason: 'why' } });
    expect(postAction).not.toHaveBeenCalled();
    expect(response.okCount).toBe(2);
  });

  it('cuts a long selection into requests the endpoint can answer, and merges what they say', async () => {
    const sizes: number[] = [];
    let inFlight = 0;
    let overlapped = false;

    const batch = vi.fn(async (request: BatchRequest) => {
      sizes.push(request.instanceIds.length);
      overlapped ||= inFlight > 0;
      inFlight += 1;

      await Promise.resolve();

      inFlight -= 1;

      return {
        action: request.action,
        // The last id of each chunk is refused, so the merged counts have both halves in them
        results: request.instanceIds.map((instanceId, index) => ({
          instanceId,
          ok: index < request.instanceIds.length - 1,
          status: index < request.instanceIds.length - 1 ? 200 : 409,
        })),
        okCount: request.instanceIds.length - 1,
        failedCount: 1,
        elapsedMs: 10,
      };
    });

    const app = makeApp({ batch }, { batch: true });

    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`);
    const response = await runBulk(app, { action: 'purge', ids });

    expect(sizes).toEqual([BATCH_CHUNK, 50]);
    expect(batch.mock.calls[1][0].instanceIds[0]).toBe('id-200');

    // One chunk at a time: the backend decides how much of the hub to hit at once, not this
    expect(overlapped).toBe(false);

    expect(response.okCount).toBe(248);
    expect(response.failedCount).toBe(2);
    expect(response.elapsedMs).toBe(20);
    expect(response.results.map((result) => result.instanceId)).toEqual(ids);

    bulkToast(app, 'Purge 250 instances', response);
    expect(app.toast.current?.message).toBe('Purge 250 instances · 248 ok, 2 failed');
  });

  it('throws when the first request fails, because nothing has happened yet', async () => {
    const batch = vi.fn(async () => {
      throw new BackendError(500, '500 Internal Server Error');
    });

    const app = makeApp({ batch }, { batch: true });

    await expect(runBulk(app, { action: 'purge', ids: ['a', 'b'] })).rejects.toThrow('500 Internal Server Error');
  });

  it('reports the ids of a later request that failed, because the ones before it ran', async () => {
    const batch = vi.fn(async (request: BatchRequest) => {
      if (request.instanceIds[0] !== 'id-0') {
        throw new BackendError(503, '503 Service Unavailable');
      }

      return {
        action: request.action,
        results: request.instanceIds.map((instanceId) => ({ instanceId, ok: true, status: 200 })),
        okCount: request.instanceIds.length,
        failedCount: 0,
        elapsedMs: 8,
      };
    });

    const app = makeApp({ batch }, { batch: true });

    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`);
    const response = await runBulk(app, { action: 'purge', ids });

    expect(response.okCount).toBe(200);
    expect(response.failedCount).toBe(50);
    expect(response.results).toHaveLength(250);
    expect(response.results[249]).toEqual({
      instanceId: 'id-249',
      ok: false,
      status: 503,
      message: '503 Service Unavailable',
    });
  });
});

describe('bulkNote', () => {
  it('says how the action will actually reach the backend', () => {
    expect(bulkNote(true)).toBe(BULK_BATCH_NOTE);
    expect(bulkNote(true)).toBe(
      'POST /orchestrations/batch · runs with bounded parallelism · the result lists ok and failed ids.',
    );
    expect(bulkNote(false)).toBe(BULK_FANOUT_NOTE);
  });
});

describe('bulkToast', () => {
  it('says what happened, as a success only when nothing failed', () => {
    const app = makeApp({});

    bulkToast(app, 'Terminate 3 instances', {
      action: 'terminate',
      results: [],
      okCount: 2,
      failedCount: 1,
      elapsedMs: 1,
    });

    expect(app.toast.current).toMatchObject({
      kind: 'error',
      message: 'Terminate 3 instances · 2 ok, 1 failed',
    });

    bulkToast(app, 'Purge 2 instances', { action: 'purge', results: [], okCount: 2, failedCount: 0, elapsedMs: 1 });

    expect(app.toast.current).toMatchObject({ kind: 'ok', message: 'Purge 2 instances · 2 ok, 0 failed' });
  });
});

/** Waits until `count` requests have been started. */
async function waitForCall(release: (() => void)[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && release.length < count; attempt += 1) {
    await Promise.resolve();
  }
}
