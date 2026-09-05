/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the emitted CSS bundle (contracts §2): exactly one file under `build/static/css`,
 * carrying `--status-failed` for all five themes in both modes. `build/` is gitignored, so this
 * suite only runs after `npm run build` and is skipped otherwise.
 *
 * Paths are relative to the vitest root, the `durablefunctionsmonitor.svelte` folder. The bundle
 * is minified, so attribute selectors lose their quotes (`[data-theme=riso]`) and the theme rule
 * is matched with the quotes optional.
 */
const CSS_DIR = 'build/static/css';
const built = existsSync(CSS_DIR);
const themes = ['poster', 'riso', 'memphis', 'blueprint', 'hazard'];

describe.skipIf(!built)('built CSS bundle', () => {
  const files = built ? readdirSync(CSS_DIR).sort() : [];

  it('is exactly one file named main.<hex>.css', () => {
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^main\.[0-9a-f]+\.css$/);
  });

  it('declares --status-failed for all five themes in light and dark', () => {
    const css = readFileSync(`${CSS_DIR}/${files[0]}`, 'utf8');

    expect(css.match(/--status-failed:/g) ?? []).toHaveLength(themes.length * 2);

    for (const theme of themes) {
      const rules = css.match(new RegExp(`\\[data-theme=["']?${theme}["']?\\][^{}]*\\{[^{}]*\\}`, 'g')) ?? [];
      const withStatus = rules.filter((rule) => rule.includes('--status-failed:'));
      expect(withStatus.length, `theme ${theme}`).toBe(2);
    }
  });
});
