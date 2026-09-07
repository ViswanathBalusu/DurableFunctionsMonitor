// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The shared time range against the real host: `Custom range…` opens a picker seeded with the window
// in force, applying it puts `from`/`to` on the URL that every screen reads, and cancelling it leaves
// both the range and the control exactly where they were.

import { expect, test, type Page } from '@playwright/test';
import { gotoHub } from './fixtures';

/** The control itself - a filter chip on Instances, an input-shaped select everywhere else. */
function rangeSelect(page: Page) {
  return page.getByRole('button', { name: 'Time range' });
}

async function openPicker(page: Page): Promise<void> {
  await rangeSelect(page).click();
  await page.getByRole('option', { name: /Custom range/ }).click();

  await expect(page.getByRole('heading', { name: 'Custom time range' })).toBeVisible();
}

test('applies a custom window and names it afterwards', async ({ page }) => {
  await gotoHub(page, 'instances?range=24h');

  await expect(rangeSelect(page)).toHaveText('Last 24 hours');

  await openPicker(page);

  // The picker opens on the twenty-four hours that were in force, so Apply alone is a valid answer
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();

  await expect(page).toHaveURL(/[?&]from=/);
  await expect(page).toHaveURL(/[?&]to=/);
  await expect(page).not.toHaveURL(/[?&]range=/);

  // The window is what the control says now, and the picker is still there to change it
  await expect(rangeSelect(page)).toHaveText(/→/);

  await rangeSelect(page).click();
  await expect(page.getByRole('option', { name: /Custom range/ })).toBeVisible();
});

test('changes nothing when the picker is cancelled', async ({ page }) => {
  await gotoHub(page, 'instances?range=24h');

  await openPicker(page);

  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();

  await expect(page).toHaveURL(/[?&]range=24h/);
  await expect(rangeSelect(page)).toHaveText('Last 24 hours');
});

test('picks the window on a calendar, two months at a time', async ({ page }) => {
  // A window safely in the past: the calendar will not go past today, and June 2026 is behind us
  await gotoHub(page, 'instances?from=2026-06-01T08%3A30%3A00.000Z&to=2026-06-04T14%3A02%3A00.000Z');

  await openPicker(page);

  const dialog = page.getByRole('dialog');

  await expect(dialog.locator('.cal-grid')).toHaveCount(2);
  await expect(dialog.locator('.cal-day[data-value="2026-06-01"]')).toHaveAttribute('data-selection-start', '');

  // Two clicks make a window; one of them is only half of it, so Apply waits for the second
  await dialog.locator('.cal-day[data-value="2026-06-08"]').click();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();

  await dialog.locator('.cal-day[data-value="2026-06-15"]').click();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeEnabled();

  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The days are the ones clicked; the times are the ones the window already had
  await expect(page).toHaveURL(/from=2026-06-08T08%3A30%3A00.000Z/);
  await expect(page).toHaveURL(/to=2026-06-15T14%3A02%3A00.000Z/);
});

test('will not apply a window longer than the backend aggregates', async ({ page }) => {
  await gotoHub(page, 'instances?from=2025-01-01T00%3A00%3A00.000Z&to=2026-09-04T00%3A00%3A00.000Z');

  await openPicker(page);

  const dialog = page.getByRole('dialog');

  // /stats, /failures and /audit all answer 400 for a range this long (RangeQuery.MaxRangeDays)
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await expect(dialog.getByText(/at most 92 days/)).toBeVisible();
});

test('says on the Overview why a window that long has no numbers, and offers the way out', async ({ page }) => {
  await gotoHub(page, '?from=2025-01-01T00%3A00%3A00.000Z&to=2026-09-04T00%3A00%3A00.000Z');

  // The screen explains itself rather than being blank behind a toast that can be dismissed
  await expect(page.getByRole('heading', { name: 'Statistics could not be loaded' })).toBeVisible();
  await expect(page.getByText('The requested range is longer than the maximum of 92 days').first()).toBeVisible();

  await page.getByRole('button', { name: 'Use last 24 hours' }).click();

  await expect(page).toHaveURL(/[?&]range=24h/);
  await expect(page.locator('.tiles').first()).toBeVisible();
});
