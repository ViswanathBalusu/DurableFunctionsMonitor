#!/usr/bin/env node
// Builds a browsable copy of the design-system preview page with every theme family's stylesheet
// linked, and photographs it (E13-S2-T1, docs/plans/svelte-rewrite/E13-theme-families.md).
//
// The frozen page docs/ui-plans-artifacts/uploads/files/dfm-theme-preview.html carries the five
// papers' tokens and the component CSS inline. This script never edits it and never copies it into
// git: the copy goes to durablefunctionsmonitor.svelte/build/style-preview/index.html (gitignored),
// with src/styles/families/*.css next to it (base.css first, then the sheets by name) linked before
// </head>, and the page's own THEMES switcher extended with every entry of src/lib/themes.ts whose
// family is not `brutal` - so the page offers Glass and Neu the way it offers Poster. The sheets are
// loaded as plain CSS, exactly as a browser would: the page has no Tailwind, so a family sheet with
// a Tailwind directive is refused here before it can show up as a broken look.
//
//   node scripts/harness/style-preview.mjs            builds the page
//   node scripts/harness/style-preview.mjs --shoot    ...and photographs every theme x mode: three
//                                                     1440 px crops per combination (0-1500,
//                                                     1500-3000, 3000-end) under
//                                                     durablefunctionsmonitor.svelte/test-results/style-preview/<key>-<mode>-<n>.png
//                                                     and one line each with the computed --ink,
//                                                     --glyph, --shadow-brutal, --radius and
//                                                     --border-width
//   npm run preview:styles                            the same as --shoot, from durablefunctionsmonitor.svelte
//
// This is the spike's procedure (docs/plans/svelte-rewrite/notes/theme-families-investigation.md),
// made repeatable. Playwright comes from the Svelte project's node_modules.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const svelte = path.join(repo, 'durablefunctionsmonitor.svelte');

const SOURCE = path.join(repo, 'docs', 'ui-plans-artifacts', 'uploads', 'files', 'dfm-theme-preview.html');
const FAMILIES = path.join(svelte, 'src', 'styles', 'families');
const THEMES_TS = path.join(svelte, 'src', 'lib', 'themes.ts');
const OUT = path.join(svelte, 'build', 'style-preview');
const SHOTS = path.join(svelte, 'test-results', 'style-preview');

/** What a family sheet may not contain: the page loads it without Tailwind. */
const TAILWIND = /@utility|@theme|@custom-variant|@apply/;

/** The tokens printed per combination: the line, the mark, the shadow and the two metrics. */
const TOKENS = ['--ink', '--glyph', '--shadow-brutal', '--radius', '--border-width'];

/**
 * Loaded through the Svelte project's node_modules at run time. Kept in a variable so that the
 * type checker of that project (checkJs) does not try to resolve the package from this folder.
 */
const PLAYWRIGHT = '@playwright/test';

/** The crops of one combination, top to bottom; the last one runs to the end of the page. */
const BANDS = [
  [0, 1500],
  [1500, 3000],
  [3000, Infinity],
];

/**
 * @typedef {{ key: string, family: string, label: string, idea: string }} ThemeEntry
 */

/**
 * The entries of THEMES in src/lib/themes.ts, read from the source text rather than imported: the
 * module is TypeScript and this script runs on plain Node. Only the four fields the preview page
 * needs are read; the order is the file's.
 * @param {string} source the text of themes.ts
 * @returns {ThemeEntry[]}
 */
