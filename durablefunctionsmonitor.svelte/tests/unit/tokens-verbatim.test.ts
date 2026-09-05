/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `src/styles/dfm-tokens.css` is a verbatim copy of the design-system artifact (contracts §1),
 * so the themes cannot drift out of the app. jsdom does not compute custom properties, so instead
 * of asserting a resolved colour this compares the two files byte for byte. Line endings are
 * normalised first: the repo checks out with CRLF on Windows (`core.autocrlf=true`).
 *
 * Paths are relative to the vitest root, the `durablefunctionsmonitor.svelte` folder.
 */
const ARTIFACT_PATH = '../docs/ui-plans-artifacts/uploads/files/dfm-tokens.css';
const COPY_PATH = 'src/styles/dfm-tokens.css';

const read = (path: string) => readFileSync(path, 'utf8').split('\r\n').join('\n');

const artifact = read(ARTIFACT_PATH);
const copy = read(COPY_PATH);
const themes = ['poster', 'riso', 'memphis', 'blueprint', 'hazard'];

describe('src/styles/dfm-tokens.css', () => {
  it('is byte-identical to docs/ui-plans-artifacts/uploads/files/dfm-tokens.css', () => {
    expect(copy).toBe(artifact);
  });

  it('starts with the Tailwind import', () => {
    expect(copy.startsWith('@import "tailwindcss";')).toBe(true);
  });

  it('declares --status-failed for all five themes in light and dark', () => {
    expect(copy.match(/^\s*--status-failed:/gm) ?? []).toHaveLength(themes.length * 2);
    for (const theme of themes) {
      expect(copy).toContain(`[data-theme="${theme}"]`);
    }
  });
});
