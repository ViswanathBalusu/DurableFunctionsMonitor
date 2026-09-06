// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The theme QA matrix (E12-S3-T3, family-aware since E13-S1-T3): every screen worth looking at, in
// every theme and both modes, photographed for review - and, so that the review has something to
// hold on to, the tokens each theme claims are asserted against what the stylesheet really computes.
// What is asserted depends on the theme's family (themes.ts): the papers are held to the design
// system's brutalist rules, a soft family to the universal ones, to its own metrics, and to the
// contrast of its text over its translucent panes, which axe leaves "incomplete" (E14-S2-T2).
//
// The screenshots go to `test-results/themes/` and are not committed; CI keeps them as an artifact.
// `notes/E12-theme-qa.md` is the checklist they were reviewed against.

import { expect, test, type Page } from '@playwright/test';
import { gotoHub, gotoInstance, hub, hubPath, theme } from './fixtures';
import { THEMES, type ThemeFamily } from '../../src/lib/themes';
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

const MODES = ['light', 'dark'] as const;

const PAPERS = THEMES.filter((entry) => entry.family === 'brutal');

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
      foreground: read('--foreground'),
      ink: read('--ink'),
      glyph: read('--glyph'),
      primary: read('--primary'),
      radius: read('--radius'),
      borderWidth: read('--border-width'),
      shadow: read('--shadow-brutal'),
      pattern: read('--pattern'),
      glassBlur: read('--glass-blur'),
      ring: read('--ring'),
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

/**
 * The three numbers the Settings screen prints under a theme's name, from what the stylesheet
 * computed. What the third one is depends on the family (themes.ts): the shadow offset of a paper,
 * the backdrop blur of Glass, the blur radius of the first shadow of Neu.
 */
function metrics(family: ThemeFamily, read: Record<string, string>): string {
  const radius = parseInt(read.radius, 10);
  const line = parseInt(read.borderWidth, 10);

  switch (family) {
    case 'glass':
      return `${radius} px · ${line} px · blur ${parseInt(read.glassBlur, 10)}`;
    case 'neu': {
      // `6px 6px 14px <colour>, ...`: the third length of the first shadow is its blur radius
      const blur = /^(-?\d+)px\s+(-?\d+)px\s+(\d+)px/.exec(read.shadow);

      return `${radius} px · ${line} px · ${blur ? blur[3] : '?'} px`;
    }
    default: {
      const offset = /(-?\d+)px\s+(-?\d+)px/.exec(read.shadow);

      return `${radius} px · ${line} px · ${offset ? offset[1] : '?'} px`;
    }
  }
}

interface Sampled {
  /** The text colour, as painted, over what is behind it. */
  color: string;
  /** What is behind it: the surface's own paint composited over the page's paper. */
  background: string;
}

/**
 * The colour of the first element `text` finds and the colour behind it, as hex, with the surface's
 * translucent fill composited over the page's paper by hand (E14-S2-T2). axe reports text on a
 * translucent background as "incomplete" rather than failing it, so a soft family checks its own
 * pairs here. The blobs behind the paper are ignored: they are lighter than the paper in light mode
 * and darker in dark mode by construction, so the paper is the worse case.
 */
