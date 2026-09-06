// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The theme QA matrix (E12-S3-T3): every screen worth looking at, in all five themes and both modes,
// photographed for review - and, so that the review has something to hold on to, the tokens each
// theme claims are asserted against what the stylesheet really computes.
//
// The screenshots go to `test-results/themes/` and are not committed; CI keeps them as an artifact.
// `notes/E12-theme-qa.md` is the checklist they were reviewed against.

import { expect, test, type Page } from '@playwright/test';
import { gotoHub, gotoInstance, hub, hubPath, theme } from './fixtures';
import { THEMES } from '../../src/lib/themes';
import { RETRY_EVENT_SEQUENCE_NUMBER, RUNNING_INSTANCE_ID, buildRetryInstance } from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** What each paper is, per design system section 7: only three of the five carry one. */
const PATTERNS: Record<string, string> = {
  poster: 'none',
  riso: 'halftone',
  memphis: 'dots',
  blueprint: 'grid',
  hazard: 'none',
};

/** The instance the Inputs shot is taken of; its dialog is opened and closed, never confirmed. */
const OWNED_ID = `e2e-themes-${Date.now()}`;

const SHOTS = 'test-results/themes';

test.beforeAll(async () => {
  await seedInstances({ hub, instances: [buildRetryInstance(OWNED_ID, new Date())] });
});

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: [OWNED_ID] });
});

/** What the design system prescribes, read back from the document the browser actually painted. */
async function tokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim().toLowerCase();

    return {
      background: read('--background'),
      ink: read('--ink'),
      primary: read('--primary'),
      radius: read('--radius'),
      borderWidth: read('--border-width'),
      shadow: read('--shadow-brutal'),
      pattern: read('--pattern'),
    };
  });
}

/** `#000` and `#000000` are the same colour; the minifier writes whichever is shorter. */
function hex(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);

  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value;
}

/** WCAG relative luminance, which is all this file needs to say "light" and "far apart". */
function luminance(value: string): number {
  const parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex(value));

  if (!parts) {
    throw new Error(`not a hex colour: ${value}`);
  }

  const [r, g, b] = parts.slice(1).map((part) => {
    const channel = parseInt(part, 16) / 255;

    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);

  return (light + 0.05) / (dark + 0.05);
}

/** `0 px · 2 px · 4 px` - what the Settings screen shows, from what the stylesheet computed. */
function metrics(read: Record<string, string>): string {
  const offset = /(-?\d+)px\s+(-?\d+)px/.exec(read.shadow);

  return `${parseInt(read.radius, 10)} px · ${parseInt(read.borderWidth, 10)} px · ${offset ? offset[1] : '?'} px`;
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

for (const entry of THEMES) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${entry.label} ${mode} paints what its token table says`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoHub(page, 'instances');
      await theme(page, entry.label, mode === 'dark');

      const read = await tokens(page);

      // The paper of the mode and the accent, exactly as themes.ts names them for the swatches -
      // the app's own table and the stylesheet cannot drift apart without this failing
      expect(hex(read.background), 'paper').toBe((mode === 'dark' ? entry.dark : entry.paper).toLowerCase());
      expect(hex(read.primary), 'primary').toBe(entry.primary.toLowerCase());

      if (mode === 'light') {
        expect(hex(read.ink), 'ink').toBe(entry.ink.toLowerCase());
      } else {
        // Dark mode inverts the pair: the ink is the light one there, and each theme picks its own
        // off-white for it, so what can be said of all five is that it is light
        expect(luminance(read.ink), 'ink is light in dark mode').toBeGreaterThan(0.5);
      }

      // Whichever way round they are, the line has to read on the paper (design system section 7)
      expect(contrast(read.ink, read.background), 'ink on paper').toBeGreaterThan(7);

      // ...and the three metrics the Settings screen prints under the theme's name
      expect(metrics(read), 'radius · line · shadow').toBe(entry.metrics);

      // A shadow is a hard offset of the ink, never a soft one (design system section 7)
      expect(read.shadow).not.toContain('blur');
      expect(read.shadow).toMatch(/\d+px \d+px 0/);

      // ...and the paper of a theme is plain or patterned, exactly as section 7 says it is
      expect(read.pattern, 'pattern').toBe(PATTERNS[entry.key]);

      // The matrix itself: seven screens, in this theme and this mode
      const name = `${entry.key}-${mode}`;

      await page.goto(hubPath());
      await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
      await shoot(page, `${name}-overview`);

      await page.goto(hubPath('instances'));
      await expect(page.locator('.tbl tbody tr').first()).toBeVisible();
      await page.locator('.tbl tbody tr').nth(0).locator('.box').click();
      await page.locator('.tbl tbody tr').nth(1).locator('.box').click();
      await expect(page.locator('.bulk')).toBeVisible();
      await shoot(page, `${name}-instances-bulk`);

      await gotoInstance(page, RUNNING_INSTANCE_ID, 'timeline');
      await expect(page.locator('.swim')).toBeVisible();
      await shoot(page, `${name}-instance-timeline`);

      await gotoInstance(page, OWNED_ID, 'inputs');
      await page
        .locator('.card.icard')
        .nth(1)
        .getByRole('button', { name: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shoot(page, `${name}-instance-inputs-replay`);
      await page.keyboard.press('Escape');

      await page.goto(hubPath('failures'));
      await expect(page.locator('.group').first()).toBeVisible();
      await shoot(page, `${name}-failures`);

      await page.goto(hubPath('settings'));
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await shoot(page, `${name}-settings`);

      // The hub picker, which is the login screen of a backend with authentication off. A host that
      // serves one hub goes straight to it, and then this shot is of the Overview instead.
      await page.goto('');
      await expect(page.locator('.login, .topbar')).toBeVisible();
      await shoot(page, `${name}-login`);
    });
  }
}

test('the layouts hold at 1024 and at 390', async ({ page }) => {
  // Poster is the theme the mockups are drawn in, so it is the one the narrow layouts are read in
  await gotoHub(page, 'instances');

  for (const mode of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHub(page, 'instances');
    await theme(page, 'Poster', mode === 'dark');

    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 900 });

      await page.goto(hubPath('instances'));
      await expect(page.locator('.tbl, .cards').first()).toBeVisible();
      await shoot(page, `poster-${mode}-instances-${width}`);

      await gotoInstance(page, RUNNING_INSTANCE_ID);
      await expect(page.locator('.hero')).toBeVisible();
      await shoot(page, `poster-${mode}-workspace-${width}`);
    }
  }
});

test('nothing in the bundle is soft or translucent', async ({ page }) => {
  await gotoHub(page);

  const href = await page.locator('link[rel="stylesheet"]').first().getAttribute('href');

  expect(href).toBeTruthy();

  const css = await (await page.request.get(href as string)).text();

  // Design system section 7: flat colour and hard shadows. No alpha channel anywhere...
  expect(css).not.toContain('rgba(');

  // ...no blur except Tailwind's own `.blur` utility definition, which no element in the app uses
  expect(css.split('blur(').length - 1).toBe(css.split('--tw-blur:blur(').length - 1);

  // ...and the one translucent surface the design does allow: the modal overlay (dfm-ui.css L243).
  // The other `color-mix` in the bundle is Tailwind's placeholder rule, which paints text.
  const selectors = [...css.matchAll(/([^{}]*)\{[^{}]*color-mix\([^{}]*\}/g)].map((match) => match[1].trim());

  expect(selectors.filter((selector) => !selector.includes('::placeholder'))).toEqual(['.overlay']);
});