export function themeEntries(source) {
  const entry = /\{\s*key:\s*'([^']+)',\s*family:\s*'([^']+)',\s*label:\s*'([^']+)',\s*idea:\s*'([^']+)'/g;

  return [...source.matchAll(entry)].map(([, key, family, label, idea]) => ({ key, family, label, idea }));
}

/**
 * The preview page with the stylesheets linked before `</head>`, in the order given, and the
 * `const THEMES = {...};` switcher line extended with the entries that are not in it yet. Every
 * other byte of the page stays as it was.
 * @param {string} html the frozen page
 * @param {{ sheets: string[], entries: ThemeEntry[] }} options hrefs to link, in order; entries to add
 * @returns {string}
 */
export function patchPreview(html, { sheets, entries }) {
  const head = html.indexOf('</head>');

  if (head < 0) {
    throw new Error('the preview page has no </head> to link the sheets before');
  }

  const links = sheets.map((href) => `<link rel="stylesheet" href="${href}">\n`).join('');
  const linked = `${html.slice(0, head)}${links}${html.slice(head)}`;

  const line = /^const THEMES = (\{.*\});$/m.exec(linked);

  if (!line) {
    throw new Error('the preview page has no `const THEMES = {...};` switcher line to extend');
  }

  /** @type {Record<string, { label: string, concept: string }>} */
  const themes = JSON.parse(line[1]);

  for (const entry of entries) {
    if (!(entry.key in themes)) {
      themes[entry.key] = { label: entry.label, concept: entry.idea.charAt(0).toUpperCase() + entry.idea.slice(1) };
    }
  }

  return linked.replace(line[0], () => `const THEMES = ${JSON.stringify(themes)};`);
}

/**
 * The family sheets, base.css first and the rest by name, or an empty list when the folder is not
 * there yet.
 * @returns {string[]}
 */
function familySheets() {
  if (!fs.existsSync(FAMILIES)) {
    return [];
  }

  return fs
    .readdirSync(FAMILIES)
    .filter((name) => name.endsWith('.css'))
    .sort((a, b) => (a === 'base.css' ? -1 : b === 'base.css' ? 1 : a.localeCompare(b)));
}

/**
 * Writes build/style-preview/index.html and copies the sheets next to it.
 * @returns {{ page: string, sheets: string[], entries: ThemeEntry[] }}
 */
export function build() {
  const sheets = familySheets();

  for (const sheet of sheets) {
    const css = fs.readFileSync(path.join(FAMILIES, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const directive = TAILWIND.exec(css);

    if (directive) {
      throw new Error(`${sheet} contains ${directive[0]}, which the browser cannot process: a family sheet is plain CSS`);
    }
  }

  const entries = themeEntries(fs.readFileSync(THEMES_TS, 'utf8'));
  const html = fs.readFileSync(SOURCE, 'utf8');

  fs.mkdirSync(OUT, { recursive: true });

  for (const sheet of sheets) {
    fs.copyFileSync(path.join(FAMILIES, sheet), path.join(OUT, sheet));
  }

  const page = path.join(OUT, 'index.html');

  fs.writeFileSync(page, patchPreview(html, { sheets, entries: entries.filter((entry) => entry.family !== 'brutal') }));

  return { page, sheets, entries };
}

/**
 * Opens the built page and writes the crops of every theme x mode, printing the tokens of each.
 * @param {string} page the built index.html
 * @param {ThemeEntry[]} entries the themes to photograph
 * @returns {Promise<number>} how many crops were written
 */
export async function shoot(page, entries) {
  const require = createRequire(path.join(svelte, 'package.json'));
  const { chromium } = require(PLAYWRIGHT);

  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let crops = 0;

  // A family sheet that breaks the page shows up here first: a script error fails the run, and
  // whatever the console reports as an error (a font that did not load offline, say) is printed
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const reported = [];

  tab.on(
    'pageerror',
    /** @param {unknown} error */
    (error) => failures.push(String(error)),
  );
  tab.on(
    'console',
    /** @param {{ type: () => string, text: () => string }} message */
    (message) => {
      if (message.type() === 'error') {
        reported.push(message.text());
      }
    },
  );

  try {
    await tab.goto(`file:///${page.replace(/\\/g, '/')}`);

    for (const entry of entries) {
      for (const dark of [false, true]) {
        await tab.evaluate(
          /** @param {[string, boolean]} args */
          ([key, isDark]) => {
            document.documentElement.dataset.theme = key;
            document.documentElement.classList.toggle('dark', isDark);

            // The page's own switcher: repaints the swatch strip and the pressed buttons
            const paint = /** @type {{ paint?: () => void }} */ (/** @type {unknown} */ (window)).paint;
            paint?.();
          },
          [entry.key, dark],
        );
        await tab.waitForTimeout(150);

        const height = await tab.evaluate(() => document.documentElement.scrollHeight);
        const name = `${entry.key}-${dark ? 'dark' : 'light'}`;

        for (const [index, [top, bottom]] of BANDS.entries()) {
          const end = Math.min(bottom, Math.max(height, top + 1));

          await tab.screenshot({
            path: path.join(SHOTS, `${name}-${index + 1}.png`),
            fullPage: true,
            clip: { x: 0, y: top, width: 1440, height: end - top },
          });
          crops++;
        }

        const tokens = await tab.evaluate(
          /** @param {string[]} names */
          (names) => {
            const style = getComputedStyle(document.documentElement);

            return names.map((token) => `${token}=${style.getPropertyValue(token).trim()}`).join(' | ');
          },
          TOKENS,
        );

        console.log(`  ${name}: ${tokens}`);
      }
    }
  } finally {
    await browser.close();
  }

  for (const line of reported) {
    console.warn(`  console error: ${line}`);
  }

  if (failures.length > 0) {
    throw new Error(`the page threw:\n${failures.join('\n')}`);
  }

  return crops;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);

if (invoked && (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self)) {
  const { page, sheets, entries } = build();

  console.log(
    `  built ${path.relative(repo, page)} - sheets: ${sheets.join(', ') || '(none)'}; themes: ${entries.map((entry) => entry.key).join(', ')}`,
  );

  if (process.argv.includes('--shoot')) {
    const crops = await shoot(page, entries);

    console.log(`  ${crops} crops under ${path.relative(repo, SHOTS)}`);
  }
}
