/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/lib/themes';

/**
 * The rules a theme family's stylesheet has to keep (E13, contracts §16): every rule scoped to its
 * own theme so that nothing leaks into the papers; every token Poster declares declared again in
 * both modes so that nothing inherits Poster's value by accident; `--glyph` in both; plain CSS the
 * preview harness can load without Tailwind.
 *
 * The sheets are read from `src/styles/families/<key>.css` for every entry of THEMES whose family
 * is not `brutal`. With no family in the repo yet the loop is empty, and the parser is exercised on
 * a stand-in sheet below so that the first family meets a test that already works.
 *
 * Paths are relative to the vitest root, the `durablefunctionsmonitor.svelte` folder.
 */
const TOKENS_PATH = 'src/styles/dfm-tokens.css';
const FAMILIES_DIR = 'src/styles/families';

const FAMILIES = THEMES.filter((entry) => entry.family !== 'brutal');

const MEDIA_ALLOWED = ['@media (prefers-reduced-transparency: reduce)', '@media (prefers-contrast: more)'];

const TAILWIND_DIRECTIVES = ['@utility', '@theme', '@custom-variant', '@apply'];

/** The two Poster blocks of dfm-tokens.css: Poster is also the default, so each is a list of two. */
const POSTER_LIGHT = ':root, [data-theme="poster"]';
const POSTER_DARK = '.dark, .dark[data-theme="poster"]';

const read = (path: string) => readFileSync(path, 'utf8').split('\r\n').join('\n');

interface Rule {
  /** The selector list, or the at-rule prelude, with whitespace collapsed. */
  selector: string;
  /** What is between the braces; empty for a `;`-terminated at-rule. */
  body: string;
  /** The `@media` prelude the rule sits in, or null at the top level. */
  media: string | null;
}

/** The index of `char` at or after `from`, skipping over quoted strings; -1 when there is none. */
function scan(css: string, from: number, char: string): number {
  let quote: string | null = null;

  for (let i = from; i < css.length; i++) {
    const c = css[i];

    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === char) {
      return i;
    }
  }

  return -1;
}

/** The index of the `}` that closes the `{` at `open`, nesting and strings respected. */
function closing(css: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < css.length; i++) {
    const c = css[i];

    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return i;
    }
  }

  throw new Error(`unbalanced braces after offset ${open}`);
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * A small tokenizer: walks the sheet, comments removed, and lists every rule as selector + body,
 * with the `@media` prelude it sits in. Other block at-rules (`@layer`, `@theme`, `@keyframes`) are
 * listed as rules too, so the scoping check can reject them; `;`-terminated statements (`@import`)
 * become rules with an empty body for the same reason.
 */
export function rules(sheet: string, media: string | null = null): Rule[] {
  const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let pos = 0;

  const statements = (prelude: string): string[] => prelude.split(';').map(collapse).filter(Boolean);

  for (;;) {
    const open = scan(css, pos, '{');

    if (open < 0) {
      for (const statement of statements(css.slice(pos))) {
        out.push({ selector: statement, body: '', media });
      }

      return out;
    }

    const prelude = statements(css.slice(pos, open));
    const close = closing(css, open);
    const body = css.slice(open + 1, close);

    // `@import x; [data-theme] {` - everything before the last `;` is its own statement
    for (const statement of prelude.slice(0, -1)) {
      out.push({ selector: statement, body: '', media });
    }

    const selector = prelude[prelude.length - 1] ?? '';

    if (selector.startsWith('@media')) {
      out.push(...rules(body, selector));
    } else {
      out.push({ selector, body, media });
    }

    pos = close + 1;
  }
}

/** The selectors of a list, split on the commas that are not inside `:is()` and the like. */
function selectorsOf(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < list.length; i++) {
    const c = list[i];

    if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }

  out.push(list.slice(start).trim());

  return out.filter(Boolean);
}

/**
 * Whether one selector starts with one of the four scopes a family sheet may use for `key`, and
 * nothing else is glued to the scope: what follows is the end, a space or a combinator.
 */
