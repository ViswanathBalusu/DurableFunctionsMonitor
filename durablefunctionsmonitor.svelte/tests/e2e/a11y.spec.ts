// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The accessibility pass (E12-S3-T2): axe-core over every screen, in both modes of the Poster theme,
// and the keyboard paths a person who never touches a mouse has to be able to walk.
//
// Only `serious` and `critical` violations fail the run. The two lighter levels are advisory and
// full of things the design system decides on purpose (a chip that repeats a colour, a heading level
// that follows the mockup); a rule that is genuinely wrong there belongs in the design, not here.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { gotoHub, gotoInstance, hubPath, palette, theme } from './fixtures';
import { ENTITY_INSTANCE_ID, RUNNING_INSTANCE_ID } from './seed/fixtures.mjs';

/** Every screen of the app, by the path under the hub segment that opens it. */
const SCREENS: { name: string; path: string; ready: string }[] = [
  { name: 'Overview', path: '', ready: 'h1:has-text("Overview")' },
  { name: 'Instances', path: 'instances', ready: '.tbl tbody tr' },
  { name: 'Failures', path: 'failures', ready: 'h1:has-text("Failures")' },
  { name: 'Entities', path: 'entities', ready: '.tbl tbody tr' },
  { name: 'Functions', path: 'functions', ready: 'h1:has-text("Functions")' },
  { name: 'Storage', path: 'storage', ready: '.tbl tbody tr' },
  { name: 'Activity', path: 'activity', ready: 'h1:has-text("Activity")' },
  { name: 'Settings', path: 'settings', ready: 'h1:has-text("Settings")' },
];

/** What a violation says, short enough to read in a failure message. */
function describe(violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[]): string[] {
  return violations.map((v) => `${v.impact}: ${v.id} on ${v.nodes.length} node(s) - ${String(v.nodes[0]?.target)}`);
}

async function serious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

  return describe(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'));
}

for (const mode of ['light', 'dark'] as const) {
  test(`every screen passes axe in ${mode} mode`, async ({ page }) => {
    await gotoHub(page, 'instances');
    await theme(page, 'Poster', mode === 'dark');

    for (const screen of SCREENS) {
      await page.goto(hubPath(screen.path));
      await expect(page.locator(screen.ready).first()).toBeVisible();

      expect(await serious(page), `${screen.name} (${mode})`).toEqual([]);
    }

    // The workspace, which is the screen with the most on it: a hero, seven actions and six tabs
    await gotoInstance(page, RUNNING_INSTANCE_ID);
    await expect(page.locator('.hero')).toBeVisible();

    expect(await serious(page), `Instance workspace (${mode})`).toEqual([]);
  });
}

test('the overlays are reachable and announced', async ({ page }) => {
  await gotoHub(page, 'instances');

  // A dialog: the peek panel, opened from a row
  await page.locator('.tbl tbody tr').first().click();
  await expect(page.getByRole('dialog', { name: 'Instance peek' })).toBeVisible();

  expect(await serious(page), 'peek panel').toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Instance peek' })).toBeHidden();

  // ...a confirm, which is where the destructive operations live
  await gotoInstance(page, ENTITY_INSTANCE_ID);
  await page.locator('.hero .actions').getByRole('button', { name: 'Purge' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  expect(await serious(page), 'purge dialog').toEqual([]);

  await page.keyboard.press('Escape');

  // ...and the palette, which is the keyboard's own way around the app
  await palette(page, 'over');
  expect(await serious(page), 'command palette').toEqual([]);
});

test('the app is operable without a mouse', async ({ page }) => {
  await gotoHub(page, 'instances');

  // The palette opens on Ctrl+K, and Enter runs the highlighted row (contracts section 13)
  await palette(page, 'failures');
  await expect(page.locator('.prow.sel')).toContainText('Failures');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Failures', level: 1 })).toBeVisible();

  // A chord goes to a screen; `g s` is Settings
  await page.keyboard.press('g');
  await page.keyboard.press('s');

  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  // Tab reaches the controls of a screen, and Enter presses the one that is focused
  await gotoHub(page, 'instances');
  await expect(page.locator('.tbl tbody tr').first()).toBeVisible();

  const reached: string[] = [];

  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;

      return el
        ? `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}`
        : '';
    });

    reached.push(focused);

    if (focused.startsWith('button:')) {
      break;
    }
  }

  // Something focusable is always the next stop: no keyboard trap, and nothing swallowed by a div
  expect(reached.some((f) => f.startsWith('button:') || f.startsWith('input:') || f.startsWith('a:'))).toBe(true);

  // The row's instance id is a real link (it has an href, so it can be opened in a new tab), and
  // Enter on it opens the workspace without a mouse
  await page.locator('.tbl tbody tr').first().locator('.link.mono').first().focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('.hero')).toBeVisible();
});

test('nothing animates for a reader who asked for stillness', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHub(page, 'instances');

  // The stylesheet zeroes every transition and animation under the media query; these are the two
  // the app drives itself - the running stripe and the bulk bar that slides in with a selection
  await page.locator('.tbl tbody tr .box').first().click();
  await expect(page.locator('.bulk')).toBeVisible();

  const durations = await page.evaluate(() => {
    const of = (selector: string) => {
      const el = document.querySelector(selector);

      if (!el) {
        return null;
      }

      const style = getComputedStyle(el);

      return `${style.transitionDuration}|${style.animationDuration}`;
    };

    return { bulk: of('.bulk'), stripe: of('.stripe, .st-running'), button: of('.btn') };
  });

  for (const [what, value] of Object.entries(durations)) {
    if (value !== null) {
      expect(value, what).toMatch(/^0s\|0s$/);
    }
  }
});
