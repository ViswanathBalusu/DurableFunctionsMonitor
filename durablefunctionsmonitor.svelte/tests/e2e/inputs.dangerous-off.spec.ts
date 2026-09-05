// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Inputs tab against a deployment that has dangerous operations switched off (E5-S9-T1). This
// runs in its own Playwright project, against a second host of the same build started with
// `DFM_DANGEROUS_OPERATIONS_ENABLED=false` - the difference is the backend's, not the app's, and the
// point of the spec is that the app shows exactly what that backend says.

import { expect, test } from '@playwright/test';
import { gotoInstance, hub } from './fixtures';
import { RETRY_EVENT_SEQUENCE_NUMBER, buildRetryInstance } from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

const DANGEROUS_OFF_REASON =
  'Dangerous operations are disabled for this deployment (DFM_DANGEROUS_OPERATIONS_ENABLED).';

/** What this file seeded, so it can take it out again: the hub is left as it was found. */
const seeded: string[] = [];

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: seeded });
});

test('says the switch is off, and disables the two operations it governs', async ({ page }) => {
  const instanceId = `e2e-dangerous-off-${Date.now()}`;

  await seedInstances({ hub, instances: [buildRetryInstance(instanceId, new Date())] });
  seeded.push(instanceId);

  await gotoInstance(page, instanceId, 'inputs');

  await expect(page.getByRole('heading', { name: 'Inputs this instance received', level: 2 })).toBeVisible();

  // No badge; a muted chip in its place, so an operator learns the switch exists (design §9)
  await expect(page.locator('.tabbody .dbadge')).toHaveCount(0);
  await expect(page.getByText('Dangerous operations off')).toBeVisible();

  const cards = page.locator('.card.icard');

  await expect(cards).toHaveCount(2);

  const last = cards.nth(1);
  const replay = last.locator('.op').filter({ hasText: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` });

  await expect(replay.locator('.btn')).toBeDisabled();
  await expect(replay.locator('.why')).toHaveText(DANGEROUS_OFF_REASON);

  // The rewind is a Write operation, not a Dangerous one: it is still offered
  const rewind = last.locator('.op').filter({ hasText: 'Update input and rewind' });

  await expect(rewind.locator('.btn')).toBeEnabled();
  await expect(rewind.locator('.why')).toHaveText('Replaces this input and re-runs only the failed steps.');
});

test('refuses the restart of an instance that never received an event', async ({ page }) => {
  const instanceId = `e2e-dangerous-off-restart-${Date.now()}`;
  const instance = buildRetryInstance(instanceId, new Date());

  // Without the EventRaised row the initial input is the last one, which is the only case where
  // restart-in-place is ever offered - and this deployment refuses it anyway
  instance.history = instance.history.filter((row) => row.eventType !== 'EventRaised');

  await seedInstances({ hub, instances: [instance] });
  seeded.push(instanceId);

  await gotoInstance(page, instanceId, 'inputs');

  const restart = page.locator('.card.icard').first().locator('.op').filter({ hasText: 'Restart in place' });

  await expect(restart.locator('.btn')).toBeDisabled();
  await expect(restart.locator('.why')).toHaveText(DANGEROUS_OFF_REASON);
});
