// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The shell, against the real host and the seeded hub (E3-S2-T4): what E2 built, proven end to end
// through the browser rather than through jsdom.

import { expect, test, type Page } from '@playwright/test';
import { gotoHub, hub, hubPath, palette } from './fixtures';

/** One of the seeded orchestrations (tests/e2e/seed/fixtures.mjs), the one with a full history. */
const SEEDED_INSTANCE = 'order-2026-09-04-000913';

async function about(page: Page) {
  const response = await page.request.get(`a/p/i/--${hub}/about`);

  expect(response.status()).toBe(200);

  return (await response.json()) as { version: string; accountName: string; hubName: string };
}

test('opens on the Overview of the seeded hub, with the nav to match', async ({ page }) => {
  await gotoHub(page);

  await expect(page.locator('nav.snav .item.active')).toHaveText(/Overview/);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});

test('names the hub in the top bar', async ({ page }) => {
  await gotoHub(page);

  await expect(page.locator('.topbar').getByRole('button', { name: new RegExp(hub) })).toBeVisible();
});

test('reads /about: the version and the account are in the document title', async ({ page }) => {
  await gotoHub(page);

  const { version, accountName, hubName } = await about(page);

  // The mockup's user menu carries the account and the permissions, not the version (DFM App.dc.html
  // L92); React put the version in the title, and that is where /about's version shows in the UI
  await expect(page).toHaveTitle(new RegExp(`${accountName}/${hubName}.*v${version.replace(/[.()]/g, '.')}`));

  await page
    .locator('.topbar')
    .getByRole('button', { name: /anonymous|^a$/ })
    .click();
  await expect(page.getByRole('menu')).toContainText('ReadWrite');
});

test('switches the theme from the top bar', async ({ page }) => {
  await gotoHub(page);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'poster');

  await page.locator('.topbar button.btn', { has: page.locator('.swq') }).click();
  await page.getByRole('menuitemradio', { name: /Riso/ }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');

  // And it survives a reload: the preference is stored (contracts §8)
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'riso');
});

test('opens the palette with Ctrl K and runs the row that is highlighted', async ({ page }) => {
  await gotoHub(page);

  await palette(page, 'Instances');
  await expect(page.locator('.prow')).toHaveCount(1);

  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(new RegExp(`${hubPath('instances')}$`));
  await expect(page.locator('.palette')).toBeHidden();
});

test('goes to Settings on the g s chord', async ({ page }) => {
  await gotoHub(page);

  await page.keyboard.press('g');
  await page.keyboard.press('s');

  await expect(page).toHaveURL(new RegExp(`${hubPath('settings')}$`));
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('jumps to a seeded instance from the top bar', async ({ page }) => {
  await gotoHub(page);

  await page.keyboard.press('/');

  const jump = page.getByRole('combobox', { name: 'Find instance' });
  await expect(jump).toBeFocused();

  await jump.fill(SEEDED_INSTANCE);
  // Exact: the sub-orchestration order-…-000913:0 starts with the same prefix
  await page.getByRole('option', { name: SEEDED_INSTANCE, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`${hubPath('instances')}/${SEEDED_INSTANCE}$`));
});

test('says so when the hub is not one this backend serves', async ({ page }) => {
  await page.goto(hubPath('').replace(hub, 'NoSuchHubHere'));

  // The allow-list answers 401 for a hub it does not know, and the app has to say why it is empty
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText(/task hub/i);
});
