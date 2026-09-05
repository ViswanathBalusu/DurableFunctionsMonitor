// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Activity screen against the real host (E11-S2-T1): the middleware writes an audit row for every
// Write and Dangerous call, and this is the screen that reads them back. The host runs with
// DFM_AUDIT_ENABLED=true (playwright.config.ts), and authentication is off through DFM_NONCE, which is
// why every row here is `anonymous`.
//
// The trail is a table in the hub and outlives a run, so nothing here counts rows: what this spec
// wrote is at the top, because the order is newest first, and that is what it asserts.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectToast, gotoHub, gotoInstance, hub } from './fixtures';
import {
  RETRY_EVENT_SEQUENCE_NUMBER,
  RUNNING_INSTANCE_ID,
  SUSPENDED_INSTANCE_ID,
  buildRetryInstance,
} from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** The instance this spec replays - a replay rewrites history, so it has to be one of its own. */
const OWNED_ID = `e2e-activity-${Date.now()}`;

test.beforeAll(async () => {
  await seedInstances({ hub, instances: [buildRetryInstance(OWNED_ID, new Date())] });
});

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: [OWNED_ID] });
});

function rows(page: Page): Locator {
  return page.locator('.tbl tbody tr');
}

/** The cells of one row, as text: time, user, operation, instance, outcome, details. */
async function cellsOf(row: Locator): Promise<string[]> {
  return (await row.locator('td').allTextContents()).slice(1).map((cell) => cell.replace(/\s+/g, ' ').trim());
}

/**
 * Opens Activity and waits until the trail this spec just wrote is readable. The middleware writes
 * its record after the response is already on its way (fire and forget, so auditing can never slow a
 * call down), which means a row can be a moment behind the toast that reported it.
 */
async function openActivity(page: Page, expected: string): Promise<void> {
  await expect(async () => {
    await gotoHub(page, 'activity');
    await expect(rows(page).first().locator('td').nth(3)).toContainText(expected, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

test('records the three calls it makes, newest first', async ({ page }) => {
  // 1. A suspend of the hub's running order. Nothing consumes the control queue, so this is only
  //    ever enqueued - the audit row is about the call, which is what was really made
  await gotoInstance(page, RUNNING_INSTANCE_ID);
  await page.locator('.hero .actions').getByRole('button', { name: 'Suspend' }).click();
  await page
    .getByRole('dialog', { name: `Suspend ${RUNNING_INSTANCE_ID}` })
    .getByRole('button', { name: 'Suspend' })
    .click();
  await expectToast(page, `Suspended ${RUNNING_INSTANCE_ID}`);

  // 2. A resume of the one instance a resume can be sent to: the suspended order
  await gotoInstance(page, SUSPENDED_INSTANCE_ID);
  await page.locator('.hero .actions').getByRole('button', { name: 'Resume' }).click();
  await page
    .getByRole('dialog', { name: `Resume ${SUSPENDED_INSTANCE_ID}` })
    .getByRole('button', { name: 'Resume' })
    .click();
  await expectToast(page, `Resumed ${SUSPENDED_INSTANCE_ID}`);

  // 3. ...and a replay, which is a Dangerous operation and the only one of the three that runs
  await gotoInstance(page, OWNED_ID, 'inputs');
  await page
    .locator('.card.icard')
    .nth(1)
    .getByRole('button', { name: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` })
    .click();

  const replay = page.getByRole('dialog', { name: `Replay from event #${RETRY_EVENT_SEQUENCE_NUMBER}` });

  await replay.getByRole('button', { name: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` }).click();
  await expectToast(page, new RegExp(`Replayed from #${RETRY_EVENT_SEQUENCE_NUMBER}, \\d+ history rows removed`));

  await openActivity(page, 'Replay');

  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();

  const [first, second, third] = [rows(page).nth(0), rows(page).nth(1), rows(page).nth(2)];

  // The three calls in the order they were made, read from the newest end (ScreenActivity.dc.html L29)
  expect(await cellsOf(first)).toEqual([
    expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    'anonymous',
    'Replay dangerous',
    OWNED_ID,
    'ok',
    // The replay endpoint records no message of its own, so there is nothing more to say about it
    // than the operation and the outcome (see the note under B5-S2-T2)
    '—',
  ]);

  expect(await cellsOf(second)).toEqual([
    expect.anything(),
    'anonymous',
    'Resume',
    SUSPENDED_INSTANCE_ID,
    'ok',
    // A call that worked is fully described by its operation: the backend records no message for it
    '—',
  ]);

  expect(await cellsOf(third)).toEqual([expect.anything(), 'anonymous', 'Suspend', RUNNING_INSTANCE_ID, 'ok', '—']);

  // Only the dangerous one is tagged, and the spine of an `ok` row is the completed colour
  await expect(first.locator('.tag')).toHaveText('dangerous');
  await expect(second.locator('.tag')).toHaveCount(0);
  await expect(first).toHaveAttribute('data-st', 'Completed');

  await expect(page.locator('.tfoot .meta')).toHaveText('PartitionKey yyyyMMdd · RowKey reverse ticks · newest first');
});

test('narrows the trail to one operation', async ({ page }) => {
  await gotoHub(page, 'activity');

  await page.getByRole('button', { name: 'Operation' }).click();
  await page.getByRole('option', { name: 'Replay' }).click();

  await expect(page).toHaveURL(/operation=Replay/);

  // Every row that is left is a replay, and a replay is dangerous whoever ran it
  const operations = await rows(page).locator('td[data-label="operation"]').allTextContents();

  expect(operations.length).toBeGreaterThan(0);

  for (const operation of operations) {
    expect(operation.replace(/\s+/g, ' ').trim()).toBe('Replay dangerous');
  }

  // ...and an operation that nothing in this hub has ever run has nothing to show
  await page.getByRole('button', { name: 'Operation' }).click();
  await page.getByRole('option', { name: 'Delete task hub' }).click();

  await expect(page.getByRole('heading', { name: 'No activity recorded' })).toBeVisible();
  await expect(page.locator('.empty p')).toHaveText('Nothing was recorded in the last 24 hours.');
});

test('shows the same newest rows on the Overview', async ({ page }) => {
  await gotoHub(page, 'activity');

  const newest = await cellsOf(rows(page).first());

  await gotoHub(page, 'overview');

  const panel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Recent activity' }) });
  const top = panel.locator('tbody tr').first();

  // The panel is the same trail, five columns of it, headed by the same row (ScreenOverview L102-L115)
  await expect(panel.locator('.fine.muted')).toHaveText(/^audit · last \d+ in range$/);
  await expect(top.locator('td[data-label="operation"]')).toHaveText(newest[2].replace(' dangerous', ''));
  await expect(top.locator('td[data-label="instance"]')).toHaveText(newest[3]);
  await expect(top.locator('td[data-label="outcome"]')).toHaveText(newest[4]);

  // ...and it hands the reader over to the screen this spec started on
  // `exact`, because Playwright matches an accessible name by substring: every `e2e-activity-…`
  // instance button in the panel carries the word too
  await panel.getByRole('button', { name: 'Activity', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
});
