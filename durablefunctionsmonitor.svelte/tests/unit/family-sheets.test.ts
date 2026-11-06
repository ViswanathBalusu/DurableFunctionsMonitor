/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../../src/lib/themes';

/**
 * The rules a theme family's stylesheet has to keep (E13, D15, contracts §16): every rule scoped to
 * its own themes or to its family so that nothing leaks into the papers; every token Poster declares
 * declared again in both modes, for every theme of the family, so that nothing inherits Poster's
 * value by accident; `--glyph` in both; plain CSS the preview harness can load without Tailwind.
 *
 * A family is one sheet, `src/styles/families/<family>.css`, for every family of THEMES that is not
 * `brutal`. Glass and Neu are one theme each, named like their family; Studio is four. A family that
 * carries several themes scopes its shared tokens and its component layer to `[data-family]`, which
 * prefs.svelte.ts sets from the theme, and each theme's own tokens to its `[data-theme]`: what a
 * theme is held to is the union of the two blocks of its mode.
 *
 * Paths are relative to the vitest root, the `durablefunctionsmonitor.svelte` folder.
 */
const TOKENS_PATH = 'src/styles/dfm-tokens.css';
const FAMILIES_DIR = 'src/styles/families';

/** Every family that has a sheet, with the keys of its themes. */
const FAMILIES = [...new Set(THEMES.filter((entry) => entry.family !== 'brutal').map((entry) => entry.family))].map(
  (name) => ({ name, keys: THEMES.filter((entry) => entry.family === name).map((entry) => entry.key as string) }),
);

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
 * Whether one selector starts with one of the scopes a family sheet may use - `[data-theme]` of one
 * of its themes or `[data-family]` of the family, either alone, after `html`, after `.dark` or after
 * `html.dark` - and nothing else is glued to the scope: what follows is the end, a space or a
 * combinator.
 */
function scoped(selector: string, keys: string[], family?: string): boolean {
  const attributes = keys.map((key) => `\\[data-theme="${key}"\\]`);

  if (family) {
    attributes.push(`\\[data-family="${family}"\\]`);
  }

  return new RegExp(`^(?:html)?(?:\\.dark)?(?:${attributes.join('|')})(?:$|\\s|[>+~])`).test(selector);
}

/**
 * Every rule of a sheet that is not scoped to one of `keys` (a theme key, or the keys of a family's
 * themes) or to `family`, described for a failure message.
 */