function scoped(selector: string, key: string): boolean {
  return new RegExp(`^(?:html)?(?:\\.dark)?\\[data-theme="${key}"\\](?:$|\\s|[>+~])`).test(selector);
}

/** Every rule of a sheet that is not scoped to `key`, described for a failure message. */
export function unscoped(sheet: string, key: string): string[] {
  const out: string[] = [];

  for (const rule of rules(sheet)) {
    if (rule.media !== null && !MEDIA_ALLOWED.includes(rule.media)) {
      out.push(`${rule.media} { ${rule.selector} }`);
      continue;
    }

    if (rule.selector.startsWith('@')) {
      out.push(rule.selector);
      continue;
    }

    for (const selector of selectorsOf(rule.selector)) {
      if (!scoped(selector, key)) {
        out.push(rule.media ? `${rule.media} { ${selector} }` : selector);
      }
    }
  }

  return out;
}

/** The custom properties declared in the bodies of every rule whose selector is exactly `selector`. */
export function declared(sheet: string, selector: string): Set<string> {
  const wanted = selector.replace(/\s+/g, '');
  const names = new Set<string>();

  for (const rule of rules(sheet)) {
    if (rule.media !== null || rule.selector.replace(/\s+/g, '') !== wanted) {
      continue;
    }

    for (const match of rule.body.matchAll(/(?:^|[;\s])(--[\w-]+)\s*:/g)) {
      names.add(match[1]);
    }
  }

  return names;
}

const missing = (wanted: Set<string>, have: Set<string>) => [...wanted].filter((name) => !have.has(name)).sort();

describe('the family-sheet rules, on a stand-in sheet', () => {
  const SAMPLE = `
    /* a comment, with a { brace and a "quote" in it */
    [data-theme="x"] { --a: 1; --b: url("data:{not-a-brace}"); --c: 'x;y'; }
    .dark[data-theme="x"] { --a: 2; --c: 3; }
    html[data-theme="x"] body::before { content: ""; }
    [data-theme="x"] .btn, html.dark[data-theme="x"] .pop:is(.a, .b) { color: red; }
    @media (prefers-contrast: more) {
      [data-theme="x"] { --ink: #000; }
    }
  `;

  it('lists every rule with the media it sits in', () => {
    const listed = rules(SAMPLE);

    expect(listed.map((rule) => rule.selector)).toEqual([
      '[data-theme="x"]',
      '.dark[data-theme="x"]',
      'html[data-theme="x"] body::before',
      '[data-theme="x"] .btn, html.dark[data-theme="x"] .pop:is(.a, .b)',
      '[data-theme="x"]',
    ]);
    expect(listed.map((rule) => rule.media)).toEqual([null, null, null, null, '@media (prefers-contrast: more)']);
  });

  it('accepts the four scopes and the two media wrappers', () => {
    expect(unscoped(SAMPLE, 'x')).toEqual([]);
  });

  it('rejects a rule for another theme, an unscoped one, and an at-rule', () => {
    expect(unscoped('[data-theme="y"] .btn { color: red; }', 'x')).toEqual(['[data-theme="y"] .btn']);
    expect(unscoped('[data-theme="x"] .btn, .btn { color: red; }', 'x')).toEqual(['.btn']);
    expect(unscoped('[data-theme="x"].dark { --a: 1 }', 'x')).toEqual(['[data-theme="x"].dark']);
    expect(unscoped('@import "x.css"; [data-theme="x"] { --a: 1 }', 'x')).toEqual(['@import "x.css"']);
    expect(unscoped('@keyframes spin { to { rotate: 1turn } }', 'x')).toEqual(['@keyframes spin']);
    expect(unscoped('@media (max-width: 600px) { [data-theme="x"] { --a: 1 } }', 'x')).toEqual([
      '@media (max-width: 600px) { [data-theme="x"] }',
    ]);
    expect(unscoped('@media (prefers-contrast: more) { .btn { --a: 1 } }', 'x')).toEqual([
      '@media (prefers-contrast: more) { .btn }',
    ]);
  });

  it('collects the tokens a block declares, strings and all', () => {
    expect([...declared(SAMPLE, '[data-theme="x"]')].sort()).toEqual(['--a', '--b', '--c']);
    expect([...declared(SAMPLE, '.dark[data-theme="x"]')].sort()).toEqual(['--a', '--c']);
    expect(declared(SAMPLE, 'html[data-theme="x"] body::before').size).toBe(0);
  });

  it('reads the Poster blocks of the tokens file, which is what a family is held to', () => {
    const tokens = read(TOKENS_PATH);
    const light = declared(tokens, POSTER_LIGHT);
    const dark = declared(tokens, POSTER_DARK);

    for (const name of ['--background', '--foreground', '--ink', '--status-failed']) {
      expect(light.has(name), `${name} in the light block`).toBe(true);
      expect(dark.has(name), `${name} in the dark block`).toBe(true);
    }

    // The dark block restates what changes in the dark, which is the colours: the metrics and the
    // paper pattern are declared once, in the light block, so a family's dark block is held to the
    // dark set only, not to the light one
    for (const name of ['--radius', '--border-width', '--pattern']) {
      expect(light.has(name), `${name} in the light block`).toBe(true);
      expect(dark.has(name), `${name} in the dark block`).toBe(false);
    }

    expect(light.size).toBeGreaterThan(50);
    expect(dark.size).toBeGreaterThan(50);
  });
});

