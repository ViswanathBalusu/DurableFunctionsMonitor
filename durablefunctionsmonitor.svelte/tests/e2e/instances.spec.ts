// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Instances screen against the real host and the seeded hub (E4-S9-T1): the filters that turn
// into OData the backend actually parses, the three views, the bulk actions that really reach the
// task hub, and the dialogs. Nothing here is mocked - a failing assertion means the app and the
// backend disagree.

import { expect, test, type Page } from '@playwright/test';
import { expectToast, gotoHub, hub, hubPath } from './fixtures';
import { FAILED_INSTANCE_ID, FILLER_ORCHESTRATOR, RUNNING_INSTANCE_ID } from './seed/fixtures.mjs';

/**
 * What the Start new instance spec creates. It stays in the hub: nothing consumes the control queue
 * of a seeded hub, so the instance never leaves Pending, and the host refuses to purge an instance
 * that has not finished. A fresh id per run keeps the spec repeatable; `DFM_E2E_RESET=1` clears them.
 */
const PROBE_ORCHESTRATOR = 'E2EStartProbeOrchestrator';

/** The rows the table is showing. */
function rows(page: Page) {
  return page.locator('table.tbl tbody tr');
}

/** One row by instance id, exactly - several seeded ids are prefixes of each other. */
function instanceRow(page: Page, instanceId: string) {
  return rows(page).filter({ has: page.getByRole('link', { name: instanceId, exact: true }) });
}

