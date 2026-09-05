// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Failures screen against the real host (E9-S4-T1): the groups `/failures` (B3) makes out of the
// seeded failures, the recoveries a group offers, and what the range does to all of it.
//
// The six instances this spec rewinds are its own - it seeds them and deletes them again - because a
// rewind changes an instance, and every other spec reads the same hub.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectToast, gotoHub, hub, hubPath } from './fixtures';
import { FAILED_INSTANCE_ID, buildRetryInstance } from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** The signatures B3 normalises the seeded failures into (`FailureSignature.Normalize`). */
const INVENTORY = 'InventoryUnavailable: SKU-* has * units in warehouse-*';
const TIMEOUT = 'Timeout: ChargePayment did not complete within * s';

/** What `buildRetryInstance` fails with; it has no numbers, so the signature is the message. */
const REFUSED = 'ChargePayment: the payment gateway refused the approved amount';

/** How many of them this spec seeds, which is what its group's buttons then count. */
const OWNED = 6;

const owned: string[] = [];

test.beforeAll(async () => {
  const stamp = Date.now();

  /*
   * `buildRetryInstance` dates its instance fifteen minutes back, which is exactly the narrowest
   * range this screen offers - so the clock it is built against is pushed forward, leaving them a
   * couple of minutes old and inside every range the spec picks.
   */
  const clock = new Date(stamp + 800_000);

  for (let index = 0; index < OWNED; index += 1) {
    owned.push(`e2e-failures-${stamp}-${index}`);
  }

  await seedInstances({ hub, instances: owned.map((instanceId) => buildRetryInstance(instanceId, clock)) });
});

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: owned });
});

function groups(page: Page): Locator {
  return page.locator('.group');
}

/** The group whose signature is this one, whichever row of the page it is on. */
function group(page: Page, signature: string): Locator {
  return groups(page).filter({ has: page.locator('.ghead .mono', { hasText: signature }) });
}

function rowsOf(group: Locator): Locator {
  return group.locator('.frow');
}

/**
 * Expands a group, if the screen has not already. Which group opens itself is the biggest one, and
 * this spec seeds a group of its own that is exactly as big as the biggest seeded one - so a spec
 * that clicked blindly would be closing one of them half the time.
 */
async function open(group: Locator): Promise<void> {
  if ((await group.getAttribute('aria-expanded')) !== 'true') {
    await group.locator('.ghead').click();
  }

  await expect(group).toHaveAttribute('aria-expanded', 'true');
}

test('groups the failures of the range by what went wrong', async ({ page }) => {
  await gotoHub(page, 'failures');

  await expect(page.getByRole('heading', { name: 'Failures', level: 1 })).toBeVisible();
  await expect(groups(page).first()).toBeVisible();

  // The loudest first: six orders could not be reserved, and both of the ChargePayment timeouts
  const inventory = group(page, INVENTORY);

  await expect(inventory).toHaveCount(1);
  await expect(inventory.locator('.ghead .chip')).toHaveText('6');
  await expect(inventory.locator('.ghead')).toContainText('ProcessOrderOrchestrator');

  // The first group is open and the rest are not (ScreenFailures.dc.html L96)
  await expect(groups(page).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(groups(page).nth(1)).toHaveAttribute('aria-expanded', 'false');

  await open(inventory);
  await expect(rowsOf(inventory)).toHaveCount(6);

  const timeout = group(page, TIMEOUT);

  await expect(timeout).toHaveAttribute('aria-expanded', 'false');
  await expect(timeout.locator('.ghead .chip')).toHaveText('2');
  await expect(rowsOf(timeout)).toHaveCount(0);

  // ...until it is opened, where it stands
  await open(timeout);

  await expect(rowsOf(timeout)).toHaveCount(2);
  await expect(rowsOf(timeout).first().locator('.reason')).toHaveText(
    'Timeout: ChargePayment did not complete within 20 s',
  );

  // The scan the numbers came from, and how the signatures above were made
  await expect(page.locator('.ptitle .fine.muted')).toHaveText(
    /^scanned [\d,]+ · (full|partial) · signatures normalise numbers, GUIDs and quoted values to \*$/,
  );
});

test('badges the navigation with what the screen counted', async ({ page }) => {
  await gotoHub(page, 'failures');

  await expect(groups(page).first()).toBeVisible();

  const total = (await page.locator('.ptitle .meta .chip').textContent())?.trim();

  expect(Number(total)).toBeGreaterThanOrEqual(8 + OWNED);
  await expect(page.locator('.snav .cnt')).toHaveText(total ?? '');

  // ...and the count follows the user to a screen that does not load it itself
  await page.locator('.snav .item', { hasText: 'Overview' }).click();

  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  await expect(page.locator('.snav .cnt')).toHaveText(total ?? '');
});

test('opens a failed instance where its input is', async ({ page }) => {
  await gotoHub(page, 'failures');

  const inventory = group(page, INVENTORY);

  await open(inventory);

  const row = rowsOf(inventory).filter({ hasText: FAILED_INSTANCE_ID });

  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name: FAILED_INSTANCE_ID })).toBeVisible();

  await row.getByRole('button', { name: 'Update input' }).click();

  await expect(page).toHaveURL(/tab=inputs/);
  await expect(page.locator('.tabs .tab[aria-selected="true"]')).toHaveText('Inputs');
});

