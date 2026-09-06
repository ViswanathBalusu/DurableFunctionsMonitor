/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/lib/themes';
import { patchPreview, themeEntries } from '../../../scripts/harness/style-preview.mjs';

/**
 * The patch step of the style preview harness (E13-S2-T1): the frozen preview page gets the family
 * sheets linked and its switcher extended, and nothing else about it changes. The stand-in page
 * below has the two hooks the real one has - a `</head>` and a `const THEMES = {...};` line.
 */
const PAGE = `<!doctype html>
<html lang="en" data-theme="poster">
<head>
<title>Stand-in</title>
<style>[data-theme="poster"] { --ink: #000; }</style>
</head>
<body>
<script>
const THEMES = {"poster": {"label": "Poster", "concept": "Bone paper, black line."}};
Object.entries(THEMES).forEach(([key, t]) => { void key; void t; });
</script>
</body>
</html>`;

const SOURCE = `export const THEMES: readonly ThemeDescriptor[] = [
  {
    key: 'poster',
    family: 'brutal',
    label: 'Poster',
    idea: 'bone, black, print',
    metrics: '0 px · 2 px · 4 px',
  },
  { key: 'glass', family: 'glass', label: 'Glass', idea: 'frosted panes over colour', metrics: '14 px · 1 px · blur 16' },
];`;

const GLASS = { key: 'glass', family: 'glass', label: 'Glass', idea: 'frosted panes over colour' };

const switcher = (html: string) => JSON.parse(/^const THEMES = (\{.*\});$/m.exec(html)?.[1] ?? 'null');

describe('themeEntries', () => {
  it('reads key, family, label and idea of every entry from the source text', () => {
    expect(themeEntries(SOURCE)).toEqual([
      { key: 'poster', family: 'brutal', label: 'Poster', idea: 'bone, black, print' },
      GLASS,
    ]);
  });

  it('reads the real themes.ts the same way the app does', () => {
    const entries = themeEntries(readFileSync('src/lib/themes.ts', 'utf8'));

    expect(entries.map((entry) => entry.key)).toEqual(THEMES.map((entry) => entry.key));
    expect(entries.map((entry) => entry.family)).toEqual(THEMES.map((entry) => entry.family));
    expect(entries.map((entry) => entry.label)).toEqual(THEMES.map((entry) => entry.label));
  });
});

describe('patchPreview', () => {
  it('links the sheets before </head>, after the inline styles, in the order given', () => {
    const out = patchPreview(PAGE, { sheets: ['base.css', 'glass.css'], entries: [] });
    const links = [...out.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);

    expect(links).toEqual(['base.css', 'glass.css']);
    expect(out.indexOf('href="base.css"')).toBeGreaterThan(out.indexOf('</style>'));
    expect(out.indexOf('href="glass.css"')).toBeLessThan(out.indexOf('</head>'));
  });

  it('adds every entry to the switcher and keeps the ones the page has', () => {
    const out = patchPreview(PAGE, { sheets: [], entries: [GLASS] });

    expect(switcher(out)).toEqual({
      poster: { label: 'Poster', concept: 'Bone paper, black line.' },
      glass: { label: 'Glass', concept: 'Frosted panes over colour' },
    });
  });

  it('does not add an entry the page already has', () => {
    const poster = { key: 'poster', family: 'brutal', label: 'Poster', idea: 'something else' };
    const out = patchPreview(PAGE, { sheets: [], entries: [poster] });

    expect(switcher(out)).toEqual({ poster: { label: 'Poster', concept: 'Bone paper, black line.' } });
  });

  it('changes nothing else about the page', () => {
    const out = patchPreview(PAGE, { sheets: ['base.css'], entries: [GLASS] });
    const strip = (html: string) =>
      html
        .split('\n')
        .filter((line) => !line.startsWith('<link rel="stylesheet"') && !line.startsWith('const THEMES = '))
        .join('\n');

    expect(strip(out)).toBe(strip(PAGE));
  });

  it('refuses a page without the two hooks', () => {
    expect(() => patchPreview('<html><body></body></html>', { sheets: [], entries: [] })).toThrow(/<\/head>/);
    expect(() => patchPreview('<html><head></head><body></body></html>', { sheets: [], entries: [] })).toThrow(
      /THEMES/,
    );
  });
});