describe('the family sheets', () => {
  it(`covers every theme of THEMES that is not a paper (${FAMILIES.length} today)`, () => {
    // No family sheet is in the repo yet: E14 adds glass.css, E15 neu.css, and each shows up here
    // by its THEMES entry alone
    expect(FAMILIES.map((entry) => entry.key)).toEqual(
      THEMES.filter((entry) => entry.family !== 'brutal').map((entry) => entry.key),
    );
  });

  for (const entry of FAMILIES) {
    describe(`${entry.key}.css`, () => {
      const sheet = read(`${FAMILIES_DIR}/${entry.key}.css`);
      const tokens = read(TOKENS_PATH);

      it('scopes every rule to its own theme', () => {
        expect(unscoped(sheet, entry.key)).toEqual([]);
      });

      it('declares every token Poster declares, in the light block and in the dark block', () => {
        const light = declared(sheet, `[data-theme="${entry.key}"]`);
        const dark = declared(sheet, `.dark[data-theme="${entry.key}"]`);

        expect(missing(declared(tokens, POSTER_LIGHT), light), 'light').toEqual([]);
        expect(missing(declared(tokens, POSTER_DARK), dark), 'dark').toEqual([]);
      });

      it('declares --glyph in both blocks', () => {
        expect(declared(sheet, `[data-theme="${entry.key}"]`).has('--glyph')).toBe(true);
        expect(declared(sheet, `.dark[data-theme="${entry.key}"]`).has('--glyph')).toBe(true);
      });

      it('is plain CSS, with nothing for Tailwind to process', () => {
        const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');

        for (const directive of TAILWIND_DIRECTIVES) {
          expect(css, directive).not.toContain(directive);
        }
      });

      if (entry.family === 'neu') {
        it('answers prefers-contrast: more with a line, in both modes', () => {
          // Playwright cannot emulate the media feature, so the block is held to here (E15-S2-T2):
          // a family with no visible line has to give every surface an edge when asked
          const more = rules(sheet).filter((rule) => rule.media === '@media (prefers-contrast: more)');
          const inkIn = (selector: string) =>
            more.some(
              (rule) => rule.selector.replace(/\s+/g, '') === selector && /(?:^|[;\s])--ink\s*:/.test(rule.body),
            );

          expect(more.length, 'rules under prefers-contrast: more').toBeGreaterThan(0);
          expect(inkIn(`[data-theme="${entry.key}"]`), '--ink in the light block').toBe(true);
          expect(inkIn(`.dark[data-theme="${entry.key}"]`), '--ink in the dark block').toBe(true);
        });
      }
    });
  }
});