test('rewinds a whole group through the batch endpoint', async ({ page }) => {
  const posted: string[] = [];
  const loads: string[] = [];

  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/orchestrations/batch')) {
      posted.push(request.postData() ?? '');
    }

    if (request.method() === 'GET' && request.url().includes('/failures?')) {
      loads.push(request.url());
    }
  });

  await gotoHub(page, 'failures');

  const mine = group(page, REFUSED);

  await expect(mine.locator('.ghead .chip')).toHaveText(String(OWNED));

  await open(mine);
  await expect(rowsOf(mine)).toHaveCount(OWNED);

  await mine.getByRole('button', { name: `Rewind all ${OWNED}` }).click();

  const dialog = page.getByRole('dialog', { name: `Rewind ${OWNED} instances` });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Re-runs only the failed steps of each instance.');
  await expect(dialog.locator('.ed.ro pre')).toContainText(owned[0]);

  // The batch endpoint is what the dialog says it will use, and it says so because /about does
  await expect(dialog.locator('.meta')).toHaveText(
    'POST /orchestrations/batch · runs with bounded parallelism · the result lists ok and failed ids.',
  );

  await dialog.getByLabel('Reason (optional)').fill('e2e');

  const asked = loads.length;

  await dialog.getByRole('button', { name: `Rewind all ${OWNED}` }).click();

  await expectToast(page, `Rewind all ${OWNED} · ${OWNED} ok, 0 failed`);
  await expect(dialog).toBeHidden();

  // One request for all six of them, with the reason the dialog asked for
  expect(posted).toHaveLength(1);
  expect(JSON.parse(posted[0])).toMatchObject({
    action: 'rewind',
    instanceIds: owned,
    payload: { reason: 'e2e' },
  });

  /*
   * ...and the screen asked the backend again, because a recovery changes what it was showing. What
   * comes back still holds this group: the host accepted the rewinds and queued them, and nothing
   * ever runs them - the monitor has no orchestrator worker of its own, so the rows stay Failed
   * until the application that owns them picks the work up.
   */
  await expect.poll(() => loads.length).toBeGreaterThan(asked);
  await expect(group(page, REFUSED)).toHaveCount(1);
});

test('shows only what really failed in the range it is given', async ({ page }) => {
  await gotoHub(page, 'failures');

  await expect(group(page, TIMEOUT)).toHaveCount(1);

  await page.getByRole('button', { name: 'Time range' }).click();
  await page.getByRole('option', { name: 'Last 15 minutes' }).click();

  // Both timeouts are hours old, so that whole group leaves the screen
  await expect(group(page, TIMEOUT)).toHaveCount(0);
  await expect(page).toHaveURL(/range=15m/);

  // A window with nothing in it at all is the empty state, which says how to widen it
  await page.goto(hubPath('failures?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z'));

  await expect(page.getByRole('heading', { name: 'No failures' })).toBeVisible();
  await expect(page.locator('.empty p')).toHaveText(
    /^Nothing failed in the .+\. Widen the range to look further back\.$/,
  );
  await expect(groups(page)).toHaveCount(0);
});
