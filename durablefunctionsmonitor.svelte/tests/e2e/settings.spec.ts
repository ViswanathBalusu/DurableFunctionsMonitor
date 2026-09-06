// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Settings screen against the real host (E6-S5-T1): what /about answered, the connection the
// backend exposes, the hub operations it does and does not support, a purge that really removes
// instances, and the two preferences that are this screen's own.
//
// The purge acts on the whole hub - there is no id filter - so the spec seeds an instance a month
// old and purges a two-day window around it. Nothing else in the hub is anywhere near that old, so
// the rest of the fixtures are untouched by design rather than by luck.

import { expect, test, type Page } from '@playwright/test';
import { expectToast, gotoHub, hub, hubPath } from './fixtures';
import { THEMES } from '../../src/lib/themes';
import { buildRetryInstance } from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** How far back the purge window sits, in days: past everything the hub was seeded with. */
const PURGE_AGE_DAYS = 30;

/** What this file seeded, so it can take it out again if the purge did not. */
const seeded: string[] = [];

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: seeded });
});

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

/**
 * Types an instant into one of the purge dialog's date fields.
 *
 * The field is a row of segments, not a text box: each one takes its digits and hands over to the
 * next, which is why this types one long run of digits in the order the en-GB locale lays them out.
 */
async function setDate(page: Page, label: string, when: Date): Promise<void> {
  const field = page.getByLabel(label);
  const two = (value: number) => String(value).padStart(2, '0');

  await field.locator('[data-segment="day"]').click();

  await page.keyboard.type(
    [
      two(when.getUTCDate()),
      two(when.getUTCMonth() + 1),
      String(when.getUTCFullYear()),
      two(when.getUTCHours()),
      two(when.getUTCMinutes()),
    ].join(''),
  );

  // The field is read in UTC (the default clock), so this is the instant that was typed
  await expect(field).toContainText(`${two(when.getUTCDate())}/${two(when.getUTCMonth() + 1)}`);
  await expect(field).toContainText(String(when.getUTCFullYear()));
}

/** The row of one hub-administration operation. */
function adminRow(page: Page, title: string) {
  return page.locator('.panel .stack > .row').filter({ hasText: title });
}

test('says what this backend is, from /about and nothing else', async ({ page }) => {
  await gotoHub(page, 'settings');

  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.locator('.ptitle .meta')).toContainText(hub);

  const connection = page.locator('.panel').filter({ hasText: 'Connection' }).first();

  await expect(connection.locator('.panel-h .fine')).toHaveText('GET /about');

  const value = (term: string) => connection.locator(`dt:text-is("${term}") + dd`);

  await expect(value('task hub')).toHaveText(hub);
  await expect(value('backend')).not.toBeEmpty();
  await expect(value('provider')).toHaveText('Azure Storage');

  // The harness starts the host with authentication off, which is a writable backend
  await expect(value('permissions')).toContainText('ReadWrite');
  await expect(value('host')).toContainText('standalone');
});

test('opens /about as JSON, fully expanded', async ({ page }) => {
  await gotoHub(page, 'settings');

  await page.getByRole('button', { name: 'View /about JSON' }).click();

  const dialog = page.getByRole('dialog', { name: '/about' });

  await expect(dialog).toBeVisible();

  // Contracts §9: expanded, so what the backend announced is on screen without a click
  const viewer = dialog.getByRole('group', { name: '/about' });

  await expect(viewer).toContainText('capabilities');
  await expect(viewer).toContainText('purgeHistory');
  await expect(viewer).toContainText('templates');
});

test('shows the connection the backend uses, with the key left on the server', async ({ page }) => {
  await gotoHub(page, 'settings');

  await page.getByRole('button', { name: 'Manage connection' }).click();

  const dialog = page.getByRole('dialog', { name: 'Connection settings' });

  await expect(dialog).toBeVisible();

  const connectionString = dialog.getByLabel('Storage connection string');

  await expect(connectionString).not.toHaveValue('');
  await expect(connectionString).toHaveJSProperty('readOnly', true);

  // Whatever the host was pointed at - the harness uses the `UseDevelopmentStorage=true` shorthand,
  // which has no key in it at all - an account key never reaches the browser unmasked
  expect(await connectionString.inputValue()).not.toMatch(/AccountKey=(?!\*)/);

  await expect(dialog.getByLabel('Task hub name')).toHaveValue(hub);

  // There is no endpoint that writes it back, so there is nothing here that pretends to
  await expect(dialog.locator('.foot button')).toHaveCount(1);
  await expect(dialog.locator('.foot button')).toHaveText('Close');
});