export function unscoped(sheet: string, keys: string | string[], family?: string): string[] {
  const themes = Array.isArray(keys) ? keys : [keys];
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
      if (!scoped(selector, themes, family)) {
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

  it('accepts the family scope and every theme of the family, and nothing of another family', () => {
    const family = `
      [data-family="f"] { --radius: 8px; }
      .dark[data-family="f"] { --ink: #222; }
      [data-theme="a"] { --primary: #111; }
      .dark[data-theme="b"] { --primary: #222; }
      html[data-family="f"] body, [data-family="f"] .btn:hover { color: red; }
      @media (prefers-contrast: more) { .dark[data-family="f"] { --ink: #fff; } }
    `;

    expect(unscoped(family, ['a', 'b'], 'f')).toEqual([]);
    expect(unscoped('[data-family="g"] .btn { color: red; }', ['a', 'b'], 'f')).toEqual(['[data-family="g"] .btn']);
    expect(unscoped('[data-theme="c"] { --a: 1 }', ['a', 'b'], 'f')).toEqual(['[data-theme="c"]']);
    expect(unscoped('[data-family="f"].dark { --a: 1 }', ['a'], 'f')).toEqual(['[data-family="f"].dark']);
    // ...and a sheet with no family name may not use the family scope at all
    expect(unscoped('[data-family="f"] { --a: 1 }', 'a')).toEqual(['[data-family="f"]']);
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

/** Whether a sheet sets `--ink` for `selector` under `@media (prefers-contrast: more)`. */
function inkUnderMoreContrast(sheet: string, selector: string): boolean {
  return rules(sheet).some(
    (rule) =>
      rule.media === '@media (prefers-contrast: more)' &&
      rule.selector.replace(/\s+/g, '') === selector &&
      /(?:^|[;\s])--ink\s*:/.test(rule.body),
  );
}

describe('the family sheets', () => {
  it(`covers every family of THEMES that is not the papers (${FAMILIES.length} today)`, () => {
    // Each family shows up here by its THEMES entries alone: E14 added glass.css, E15 neu.css,
    // D15 studio.css with its four themes
    expect(FAMILIES.map((family) => family.name).sort()).toEqual(['glass', 'neu', 'studio']);
    expect(FAMILIES.find((family) => family.name === 'studio')?.keys).toEqual(['iris', 'jade', 'ember', 'mono']);
  });

  for (const family of FAMILIES) {
    describe(`${family.name}.css`, () => {
      const sheet = read(`${FAMILIES_DIR}/${family.name}.css`);
      const tokens = read(TOKENS_PATH);
      // A family of one theme is named like it and scopes to its [data-theme] alone (E14, E15)
      const shared = family.keys.length > 1 ? family.name : undefined;

      const lightOf = (key: string) =>
        new Set([
          ...declared(sheet, `[data-theme="${key}"]`),
          ...(shared ? declared(sheet, `[data-family="${shared}"]`) : []),
        ]);
      const darkOf = (key: string) =>
        new Set([
          ...declared(sheet, `.dark[data-theme="${key}"]`),
          ...(shared ? declared(sheet, `.dark[data-family="${shared}"]`) : []),
        ]);

      it('scopes every rule to its own themes or its family', () => {
        expect(unscoped(sheet, family.keys, shared)).toEqual([]);
      });

      for (const key of family.keys) {
        it(`declares every token Poster declares for ${key}, in the light block and in the dark block`, () => {
          expect(missing(declared(tokens, POSTER_LIGHT), lightOf(key)), 'light').toEqual([]);
          expect(missing(declared(tokens, POSTER_DARK), darkOf(key)), 'dark').toEqual([]);
        });

        it(`declares --glyph for ${key} in both modes`, () => {
          expect(lightOf(key).has('--glyph')).toBe(true);
          expect(darkOf(key).has('--glyph')).toBe(true);
        });
      }

      it('is plain CSS, with nothing for Tailwind to process', () => {
        const css = sheet.replace(/\/\*[\s\S]*?\*\//g, '');

        for (const directive of TAILWIND_DIRECTIVES) {
          expect(css, directive).not.toContain(directive);
        }
      });

      if (family.name === 'neu') {
        it('answers prefers-contrast: more with a line, in both modes', () => {
          // Playwright cannot emulate the media feature, so the block is held to here (E15-S2-T2):
          // a family with no visible line has to give every surface an edge when asked
          expect(inkUnderMoreContrast(sheet, '[data-theme="neu"]'), '--ink in the light block').toBe(true);
          expect(inkUnderMoreContrast(sheet, '.dark[data-theme="neu"]'), '--ink in the dark block').toBe(true);
        });
      }

      if (family.name === 'studio') {
        it('answers prefers-contrast: more with stronger lines, in both modes', () => {
          // Studio's lines are hairlines on purpose; a reader who asks for more contrast gets them darker
          // (lighter at night) for every theme, which is why the block sits on the family scope
          expect(inkUnderMoreContrast(sheet, '[data-family="studio"]'), '--ink in the light block').toBe(true);
          expect(inkUnderMoreContrast(sheet, '.dark[data-family="studio"]'), '--ink in the dark block').toBe(true);
        });

        it('gives every theme a button colour of its own in both modes', () => {
          // `--solid` is what a primary button is filled with: the accent, or Mono's inverse of the page
          for (const key of family.keys) {
            for (const name of ['--solid', '--solid-foreground', '--link', '--line-soft', '--line-strong']) {
              expect(lightOf(key).has(name), `${key} light ${name}`).toBe(true);
              expect(darkOf(key).has(name), `${key} dark ${name}`).toBe(true);
            }
          }
        });
      }
    });
  }
});