async function sampled(page: Page, text: string, surface: string): Promise<Sampled> {
  return page.evaluate(
    ([textSelector, surfaceSelector]) => {
      type Rgba = [number, number, number, number];

      const parse = (value: string): Rgba => {
        const parts = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(value);

        if (!parts) {
          throw new Error(`not an rgb colour: ${value}`);
        }

        return [+parts[1], +parts[2], +parts[3], parts[4] === undefined ? 1 : +parts[4]];
      };
      const over = (top: Rgba, under: Rgba): Rgba => [
        Math.round(top[0] * top[3] + under[0] * (1 - top[3])),
        Math.round(top[1] * top[3] + under[1] * (1 - top[3])),
        Math.round(top[2] * top[3] + under[2] * (1 - top[3])),
        1,
      ];
      const hex = (rgba: Rgba) =>
        `#${rgba
          .slice(0, 3)
          .map((channel) => channel.toString(16).padStart(2, '0'))
          .join('')}`;

      const element = document.querySelector(textSelector);
      const surfaceElement = document.querySelector(surfaceSelector);

      if (!element || !surfaceElement) {
        throw new Error(`nothing matches ${element ? surfaceSelector : textSelector}`);
      }

      const paper = parse(getComputedStyle(document.body).backgroundColor);
      const behind = over(parse(getComputedStyle(surfaceElement).backgroundColor), paper);

      return { color: hex(over(parse(getComputedStyle(element).color), behind)), background: hex(behind) };
    },
    [text, surface],
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

for (const entry of THEMES) {
  for (const mode of MODES) {
    test(`${entry.label} ${mode} paints what its token table says`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoHub(page, 'instances');
      await theme(page, entry.label, mode === 'dark');

      const read = await tokens(page);

      // The paper of the mode and the accent, exactly as themes.ts names them for the swatches -
      // the app's own table and the stylesheet cannot drift apart without this failing
      expect(hex(read.background), 'paper').toBe((mode === 'dark' ? entry.dark : entry.paper).toLowerCase());
      expect(hex(read.primary), 'primary').toBe(entry.primary.toLowerCase());

      // ...and the three metrics the Settings screen prints under the theme's name
      expect(metrics(entry.family, read), 'metrics').toBe(entry.metrics);

      if (entry.family === 'brutal') {
        if (mode === 'light') {
          expect(hex(read.ink), 'ink').toBe(entry.ink.toLowerCase());
        } else {
          // Dark mode inverts the pair: the ink is the light one there, and each paper picks its
          // own off-white for it, so what can be said of all of them is that it is light
          expect(luminance(read.ink), 'ink is light in dark mode').toBeGreaterThan(0.5);
        }

        // Whichever way round they are, the line has to read on the paper (design system section 7)
        expect(contrast(read.ink, read.background), 'ink on paper').toBeGreaterThan(7);

        // In the papers a mark is drawn in the ink: `--glyph` (families/base.css) computes to it, so
        // nothing a brutalist theme paints has changed by the token existing (E13-S1-T2)
        expect(read.glyph, 'glyph is the ink').toBe(read.ink);

        // A shadow is a hard offset of the ink, never a soft one (design system section 7)
        expect(read.shadow).not.toContain('blur');
        expect(read.shadow).toMatch(/\d+px \d+px 0/);

        // ...and the paper of a theme is plain or patterned, exactly as section 7 says it is
        expect(read.pattern, 'pattern').toBe(PATTERNS[entry.key]);
      } else {
        // A soft family lets its line fade and keeps its marks strong: `ink` in themes.ts is the
        // colour of a mark, which is what the swatch shows (contracts section 16)
        if (mode === 'light') {
          expect(hex(read.glyph), 'glyph').toBe(entry.ink.toLowerCase());
        } else {
          expect(luminance(read.glyph), 'glyph is light in dark mode').toBeGreaterThan(0.5);
        }

        // The universal rule the line no longer carries: the text has to read on the paper
        expect(contrast(read.foreground, read.background), 'text on paper').toBeGreaterThan(7);

        // A soft family's backdrop is its own and never a paper pattern
        expect(read.pattern, 'pattern').toBe('none');

        // The pairs a reader meets first, composited by hand because the pane is translucent: a
        // cell of the table on its frosted frame, and the focus ring on that frame and on the paper
        await expect(page.locator('.tbl tbody tr').first()).toBeVisible();

        const cell = await sampled(page, '.tbl tbody tr td:not(.spine):not(.sel-cell)', '.tbl-wrap');

        expect(contrast(cell.color, cell.background), 'table text on the frame').toBeGreaterThan(4.5);
        expect(contrast(read.ring, cell.background), 'focus ring on the frame').toBeGreaterThan(3);
        expect(contrast(read.ring, read.background), 'focus ring on the paper').toBeGreaterThan(3);
      }

      // The matrix itself: seven screens, in this theme and this mode
      const name = `${entry.key}-${mode}`;

      await page.goto(hubPath());
      await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

      if (entry.family !== 'brutal') {
        // ...and the muted text of a panel on its frosted pane, the other pair axe leaves open
        await expect(page.locator('.panel .meta, .panel .muted').first()).toBeVisible();

        const meta = await sampled(page, '.panel .meta, .panel .muted', '.panel');

        expect(contrast(meta.color, meta.background), 'muted text on a panel').toBeGreaterThan(4.5);
      }

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

  for (const mode of MODES) {
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

interface Surface {
  backdropFilter: string;
  boxShadow: string;
  backgroundColor: string;
}

/** The painted state of the first element each selector finds, or null where the screen has none. */
async function surfaces(page: Page, selectors: string[]): Promise<Record<string, Surface | null>> {
  return page.evaluate((list) => {
    const out: Record<string, Surface | null> = {};

    for (const selector of list) {
      const el = document.querySelector(selector);

      if (!el) {
        out[selector] = null;
        continue;
      }

      const style = getComputedStyle(el);

      out[selector] = {
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
        backgroundColor: style.backgroundColor,
      };
    }

    return out;
  }, selectors);
}

test('the papers are flat and hard', async ({ page }) => {
  // Design system section 7: flat colour and hard shadows. The bundle's text cannot say so once a
  // family sheet is in it (the minifier writes `rgba()` as eight-digit hex), so this reads what the
  // browser painted: a button, the table frame and the top bar on the Instances screen, a panel on
  // the Overview - no backdrop filter, a shadow that is one hard offset of a solid colour or none at
  // all, and a background with no alpha channel.
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHub(page, 'instances');

  for (const entry of PAPERS) {
    for (const mode of MODES) {
      await page.goto(hubPath('instances'));
      await expect(page.locator('.tbl-wrap')).toBeVisible();
      await theme(page, entry.label, mode === 'dark');

      const read = await surfaces(page, ['.btn', '.tbl-wrap', '.topbar']);

      await page.goto(hubPath());
      await expect(page.locator('.panel').first()).toBeVisible();
      Object.assign(read, await surfaces(page, ['.panel']));

      for (const [selector, style] of Object.entries(read)) {
        const label = `${entry.key} ${mode} ${selector}`;

        expect(style, label).not.toBeNull();
        expect(style?.backdropFilter, `${label} backdrop`).toBe('none');
        expect(style?.boxShadow, `${label} shadow`).toMatch(/^(none|rgb\(\d+, \d+, \d+\) -?\d+px -?\d+px 0px 0px)$/);
        expect(style?.backgroundColor, `${label} background`).toMatch(/^rgb\(/);
      }
    }
  }
});

test('the modal overlay is the one translucent surface in the bundle', async ({ page }) => {
  await gotoHub(page);

  const href = await page.locator('link[rel="stylesheet"]').first().getAttribute('href');

  expect(href).toBeTruthy();

  const css = await (await page.request.get(href as string)).text();

  // The one translucent surface the design does allow: the modal overlay (dfm-ui.css L243). The
  // other `color-mix` in the bundle is Tailwind's placeholder rule, which paints text.
  const selectors = [...css.matchAll(/([^{}]*)\{[^{}]*color-mix\([^{}]*\}/g)].map((match) => match[1].trim());

  expect(selectors.filter((selector) => !selector.includes('::placeholder'))).toEqual(['.overlay']);
});