test('offers only the hub operations this backend announces', async ({ page }) => {
  await gotoHub(page, 'settings');

  await expect(adminRow(page, 'Purge instance history').getByRole('button')).toBeEnabled();

  // The isolated backend implements neither, and says so in /about rather than answering 400 later
  for (const title of ['Clean entity storage', 'Delete task hub']) {
    const button = adminRow(page, title).getByRole('button');

    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', 'Not supported by this backend');
  }
});

test('purges the instances of one window and leaves the rest of the hub alone', async ({ page }) => {
  const instanceId = `e2e-purge-${Date.now()}`;
  const created = daysAgo(PURGE_AGE_DAYS);

  await seedInstances({ hub, instances: [buildRetryInstance(instanceId, created)] });
  seeded.push(instanceId);

  const window = `from=${daysAgo(PURGE_AGE_DAYS + 1).toISOString()}&to=${daysAgo(PURGE_AGE_DAYS - 1).toISOString()}`;
  const listing = `${hubPath('instances')}?${window}&col=instanceId&op=StartsWith&val=${instanceId}`;

  await page.goto(listing);
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(1);

  // How many instances the hub holds outside that window, which the purge must not touch
  await page.goto(hubPath('instances'));
  await expect(page.locator('table.tbl tbody tr').first()).toBeVisible();

  const before = await page.locator('table.tbl tbody tr').count();

  await gotoHub(page, 'settings');
  await adminRow(page, 'Purge instance history').getByRole('button').click();

  const dialog = page.getByRole('dialog', { name: 'Purge instance history' });

  await expect(dialog).toBeVisible();

  await setDate(page, 'Created from', daysAgo(PURGE_AGE_DAYS + 1));
  await setDate(page, 'Created till', daysAgo(PURGE_AGE_DAYS - 1));

  // Only Failed, which is what the seeded instance is
  for (const status of ['Completed', 'Terminated', 'Canceled']) {
    await dialog.locator('[role="checkbox"]').filter({ hasText: status }).click();
  }

  await dialog.locator('[role="checkbox"]').filter({ hasText: 'Failed' }).click();

  await dialog.getByRole('button', { name: 'Purge' }).click();

  await expectToast(page, /Purged \d+ instances/);
  await expect(dialog).toContainText(/Purged [1-9]\d* instances/);

  await dialog.getByRole('button', { name: 'Close' }).click();

  // Gone from the window it was in, and everything else still listed
  await page.goto(listing);
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(0);

  await page.goto(hubPath('instances'));
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(before);
});

test('changes the theme from the tile that is picked', async ({ page }) => {
  await gotoHub(page, 'settings');

  const themes = page.getByRole('radiogroup', { name: 'Theme' });

  await expect(themes.getByRole('radio')).toHaveCount(THEMES.length);

  await themes.getByRole('radio', { name: /^Memphis/ }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'memphis');
  await expect(themes.getByRole('radio', { name: /^Memphis/ })).toHaveClass(/active/);

  // Stored per user, so it is still the theme after a reload
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'memphis');
});

test('saves the Needs attention thresholds', async ({ page }) => {
  await gotoHub(page, 'settings');

  await expect(page.getByLabel('Running longer than')).toHaveValue('1 h');

  await page.getByLabel('Running longer than').fill('2 h');
  await page.getByLabel('Pending older than').fill('nonsense');

  // A field the app cannot read is outlined, and nothing can be saved while it is
  await expect(page.getByLabel('Pending older than')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await page.getByLabel('Pending older than').fill('45');
  await page.getByRole('button', { name: 'Save' }).click();

  await expectToast(page, 'Saved thresholds for Needs attention');

  await page.reload();

  await expect(page.getByLabel('Running longer than')).toHaveValue('2 h');
  await expect(page.getByLabel('Pending older than')).toHaveValue('45 min');
});
