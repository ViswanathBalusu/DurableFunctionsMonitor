// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Below 768px the side nav is gone and the bottom nav is the whole navigation (contracts §14).
// Runs in the `mobile` project of playwright.config.ts, at 390px.

import { expect, test } from '@playwright/test';
import { gotoHub, hubPath } from './fixtures';

test('navigates from the bottom, not from the side', async ({ page }) => {
  await gotoHub(page);

  await expect(page.locator('nav.bottom-nav')).toBeVisible();
  await expect(page.locator('nav.snav')).toBeHidden();

  await page.locator('nav.bottom-nav button', { hasText: 'Entities' }).click();

  await expect(page).toHaveURL(new RegExp(`${hubPath('entities')}$`));
  await expect(page.locator('nav.bottom-nav button.active')).toHaveText(/Entities/);
});

test('holds the rest of the screens in the More sheet', async ({ page }) => {
  await gotoHub(page);

  await page.locator('nav.bottom-nav button', { hasText: 'More' }).click();

  const sheet = page.locator('.sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('menuitem', { name: /Settings/ })).toBeVisible();

  await sheet.getByRole('menuitem', { name: /Settings/ }).click();

  await expect(page).toHaveURL(new RegExp(`${hubPath('settings')}$`));
  await expect(sheet).toBeHidden();
});

test('keeps the top bar, without the things that do not fit', async ({ page }) => {
  await gotoHub(page);

  await expect(page.locator('.topbar')).toBeVisible();

  // .hide-m is the stylesheet's own rule for what a narrow screen drops (dfm-ui.css §responsive)
  await expect(page.locator('.topbar .seg')).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Find instance' })).toBeVisible();
});

test('keeps every Needs attention link at the end of its own row', async ({ page }) => {
  await gotoHub(page);

  const rows = page.locator('.attn > div');

  await expect(rows.first()).toBeVisible();

  // "pending older than 10 min" once pushed its link onto a line of its own under the row; the
  // sentence gives way instead (dfm-ext.css `.attn-text`), so each link sits level with its count
  for (const row of await rows.all()) {
    const count = await row.locator('.n').boundingBox();
    const link = await row.locator('.link').boundingBox();
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;

    expect(Math.abs(middle(link!) - middle(count!))).toBeLessThan(4);
  }
});
