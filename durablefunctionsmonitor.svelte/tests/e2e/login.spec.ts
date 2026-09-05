// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The hub picker (E3-S2-T4). Authentication is off through DFM_NONCE, so what is left of the login
// screen is the choice of task hub - and the case where there is nothing to choose.

import { expect, test, type Page } from '@playwright/test';
import { hub } from './fixtures';

/** What /task-hub-names says this storage account holds; the picker shows exactly these. */
async function hubNames(page: Page): Promise<string[]> {
  const response = await page.request.get('a/p/i/task-hub-names');

  expect(response.status()).toBe(200);

  return (await response.json()) as string[];
}

test('goes straight to the only hub there is, or offers the choice', async ({ page }) => {
  const names = await hubNames(page);

  await page.goto('');

  if (names.length === 1) {
    // React parity: one hub is not a choice
    await expect(page).toHaveURL(new RegExp(`/${names[0]}$`));
    await expect(page.locator('.topbar')).toBeVisible();
    return;
  }

  // A development Azurite usually holds several hubs; CI seeds one, or two with DFM_E2E_HUB2
  await expect(page.locator('.login')).toBeVisible();
  await expect(page.locator('.hubrow')).toHaveCount(names.length);

  for (const name of names) {
    // Exact: one hub name can be the prefix of another (TestHub, TestHubName)
    await expect(page.locator('.hubrow .mono', { hasText: new RegExp(`^${name}$`) })).toBeVisible();
  }
});

test('badges each hub with what its own /about reports', async ({ page }) => {
  const names = await hubNames(page);

  test.skip(names.length < 2, 'this storage account holds one hub, so there is no picker');

  await page.goto('');

  const row = page.locator(`.hubrow[href$="/${hub}"]`);

  await expect(row.locator('.chip')).toHaveText('ReadWrite');
  await expect(page.getByText('Hubs come from GET ../task-hub-names for this storage account.')).toBeVisible();
});

test('opens the hub that is picked', async ({ page }) => {
  const names = await hubNames(page);

  test.skip(names.length < 2, 'this storage account holds one hub, so there is no picker');

  await page.goto('');
  await page.locator(`.hubrow[href$="/${hub}"]`).click();

  await expect(page).toHaveURL(new RegExp(`/${hub}$`));
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});

test('links every row, so a hub can be opened in a second tab', async ({ page }) => {
  const names = await hubNames(page);

  test.skip(names.length < 2, 'this storage account holds one hub, so there is no picker');

  await page.goto('');

  for (const name of names) {
    await expect(page.locator(`.hubrow[href$="/${name}"]`)).toHaveCount(1);
  }
});