async function gotoInstances(page: Page, query = ''): Promise<void> {
  await gotoHub(page, `instances${query}`);
  await expect(page.getByRole('heading', { name: 'Instances', level: 1 })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

test('lists the seeded instances, newest first', async ({ page }) => {
  await gotoInstances(page);

  const running = instanceRow(page, RUNNING_INSTANCE_ID);

  await expect(running).toHaveCount(1);
  await expect(running.locator('[data-label="runtimeStatus"]')).toHaveText('Running');
  await expect(running.locator('[data-label="duration"]')).not.toBeEmpty();

  // Newest first: the sub-orchestration the running order started is younger than the order itself.
  // Not "the first row", because a spec that starts an instance leaves a younger one behind it.
  const ids = await page.locator('table.tbl tbody [data-label="instanceId"]').allTextContents();

  expect(ids).toContain(RUNNING_INSTANCE_ID);
  expect(ids.indexOf(`${RUNNING_INSTANCE_ID}:0`)).toBeLessThan(ids.indexOf(RUNNING_INSTANCE_ID));

  await expect(page.locator('.ptitle .meta')).toContainText('Last 24 hours');
});

test('filters by status through the chips, and clears again', async ({ page }) => {
  await gotoInstances(page);

  await page.getByRole('button', { name: '+ status' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Failed' }).click();
  await page.locator('.pop').getByRole('button', { name: 'Apply' }).click();

  await expect(page.locator('.chips2 .fchip').first()).toHaveText('Failed ×');
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('table.tbl tbody [data-label="runtimeStatus"] .chip:not(.st-failed)')).toHaveCount(0);
  await expect(instanceRow(page, FAILED_INSTANCE_ID)).toHaveCount(1);

  // The URL carries the filter, so the view is a link (contracts §4)
  await expect(page).toHaveURL(/status=Failed/);

  await page.getByRole('button', { name: 'Clear all' }).click();

  await expect(page.getByRole('button', { name: '+ status' })).toBeVisible();
  await expect(page).not.toHaveURL(/status=Failed/);
});

test('filters by orchestrator name from the facet', async ({ page }) => {
  await gotoInstances(page);

  await page.getByRole('button', { name: '+ orchestrator' }).click();

  // With /stats the facet offers the names it counted; without it, one is typed in. The text box is
  // also what it offers while /stats is still answering, so this waits for the names rather than
  // asking what is on screen at this instant: on a hub with enough instances to make the count slow,
  // the box that `isVisible()` found has been replaced by the time anything is typed into it.
  const named = page.getByRole('menuitemcheckbox', { name: new RegExp(FILLER_ORCHESTRATOR) });
  const counted = await named
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (counted) {
    await named.click();
    await page.keyboard.press('Escape');
  } else {
    const typed = page.getByRole('textbox', { name: 'Orchestrator name' });

    await typed.fill(FILLER_ORCHESTRATOR);
    await typed.press('Enter');
  }

  await expect(page.locator('.chips2 .fchip').filter({ hasText: FILLER_ORCHESTRATOR })).toBeVisible();

  await expect
    .poll(async () => {
      const names = await page.locator('table.tbl tbody [data-label="name"]').allTextContents();

      return names.length > 0 && names.every((name) => name.trim() === FILLER_ORCHESTRATOR);
    })
    .toBe(true);
});

test('narrows with the free filter from the rail', async ({ page }) => {
  await gotoInstances(page);

  await page.getByLabel('Filter value').fill('order-');
  await page.getByLabel('Filter value').press('Enter');

  await expect(page.locator('.chips2 .fchip').filter({ hasText: 'instanceId starts with order-' })).toBeVisible();

  await expect
    .poll(async () => {
      const ids = await page.locator('table.tbl tbody [data-label="instanceId"]').allTextContents();

      return ids.length > 0 && ids.every((id) => id.trim().startsWith('order-'));
    })
    .toBe(true);
});

test('sorts through the backend, and says so in the strip', async ({ page }) => {
  await gotoInstances(page);

  const strip = page.locator('.meta').filter({ hasText: 'sorted by' });

  await expect(strip).toContainText('createdTime desc');

  await page.getByRole('button', { name: 'createdTime' }).click();

  await expect(page).toHaveURL(/dir=asc/);
  await expect(strip).toContainText('createdTime asc');

  // Ascending really is ascending: the timestamps are `YYYY-MM-DD HH:mm:ss`, so they sort as text
  await expect
    .poll(async () => {
      const times = (await page.locator('table.tbl tbody [data-label="createdTime"]').allTextContents()).map((text) =>
        text.trim(),
      );

      return times.length > 1 && times.every((time, index) => index === 0 || times[index - 1] <= time);
    })
    .toBe(true);
});

test('pages: fifty rows and a Load more', async ({ page }) => {
  await gotoInstances(page);

  await expect(rows(page)).toHaveCount(50);

  const loadMore = page.getByRole('button', { name: 'Load more' });

  await expect(loadMore).toBeVisible();
  await loadMore.click();

  await expect(rows(page)).not.toHaveCount(50);
  await expect(page.locator('.tfoot .meta')).toContainText('Showing');
});

test('opens the peek on a row and closes it with Escape', async ({ page }) => {
  await gotoInstances(page);

  const running = instanceRow(page, RUNNING_INSTANCE_ID);

  await running.locator('[data-label="name"]').click();

  const peek = page.locator('.peek');

  await expect(peek).toBeVisible();
  await expect(peek).toContainText(RUNNING_INSTANCE_ID);
  await expect(peek).toContainText('Running');

  await page.keyboard.press('Escape');

  await expect(peek).toBeHidden();

  // The id is a link to the workspace, and it does not open the peek
  await running.getByRole('link', { name: RUNNING_INSTANCE_ID, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`instances/${RUNNING_INSTANCE_ID}$`));
});

test('draws the timeline and the histogram', async ({ page }) => {
  await gotoInstances(page);

  await page.getByRole('tab', { name: 'Timeline' }).click();

  await expect(page.locator('.swim .lane').first()).toBeVisible();
  await expect(page.locator('.swim .lane .bar').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save as SVG' })).toBeVisible();

  await page.getByRole('tab', { name: 'Histogram' }).click();

  await expect(page.getByRole('group', { name: /Instances per .* by orchestrator/ })).toBeVisible();
  await expect(page.locator('.legend')).toContainText('brush narrows the time filter');
  await expect(page.getByText(/instances scanned/)).toBeVisible();

  await page.getByRole('tab', { name: 'Table' }).click();
  await expect(rows(page).first()).toBeVisible();
});

test('suspends and resumes the running instances from the bulk bar', async ({ page }) => {
  await gotoInstances(page, '?status=Running');

  await expect(rows(page)).toHaveCount(2);

  await rows(page).nth(0).locator('.sel-cell .box').click();
  await rows(page).nth(1).locator('.sel-cell .box').click();

  const bar = page.locator('.bulk');

  await expect(bar).toBeVisible();
  await expect(bar.locator('.cnt')).toHaveText('2 selected');

  await bar.getByRole('button', { name: 'Suspend' }).click();

  const confirm = page.getByRole('dialog', { name: 'Suspend 2 instances' });

  await expect(confirm).toBeVisible();
  await confirm.getByLabel('Reason (optional)').fill('e2e');
  await confirm.getByRole('button', { name: 'Suspend 2' }).click();

  // Every id answered: the request really went to the task hub, one per instance
  await expectToast(page, 'Suspend 2 · 2 ok, 0 failed');
  await expect(page.locator('.bulk')).toBeHidden();

  // Resuming them is refused, and every refusal is reported: a seeded hub has no worker consuming
  // its control queue, so the suspend was only ever enqueued and the instances are still Running.
  // Nothing was changed by either request, which is what leaves the hub as it was found.
  await rows(page).nth(0).locator('.sel-cell .box').click();
  await rows(page).nth(1).locator('.sel-cell .box').click();

  await page.locator('.bulk').getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('dialog', { name: 'Resume 2 instances' }).getByRole('button', { name: 'Resume 2' }).click();

  await expectToast(page, 'Resume 2 · 0 ok, 2 failed');

  const failures = page.getByRole('dialog', { name: 'Resume 2' });

  await expect(failures).toBeVisible();
  await expect(failures).toContainText('0 ok, 2 failed');
  await expect(failures.locator('table.tbl tbody tr')).toHaveCount(2);

  await failures.getByRole('button', { name: 'Close' }).click();
});

test('starts an instance and says which one it started', async ({ page }) => {
  await gotoInstances(page);

  await page.getByRole('button', { name: 'Start new instance' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Start new instance' });

  await expect(dialog).toBeVisible();

  // The backend queues whatever name it is given - it has no list of orchestrators to check one
  // against - so this really does create an instance in the task hub
  const instanceId = `e2e-start-probe-${Date.now()}`;

  await dialog.getByLabel('Orchestrator').fill(PROBE_ORCHESTRATOR);
  await dialog.getByPlaceholder('Leave empty for a generated GUID').fill(instanceId);
  await dialog.getByRole('button', { name: 'Start' }).click();

  await expectToast(page, `Started ${instanceId} · ${PROBE_ORCHESTRATOR}`);
  await expect(dialog).toBeHidden();

  // And it is in the hub, which is what "started" means
  const probe = await page.request.get(`a/p/i/--${hub}/orchestrations('${instanceId}')`);

  expect(probe.status()).toBe(200);
  expect(((await probe.json()) as { name: string }).name).toBe(PROBE_ORCHESTRATOR);
});

test('opens a cell value in the JSON viewer', async ({ page }) => {
  await gotoInstances(page);

  await instanceRow(page, RUNNING_INSTANCE_ID).locator('[data-label="customStatus"] .link').click();

  const dialog = page.getByRole('dialog', { name: 'customStatus' });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(RUNNING_INSTANCE_ID);

  // Fully expanded, which is what the viewer shows without a click (contracts §9)
  await expect(dialog.locator('.jse-theme-dfm')).toContainText('ChargePayment');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('keeps the filters in the URL, so the view is a link', async ({ page }) => {
  await gotoInstances(page, '?status=Failed&entities=1');

  await expect(page.locator('.chips2 .fchip').first()).toHaveText('Failed ×');
  await expect(page.getByRole('button', { name: 'Entities included ×' })).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(new RegExp(`${hubPath('instances')}\\?.*status=Failed`));
  await expect(page.locator('.chips2 .fchip').first()).toHaveText('Failed ×');
});
