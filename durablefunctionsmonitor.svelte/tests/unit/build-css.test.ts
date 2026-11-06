/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/lib/themes';

/**
 * Guards the emitted CSS bundle (contracts §2): exactly one file under `build/static/css`,
 * carrying `--status-failed` for every theme of THEMES in both modes. `build/` is gitignored, so
 * this suite only runs after `npm run build` and is skipped otherwise.
 *
 * A theme carries the token in its own `[data-theme]` blocks, except in a family of several themes
 * (D15, contracts §16), whose shared tokens - the statuses among them - sit once on its
 * `[data-family]` blocks and reach every theme of the family from there.
 *
 * Paths are relative to the vitest root, the `durablefunctionsmonitor.svelte` folder. The bundle
 * is minified, so attribute selectors lose their quotes (`[data-theme=riso]`) and the theme rule
 * is matched with the quotes optional.
 */
const CSS_DIR = 'build/static/css';
const built = existsSync(CSS_DIR);

/** The families that carry more than one theme, whose shared tokens are declared on the family. */
const SHARED = [...new Set(THEMES.map((entry) => entry.family))].filter(
  (family) => THEMES.filter((entry) => entry.family === family).length > 1 && family !== 'brutal',
);

const ownThemes = THEMES.filter((entry) => !SHARED.includes(entry.family)).map((entry) => entry.key);

/** The rules of a minified bundle whose selector starts with `[<attribute>=<value>]`, in both modes. */
function blocks(css: string, attribute: string, value: string): string[] {
  return css.match(new RegExp(`\\[${attribute}=["']?${value}["']?\\][^{}]*\\{[^{}]*\\}`, 'g')) ?? [];
}

describe.skipIf(!built)('built CSS bundle', () => {
  const files = built ? readdirSync(CSS_DIR).sort() : [];

  it('is exactly one file named main.<hex>.css', () => {
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^main\.[0-9a-f]+\.css$/);
  });

  it('declares --status-failed for every theme in light and dark', () => {
    const css = readFileSync(`${CSS_DIR}/${files[0]}`, 'utf8');

    expect(css.match(/--status-failed:/g) ?? []).toHaveLength((ownThemes.length + SHARED.length) * 2);

    for (const theme of ownThemes) {
      const withStatus = blocks(css, 'data-theme', theme).filter((rule) => rule.includes('--status-failed:'));
      expect(withStatus.length, `theme ${theme}`).toBe(2);
    }

    for (const family of SHARED) {
      const withStatus = blocks(css, 'data-family', family).filter((rule) => rule.includes('--status-failed:'));
      expect(withStatus.length, `family ${family}`).toBe(2);
    }
  });
});
