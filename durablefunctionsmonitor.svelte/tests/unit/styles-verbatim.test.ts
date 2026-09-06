/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `src/styles/dfm-ui.css` is a verbatim copy of the design-system artifact (contracts §12, decision
 * D2): components use its class names and never restate its rules, so the copy must not drift.
 * Line endings are normalised first - the repo checks out with CRLF on Windows (`core.autocrlf=true`).
 *
 * Paths are relative to the vitest root, the `durablefunctionsmonitor.svelte` folder. The tokens file
 * has its own test in tokens-verbatim.test.ts.
 */
const ARTIFACT_PATH = '../docs/ui-plans-artifacts/dfm-ui.css';
const COPY_PATH = 'src/styles/dfm-ui.css';
const EXT_PATH = 'src/styles/dfm-ext.css';
const BASE_PATH = 'src/styles/families/base.css';
const APP_CSS_PATH = 'src/app.css';

const read = (path: string) => readFileSync(path, 'utf8').split('\r\n').join('\n');

describe('src/styles/dfm-ui.css', () => {
  it('is byte-identical to docs/ui-plans-artifacts/dfm-ui.css', () => {
    expect(read(COPY_PATH)).toBe(read(ARTIFACT_PATH));
  });

  it('carries the component classes the screens are assembled from', () => {
    const css = read(COPY_PATH);

    for (const selector of ['.btn', '.chip', '.tbl', '.snav', '.pop', '.dialog', '.peek', '.palette']) {
      expect(css, `${selector} is missing from the copy`).toContain(selector);
    }
  });
});

describe('src/app.css', () => {
  const appCss = read(APP_CSS_PATH);

  it('imports the three stylesheets in cascade order', () => {
    const order = ['./styles/dfm-tokens.css', './styles/dfm-ui.css', './styles/dfm-ext.css'].map((file) =>
      appCss.indexOf(file),
    );

    expect(
      order.every((index) => index >= 0),
      `app.css is missing one of the imports:\n${appCss}`,
    ).toBe(true);

    // dfm-tokens.css imports Tailwind, so both DFM stylesheets win over preflight at equal specificity
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('imports the Svelte Flow base stylesheet before dfm-ui.css, so the token bridge overrides it', () => {
    const flow = appCss.indexOf('@xyflow/svelte/dist/style.css');

    expect(flow).toBeGreaterThanOrEqual(0);
    expect(flow).toBeLessThan(appCss.indexOf('./styles/dfm-ui.css'));
  });

  it('imports families/base.css after dfm-ext.css, so a family sheet can follow it (E13)', () => {
    const base = appCss.indexOf('./styles/families/base.css');

    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeGreaterThan(appCss.indexOf('./styles/dfm-ext.css'));
  });
});

describe('src/styles/families/base.css', () => {
  it('holds exactly one rule, the --glyph default', () => {
    const css = read(BASE_PATH).replace(/\/\*[\s\S]*?\*\//g, '');

    // Whatever every family shares goes here, and today that is one token: strip the comments and
    // what is left has to be `:root { --glyph: var(--ink); }` and nothing else
    expect(css.trim()).toMatch(/^:root\s*\{\s*--glyph:\s*var\(--ink\);?\s*\}$/);
  });
});

describe('src/styles/dfm-ext.css', () => {
  it('says what may and may not go into it', () => {
    const ext = read(EXT_PATH);

    expect(ext).toContain('Additions the mockup stylesheet lacks');
    expect(ext).toContain('Never override a dfm-ui.css rule here');
  });
});
