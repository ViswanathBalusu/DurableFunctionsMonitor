// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Overview screen against the host whose scan is capped at a handful of rows (E7-S4-T1). A
// backend that stops counting says so - `partial: true` and the cap it stopped at - and the screen
// has to pass that on rather than present a lower bound as a total. Nothing here can be faked: the
// cap is `DFM_STATS_CAP` on that host (playwright.config.ts), and only the backend knows it.

import { expect, test } from '@playwright/test';
import { gotoHub, hubPath } from './fixtures';
import { STATS_CAP } from '../../playwright.config';

test('says the numbers are a lower bound, and offers a range it can count fully', async ({ page }) => {
  await page.goto(`${hubPath()}?range=30d`);

  await expect(page.locator('.topbar')).toBeVisible();

  const banner = page.locator('.banner');

  await expect(banner).toBeVisible();
  await expect(banner.locator('.chip.st-running')).toHaveText('Partial results');
  await expect(banner).toContainText(
    `Counted the first ${STATS_CAP} instances of the range; narrow the range for exact numbers.`,
  );

  // The meta says the same thing in the words the backend used
  await expect(page.locator('.ptitle .fine.muted')).toContainText(`scanned ${STATS_CAP} (partial)`);

  await banner.getByRole('button', { name: 'Use last 24 hours' }).click();

  await expect(page).toHaveURL(/range=24h/);
});

test('offers no narrower range once the range already is the one it would offer', async ({ page }) => {
  await gotoHub(page);

  const banner = page.locator('.banner');

  // Still capped - the host counts five rows whatever the window - so the banner is still there
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Use last 24 hours' })).toHaveCount(0);
});
