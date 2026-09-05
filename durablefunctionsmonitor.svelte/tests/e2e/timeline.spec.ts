// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Timeline tab and the Summary column against the real host (E8-S5-T1): the lanes computed from
// the spans the backend built out of the seeded history, the hover that links them to the rows they
// were built from, and the two panels `/spans` and `/children` fill in.
//
// Nothing here is mocked, so the lanes are whatever the provider's own history produces - which is
// the point: the mapping is unit tested against a fixture, and this says the fixture was honest.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoHub, gotoInstance } from './fixtures';
import { RUNNING_INSTANCE_ID } from './seed/fixtures.mjs';

function lanes(page: Page): Locator {
  return page.locator('.swim .lane');
}

/** The lane with this label, whichever row of the strip it is. */
function lane(page: Page, label: string): Locator {
  return lanes(page).filter({ has: page.locator('.lbl', { hasText: label }) });
}

/** The `#` of every history row that is marked as belonging to the hovered span. */
async function highlighted(page: Page): Promise<string[]> {
  return await page.locator('tbody tr.hl td[data-label="#"]').allTextContents();
}

test('opens on the timeline, and draws the run the provider recorded', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  // Timeline is the default tab wherever the backend serves /spans (E5-S3-T1)
  await expect(page.locator('.tabs .tab[aria-selected="true"]')).toHaveText('Timeline');
  await expect(page).not.toHaveURL(/tab=/);

  // The tab renders before /about has said there are spans at all, and again once /spans answers
  await expect(lanes(page).first().locator('.lbl')).toHaveText('ProcessOrderOrchestrator');

  // The lanes of ScreenInstance.dc.html L301-L309, computed from the seeded history. The mockup's
  // ninth - a wait for an event that has not arrived - has no span behind it: the provider only
  // learns an event's name from the row that raised it (E8-S2-T1)
  await expect(lanes(page).locator('.lbl')).toHaveText([
    'ProcessOrderOrchestrator',
    'ReserveInventory',
    'ChargePayment',
    'ChargePayment (retry 2)',
    'retry backoff',
    'wait PaymentApproved',
    'ChargePayment (retry 3)',
    'NotifyCustomer (sub)',
  ]);

  const episodes = lanes(page).first().locator('.bar.orch');

  await expect(episodes.first()).toBeVisible();
  expect(await episodes.count()).toBeGreaterThan(1);

  // The instance is still running, so the dashed line says where now is
  await expect(lanes(page).first().locator('.now')).toBeVisible();

  // The attempt that timed out is the failed bar, and says so in the words the row used. The seeded
  // instance is still running, so it gets longer: what fits inside a four-second bar depends on how
  // long the run has been going, and the lane says it beside the bar when it no longer fits inside
  const retry = lane(page, 'ChargePayment (retry 2)');

  await expect(retry.locator('.bar')).toHaveClass(/st-failed/);
  await expect(retry).toContainText('Timeout 4 s');
  await expect(retry.locator('.bar')).toHaveAttribute('title', /TimeoutException: payment gateway did not answer/);
});

test('names what the fills mean, and what hovering one is for', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  await expect(lanes(page).first()).toBeVisible();

  await expect(page.locator('.legend > span')).toHaveText([
    'activity',
    'failed',
    'running',
    'timer',
    'waiting for event',
    'orchestrator replay',
  ]);

  await expect(page.getByText('hover a span to find its history rows')).toBeVisible();
});

test('links a span and its history rows, both ways round', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  await expect(lanes(page).first()).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  const retry = lane(page, 'ChargePayment (retry 2)');

  await retry.hover();

  // The row the attempt was built from: the provider numbers a merged pair by its TaskScheduled row
  await expect.poll(async () => await highlighted(page)).toEqual(['10']);

  // ...and the other way: the row lights the bar, and the lane it is drawn on
  await page.locator('tbody tr').filter({ hasText: 'TaskFailed' }).hover();

  await expect(retry).toHaveClass(/\bhl\b/);
  await expect(retry.locator('.bar')).toHaveClass(/\bhl\b/);
});

test('says how much of the history is under the picture, and where the rest of it is', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  await expect(page.locator('tbody tr').first()).toBeVisible();

  // No rail here: the picture above is the whole execution, and a filtered table would not match it
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  await expect(page.locator('thead th')).toHaveText([
    '',
    '#',
    'Timestamp',
    'EventType',
    'Name',
    'Duration',
    'Result / Details',
  ]);

  await expect(page.locator('.tfoot .meta')).toHaveText(/^\d+ of \d+ events · SequenceNumber from the provider$/);

  await page.getByRole('button', { name: 'Open History tab' }).click();

  await expect(page).toHaveURL(/tab=history/);
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
});

test('summarises where the time went, and what the instance started', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  const timeSpent = page.locator('.summary .panel').filter({ hasText: 'Where the time went' });

  await expect(timeSpent.locator('.panel-h .fine.muted')).toHaveText(/^\/spans · /);

  // One slice and one row per kind that took any time at all
  const rows = timeSpent.locator('dl.kv dt');

  expect(await rows.count()).toBeGreaterThan(2);
  await expect(timeSpent.locator('.wbar i')).toHaveCount(await rows.count());
  await expect(timeSpent.locator('dl.kv dd.muted').first()).toHaveText(/^\d+\.\d %$/);

  const children = page.locator('.summary .panel').filter({ hasText: 'Children' });

  await expect(children.locator('.panel-h .fine.muted')).toHaveText(/^\/children · (complete|partial)$/);
  await expect(children.getByRole('link', { name: 'NotifyCustomer' })).toBeVisible();
  await expect(children.locator('.chip.st-running')).toHaveText('Running');

  // The header counts what the provider counted, not what a page of history happened to hold
  await expect(page.locator('.hero .hmeta')).toContainText('children: 1');
  await expect(page.locator('.hero .hmeta')).toContainText(/history \d+ rows/);

  // The Execution rows only /spans knows
  const execution = page.locator('.summary .panel').filter({ hasText: 'Execution' }).locator('dl.kv');

  await expect(execution.locator('dt', { hasText: 'executionId' }).locator('+ dd')).not.toHaveText('—');
  await expect(execution.locator('dt', { hasText: 'history' }).locator('+ dd')).toHaveText(
    /^\d+ rows · [\d.]+ [KM]?B$/,
  );

  await children.getByRole('link', { name: 'NotifyCustomer' }).click();

  await expect(page).toHaveURL(/order-2026-09-04-000913%3A0/);
});

test('peeks a row and draws the same run in miniature', async ({ page }) => {
  await gotoHub(page, 'instances');

  const row = page
    .locator('table.tbl tbody tr')
    .filter({ has: page.getByRole('link', { name: RUNNING_INSTANCE_ID, exact: true }) });

  await row.locator('[data-label="name"]').click();

  const peek = page.locator('.peek');

  await expect(peek).toBeVisible();

  // Four lanes of the workspace's own timeline: enough to say what kind of run this is
  await expect(peek.locator('.swim .lane')).toHaveCount(4);
  await expect(peek.locator('.swim .lane .lbl').first()).toHaveText('ProcessOrderOrchestrator');

  // ...and the history the provider counted, not an em dash
  const history = peek.locator('.kv dt', { hasText: 'history' }).locator('+ dd');

  await expect(history).toHaveText(/^\d+ rows/);
});
