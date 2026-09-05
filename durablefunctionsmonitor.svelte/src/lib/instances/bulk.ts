// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Running a bulk action. A backend that answers `capabilities.batch` does the whole thing in one
// request (B3); everything else - which is every version of the backend before this one - is fanned
// out from here, eight at a time, and every id's outcome is kept rather than the first failure
// (React `BatchOpsDialogState.execute`). Either way the caller gets the same `BatchResponse`, so
// nothing above this line has to know which of the two happened.

import { BackendError } from '$lib/api/client';
import type { BatchAction, BatchResponse, BatchResultItem } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import type { BulkPayload } from './bulk-defs';

/** How many requests are in flight at once when the fan-out runs (React's own limit). */
export const BULK_CONCURRENCY = 8;

/**
 * How many ids go into one `/orchestrations/batch` request. The endpoint runs them with bounded
 * parallelism of its own, so this is about the request rather than about the work: a body of ten
 * thousand ids is one timeout away from telling the user nothing at all about any of them.
 */
export const BATCH_CHUNK = 200;

export interface BulkRequest {
  action: BatchAction;
  ids: string[];
  payload?: BulkPayload;
}

export async function runBulk(app: AppState, request: BulkRequest): Promise<BatchResponse> {
  const started = Date.now();

  if (app.capabilities.batch) {
    return await runBatched(app, request);
  }

  const results = await app.track(() =>
    fanOut(request.ids, (instanceId) => callOne(app, request, instanceId), BULK_CONCURRENCY),
  );

  const okCount = results.filter((result) => result.ok).length;

  return {
    action: request.action,
    results,
    okCount,
    failedCount: results.length - okCount,
    elapsedMs: Date.now() - started,
  };
}

/**
 * The batch endpoint, two hundred ids at a time and one chunk after another - the chunks are not run
 * together, because the point of the endpoint is that the backend decides how much of this hub to
 * hit at once. The chunks' results are concatenated in the order the ids came in, so the caller sees
 * one answer whether it was one request or five.
 */
async function runBatched(app: AppState, request: BulkRequest): Promise<BatchResponse> {
  const results: BatchResultItem[] = [];
  let okCount = 0;
  let failedCount = 0;
  let elapsedMs = 0;

  for (let from = 0; from < request.ids.length; from += BATCH_CHUNK) {
    const instanceIds = request.ids.slice(from, from + BATCH_CHUNK);

    try {
      const response = await app.track(() =>
        app.endpoints.batch({ action: request.action, instanceIds, payload: request.payload }),
      );

      results.push(...response.results);
      okCount += response.okCount;
      failedCount += response.failedCount;
      elapsedMs += response.elapsedMs;
    } catch (error) {
      // Nothing has happened yet: the caller's own error is a better report than 200 failed ids
      if (from === 0) {
        throw error;
      }

      // ...but once some ids have run, the result list is the only way to say which did not
      for (const instanceId of instanceIds) {
        results.push({
          instanceId,
          ok: false,
          status: error instanceof BackendError ? error.status : 0,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      failedCount += instanceIds.length;
    }
  }

  return { action: request.action, results, okCount, failedCount, elapsedMs };
}

/** `Terminate 3 instances · 2 ok, 1 failed` - a success while nothing failed, an error otherwise. */
export function bulkToast(app: AppState, confirmLabel: string, response: BatchResponse): void {
  const message = `${confirmLabel} · ${response.okCount} ok, ${response.failedCount} failed`;

  if (response.failedCount === 0) {
    app.toast.ok(message);
    return;
  }

  app.toast.error(message);
}

/**
 * Runs `worker` over the ids with at most `limit` of them in flight, keeping the results in the
 * order the ids came in. A worker never rejects - `callOne` turns a failure into a result - so one
 * bad id cannot stop the rest.
 */
async function fanOut<T>(ids: string[], worker: (id: string) => Promise<T>, limit: number): Promise<T[]> {
  const results = new Array<T>(ids.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, ids.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;

      if (index >= ids.length) {
        return;
      }

      results[index] = await worker(ids[index]);
    }
  });

  await Promise.all(runners);

  return results;
}

async function callOne(app: AppState, request: BulkRequest, instanceId: string): Promise<BatchResultItem> {
  try {
    await dispatch(app, request, instanceId);

    // The endpoints answer 200 with no body; nothing finer is known about a success
    return { instanceId, ok: true, status: 200 };
  } catch (error) {
    return {
      instanceId,
      ok: false,
      status: error instanceof BackendError ? error.status : 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function dispatch(app: AppState, request: BulkRequest, instanceId: string): Promise<void> {
  const payload = request.payload ?? {};

  switch (request.action) {
    case 'suspend':
    case 'resume':
    case 'rewind':
    case 'terminate':
      return app.endpoints.postAction(instanceId, request.action, payload.reason ?? '');

    case 'raise-event':
      return app.endpoints.raiseEvent(instanceId, payload.name ?? '', payload.data);

    case 'set-custom-status':
      return app.endpoints.setCustomStatus(instanceId, payload.customStatus ?? null);

    case 'restart':
      return app.endpoints.restart(instanceId, payload.restartWithNewInstanceId ?? false);

    case 'purge':
      return app.endpoints.purge(instanceId);
  }
}
