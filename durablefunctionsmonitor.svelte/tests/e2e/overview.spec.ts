// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Overview screen against the real host (E7-S4-T1): the tiles over the seeded hub, the lists
// they open, the throughput columns and the brush that makes a window the shared range, and the two
// panels that are only there because this backend announces `storageHealth` and `audit`.
//
// The numbers are not hard-coded: what a tile says has to agree with the list behind it, which is
// the property that matters and the one that survives a change to the seed.

import { expect, test, type Page } from '@playwright/test';
import { gotoHub, hubPath } from './fixtures';
import { ORCHESTRATORS } from './seed/fixtures.mjs';

/** The number a tile shows, as a number. */
async function tileCount(page: Page, label: string): Promise<number> {
  const tile = page.locator('.tiles .stat-tile').filter({ has: page.locator('.lbl', { hasText: label }) });

  const text = (await tile.locator('.num').textContent()) ?? '';

  return Number(text.replace(/,/g, ''));
}

/** The panel with the given heading. */
function panel(page: Page, title: string) {
  return page.locator('.panel').filter({ has: page.getByRole('heading', { name: title, level: 2 }) });
}

/** Drags across the throughput chart, from one fraction of its width to another. */
async function brush(page: Page, from: number, to: number): Promise<void> {
  const chart = panel(page, 'Throughput').locator('.chart svg').first();
  const box = await chart.boundingBox();

  expect(box, 'the throughput chart has no box to drag across').not.toBeNull();

  const y = box!.y + box!.height / 2;

  await page.mouse.move(box!.x + box!.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * to, y, { steps: 8 });
  await page.mouse.up();
}

test('is the hub in six numbers, each opening the list behind it', async ({ page }) => {
  await gotoHub(page);

  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  const tiles = page.locator('.tiles .stat-tile');

  await expect(tiles).toHaveCount(6);
  await expect(tiles.locator('.lbl')).toHaveText([
    'Running',
    'Pending',
    'Failed',
    'Completed',
    'Suspended',
    'Entities',
  ]);

  // The freshness meta says how much of the hub the numbers came from
  await expect(page.locator('.ptitle .fine.muted')).toContainText(/scanned [\d,]+ \(full\)/);

  const running = await tileCount(page, 'Running');

  expect(running).toBeGreaterThan(0);

  await tiles.first().click();

  // The list it opens is filtered to that status, over the range the tile counted
  await expect(page).toHaveURL(/status=Running/);
  await expect(page).toHaveURL(/range=24h/);
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(running);
});

test('sends the failures to the screen that groups them', async ({ page }) => {
  await gotoHub(page);

  await page
    .locator('.tiles .stat-tile')
    .filter({ has: page.locator('.lbl', { hasText: 'Failed' }) })
    .click();

  // This backend announces `failures`, so the tile opens the grouped view and not a filtered list
  await expect(page).toHaveURL(/\/failures/);
});

test('counts the entities the hub holds', async ({ page }) => {
  // The seeded entities were last touched days ago, so a day-long window does not hold them
  await page.goto(`${hubPath()}?range=7d`);
  await expect(page.locator('.topbar')).toBeVisible();

  await expect.poll(async () => await tileCount(page, 'Entities')).toBeGreaterThan(0);

  await page
    .locator('.tiles .stat-tile')
    .filter({ has: page.locator('.lbl', { hasText: 'Entities' }) })
    .click();

  await expect(page).toHaveURL(/\/entities/);
});

test('draws the range as columns, and lets a window of it become the range', async ({ page }) => {
  await gotoHub(page);

  const throughput = panel(page, 'Throughput');

  await expect(throughput.locator('.panel-h .fine.muted')).toHaveText('48 bins · brush sets the global range');
  await expect(throughput.locator('.chart svg rect').first()).toBeVisible();

  // Five ticks, the first of them dated (ScreenOverview.dc.html L57)
  const ticks = throughput.locator('.chart > .row > .muted');

  await expect(ticks).toHaveCount(5);
  await expect(ticks.first()).toHaveText(/^[A-Z][a-z]{2} \d+, \d{2}:\d{2}$/);

  await brush(page, 0.3, 0.6);

  // The brushed window is now the shared range, and the panel says which window that is
  await expect(page).toHaveURL(/from=/);
  await expect(page).toHaveURL(/to=/);
  await expect(page).not.toHaveURL(/range=/);
  await expect(throughput.locator('.row > .meta')).toContainText('Brushed');

  await throughput.getByRole('button', { name: 'clear' }).click();

  await expect(page).toHaveURL(/range=24h/);
  await expect(page).not.toHaveURL(/from=/);
});

test('says what the range is asking someone to look at', async ({ page }) => {
  await gotoHub(page);

  const attention = panel(page, 'Needs attention');

  await expect(attention.locator('.panel-h .fine.muted')).toHaveText('thresholds in Settings');

  // The failures row is there whatever the count, because "0 failed in range" is an answer
  const failed = attention.locator('.attn > div').filter({ hasText: 'failed in range' });

  await expect(failed).toHaveCount(1);
  await expect(failed.locator('.n')).toHaveText(/^[\d,]+$/);

  await failed.getByRole('button').click();

  await expect(page).toHaveURL(/\/failures/);
});

test('lists every orchestrator of the range, busiest first', async ({ page }) => {
  await gotoHub(page);

  const top = panel(page, 'Top orchestrators');

  await expect(top.locator('.panel-h .fine.muted')).toHaveText('stats.byName · p50 and p95 over terminal instances');

  const started = await top.locator('tbody td[data-label="started"]').allTextContents();

  expect(started.length).toBeGreaterThan(1);

  // Sorted by started, descending: the seeded hub has a filler orchestrator with more runs than the
  // orchestrators the mockups care about, so the order is asserted rather than the first name
  const numbers = started.map((text) => Number(text.replace(/,/g, '')));

  expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

  const names = await top.locator('tbody td[data-label="name"]').allTextContents();

  expect(names.join(' ')).toContain(ORCHESTRATORS.processOrder);

  await top.getByRole('button', { name: ORCHESTRATORS.processOrder }).click();

  await expect(page).toHaveURL(new RegExp(`name=${ORCHESTRATORS.processOrder}`));
  await expect(page.locator('table.tbl tbody tr').first()).toBeVisible();
});

test('shows the two panels this backend announces, and what they are for', async ({ page }) => {
  await gotoHub(page);

  const backlog = panel(page, 'Backlog');

  await expect(backlog.locator('.panel-h .chip')).toHaveText('Azure Storage');
  await expect(backlog.locator('dl.kv dt')).toContainText(['workitems', 'control-00', 'partitions']);

  const activity = panel(page, 'Recent activity');

  await expect(activity.locator('.panel-h .fine.muted')).toHaveText(/^audit · last \d+ in range$/);

  await activity.getByRole('button', { name: 'Activity' }).click();

  await expect(page).toHaveURL(/\/activity/);
});

test('reloads what is on screen when the range changes', async ({ page }) => {
  await page.goto(`${hubPath()}?range=7d`);

  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time range' })).toHaveText('Last 7 days');

  const sevenDays = await tileCount(page, 'Completed');

  await page.getByRole('button', { name: 'Time range' }).click();
  await page.getByRole('option', { name: 'Last 15 minutes' }).click();

  await expect(page).toHaveURL(/range=15m/);

  // The seeded hub is hours old, so a fifteen-minute window holds fewer of it than a week does
  await expect.poll(async () => await tileCount(page, 'Completed')).toBeLessThanOrEqual(sevenDays);
});
