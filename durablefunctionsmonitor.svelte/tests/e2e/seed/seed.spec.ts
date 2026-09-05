// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEFAULT_HUB, buildSeedData } from './fixtures.mjs';

/**
 * Proves the seeded hub is readable by the Durable Task client the standalone host runs on: the rows
 * `seed-hub.mjs` wrote come back out of `/orchestrations`, one for one.
 *
 * Runs in the e2e project (`playwright.config.ts`, E3-S2-T3), whose `globalSetup` seeds the hub first.
 */

/** The hub override, read without pulling Node's typings into the browser-side program. */
const hub =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DFM_E2E_HUB ?? DEFAULT_HUB;

/** Rebuilt against the same fixtures the seed wrote; only ids and statuses are compared, never timestamps. */
const seeded = buildSeedData(hub);

/** Wide enough that the run's own clock cannot matter. */
const everySeededInstance = "createdTime ge '2000-01-01T00:00:00Z' and createdTime le '2100-01-01T00:00:00Z'";

interface ListedInstance {
  instanceId: string;
  name: string;
  runtimeStatus: string;
  entityType: string;
}

async function listInstances(request: APIRequestContext) {
  // One page big enough to hold the whole hub: the paging filler of E4-S9-T1 and the instances the
  // specs themselves start would otherwise push the mockup's own rows off a 50-row page
  const query = new URLSearchParams({ $top: '1000', $filter: everySeededInstance });
  // Relative: Playwright's baseURL carries the host's route prefix, which a leading slash would drop
  const response = await request.get(`a/p/i/--${hub}/orchestrations?${query}`);

  expect(response.status()).toBe(200);

  return (await response.json()) as ListedInstance[];
}

test('the seeded orchestrations all come back from /orchestrations', async ({ request }) => {
  const listed = await listInstances(request);
  const ids = listed.map((instance) => instance.instanceId);

  expect(ids.length).toBeGreaterThanOrEqual(seeded.orchestrations.length);

  for (const instance of seeded.orchestrations) {
    expect(ids, `${instance.instanceId} was seeded but not listed`).toContain(instance.instanceId);
  }
});

test('the seeded orchestrations keep their name and status', async ({ request }) => {
  const listed = await listInstances(request);
  const byId = new Map(listed.map((instance) => [instance.instanceId, instance]));

  for (const instance of seeded.orchestrations) {
    expect(byId.get(instance.instanceId)).toMatchObject({
      name: instance.name,
      runtimeStatus: instance.runtimeStatus,
    });
  }

  const failed = seeded.orchestrations.filter((instance) => instance.runtimeStatus === 'Failed');
  expect(listed.filter((instance) => instance.runtimeStatus === 'Failed')).toHaveLength(failed.length);
});
