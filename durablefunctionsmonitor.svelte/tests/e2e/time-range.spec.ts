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
