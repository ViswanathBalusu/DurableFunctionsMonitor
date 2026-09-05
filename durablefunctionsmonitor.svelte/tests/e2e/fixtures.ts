// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What every spec needs and nothing more (E3-S2-T3). Authentication is off through DFM_NONCE, so
// there is no login helper here: a spec opens a URL and the app is simply there.

import { expect, type Page } from '@playwright/test';
import { DEFAULT_HUB } from './seed/fixtures.mjs';

/** The hub the suite seeded; `DFM_E2E_HUB` overrides it for a second hub or a second host. */
export const hub = process.env.DFM_E2E_HUB ?? DEFAULT_HUB;

/**
 * Every screen lives under the hub segment (contracts §4); `path` is what follows it. Relative, with
 * no leading slash, so that Playwright's baseURL keeps the host's `durable-functions-monitor` prefix.
 */
export function hubPath(path = ''): string {
  const suffix = path.replace(/^\/+/, '');

  return suffix ? `${hub}/${suffix}` : hub;
}

/**
 * Opens a screen of the seeded hub and waits until the shell has drawn it - the top bar is the last
 * thing the app renders, so its presence means the bundle ran and /about answered.
 */
export async function gotoHub(page: Page, path = ''): Promise<void> {
  await page.goto(hubPath(path));
  await expect(page.locator('.topbar, .login')).toBeVisible();
}

/** Opens one instance's workspace. Ids are encoded the way the API client encodes them (§6). */
export async function gotoInstance(page: Page, instanceId: string, tab?: string): Promise<void> {
  const query = tab ? `?tab=${encodeURIComponent(tab)}` : '';

  await page.goto(`${hubPath('instances')}/${encodeURIComponent(instanceId).replace(/'/g, '%27')}${query}`);
  await expect(page.locator('.topbar')).toBeVisible();
}

/** Waits for the one toast the app shows at a time, and checks what it says. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  const toast = page.locator('.toast');

  await expect(toast).toBeVisible();
  await expect(toast).toContainText(text);
}

/** Waits for a toast reporting a success, which is the green one. */
export async function expectOkToast(page: Page, text: string | RegExp): Promise<void> {
  await expectToast(page, text);
  await expect(page.locator('.toast')).toHaveClass(/\bok\b/);
}

/**
 * Switches the theme and the mode through the top bar's menu, the way a user would - the specs that
 * check the design system are about what the stylesheet does with `data-theme` and `.dark`.
 */
export async function theme(page: Page, name: string, dark = false): Promise<void> {
  await page.locator('.topbar button.btn', { has: page.locator('.swq') }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(name, 'i') }).click();

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));

  if (isDark !== dark) {
    await page.getByRole('switch', { name: 'Dark mode' }).click();
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', name.toLowerCase());
}

/** The command palette, which every screen can be reached from (contracts §13). */
export async function palette(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.locator('.palette')).toBeVisible();
  await page.getByPlaceholder('Type a command, a screen or an instance id').fill(query);
}
