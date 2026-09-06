# E13 · Theme families

Goal: let a theme belong to a family other than the neo-brutalist one without touching the frozen stylesheets, and make the model, the tests, the docs and the review process family-aware. After E13 a family is one plain-CSS sheet plus one `THEMES` entry, and everything that lists, asserts or reviews themes picks the new one up by itself. E14 (Glass) and E15 (Neu) are the two families this epic exists for; they depend on it and not on each other.

Prerequisites: E12-S3 (E12-S4-T1 stays blocked on the manual extension pass, which has nothing to do with this work, so the dependency is on the story and not on the epic). Read contracts §1, §8, §12; `dfm-design-system.md` §3–§7; `notes/theme-families-investigation.md` (the findings and the spike this plan is built on); decisions D12–D14 in the README.

Exit criteria: with no family sheet yet in the repo, every check is green and nothing looks different; `THEMES` carries a `family`; `--glyph` exists and equals `--ink` in the five papers; the family tests iterate an empty list; the preview harness builds and photographs the five papers; the design-review checklist says which rules are universal and which are brutalist-only.

Rules for every task in E13, E14 and E15:
- `src/styles/dfm-ui.css` and `src/styles/dfm-tokens.css` stay byte-identical to the artifacts (the verbatim tests hold). Family sheets go to `src/styles/families/<key>.css`; shared family plumbing to `src/styles/families/base.css`; nothing family-related goes to `dfm-ext.css`.
- A family sheet is plain CSS the browser can load directly (the preview harness loads it without Tailwind): no `@utility`, `@theme`, `@custom-variant`, `@apply`, no Tailwind classes. Every rule in it is scoped under `[data-theme="<key>"]`, `.dark[data-theme="<key>"]`, `html[data-theme="<key>"]`, `html.dark[data-theme="<key>"]`, or sits inside `@media (prefers-reduced-transparency: reduce)` / `@media (prefers-contrast: more)` with the same scoping. A family sheet may override a `dfm-ui.css` rule for its own theme (D13); `base.css` may not.
- Every token that `[data-theme="poster"]` declares is declared by the family, in the light block and again in the dark block. A missing token would silently inherit Poster's value.
- Universal rules of the design system still hold in every family (D14): status is a solid fill with dark text and keeps its hue; colour is a vocabulary (eight statuses, two kinds, seven node kinds, five series); one loud element per screen; sentence case; verb + object on destructive buttons; icons never alone; the focus ring is a colour, never the line; motion only in answer to an action, and `prefers-reduced-motion` removes it.

### E13-S1 Model, tokens and tests

#### E13-S1-T1 Family in the theme model
Files: `src/lib/themes.ts`, `src/lib/host.svelte.ts`, `src/lib/state/prefs.svelte.ts`, `src/lib/shell/menus.test.ts`, `src/lib/state/prefs.test.ts`
Depends: E12-S3
Do:
1. `themes.ts`: `export type ThemeFamily = 'brutal' | 'glass' | 'neu'`; `ThemeDescriptor` gains `family: ThemeFamily` and the doc comment of `metrics` says what the three numbers are per family: brutal `radius · line · shadow offset`, glass `radius · line · blur`, neu `radius · line · shadow blur`. The five entries get `family: 'brutal'`. Add `export function family(key: ThemeName): ThemeFamily` (falls back like `theme()`).
2. `prefs.svelte.ts`: `themeNames` is derived from `THEMES` (`THEMES.map((entry) => entry.key)`) so the list exists once. `host.svelte.ts` keeps the `ThemeName` union (the families add their key there); nothing else changes.
3. `ThemeMenu.svelte` and `AppearancePanel.svelte` need no change: they iterate `THEMES`. Confirm by reading them, do not touch them.
Accept:
- [x] `THEMES.every((entry) => entry.family === 'brutal')` today; `family('neon')` is `'brutal'`.
- [x] `themeNames` equals `THEMES.map(key)`; the prefs tests that read an unknown stored theme still fall back to `poster`.
Test: unit (`menus.test.ts` asserts the family on the five; `prefs.test.ts` unchanged and green).

#### E13-S1-T2 The `--glyph` token
Files: `src/styles/families/base.css`, `src/app.css`, `src/styles/dfm-ext.css`, `src/lib/charts/StackedColumns.svelte`, `src/lib/charts/SequenceDiagram.svelte`, `src/lib/graph/graph-svg.ts`, `src/lib/charts/chart-tokens.ts`, `tests/unit/styles-verbatim.test.ts`, `tests/e2e/themes.spec.ts`
Depends: E13-S1-T1
Do:
1. `base.css` (new): a header comment saying what a family sheet is (the rules above) and one declaration, `:root { --glyph: var(--ink); }` - the colour of a small solid mark (checkbox tick, switch knob, select caret, sort triangle, arrowhead, the "now" line, the orchestration bar). In the five papers it *is* the ink; a soft family sets it to a strong colour while `--ink` goes soft.
2. `app.css` imports `./styles/families/base.css` after `dfm-ext.css`. Family sheets are imported after it, one line each, in E14 and E15.
3. Re-point the marks the components draw themselves from `--ink` to `--glyph`: `StackedColumns.svelte` axis ticks (L160, L171) and the brush `.selection` stroke and `.handle` fill (L228–L234); `SequenceDiagram.svelte` the `ink` colour used for lifelines and arrows (L115, L138); `graph-svg.ts` the `ink` edge stroke (L135); `dfm-ext.css` `--xy-edge-stroke` (L10) and the two `.swq.wait`/`.swq.orch` swatches. Outlines stay `--ink`: the histogram segments, the swimlane export rects, the node frames.
4. `chart-tokens.ts`: `glyphColor()` next to `inkColor()`; the SVG export resolves `--glyph` like any other token (it already reads computed values, nothing to do there beyond the test).
5. `themes.spec.ts`: in the per-theme test, for `entry.family === 'brutal'` assert the computed `--glyph` equals the computed `--ink`.
Accept:
- [x] In all five papers, both modes, `--glyph` computes to the same value as `--ink` (e2e), so no brutalist screen changes.
- [x] `styles-verbatim.test.ts` asserts `app.css` imports `families/base.css` after `dfm-ext.css`, and that `base.css` contains exactly one rule and it is the `--glyph` default.
Test: unit + the e2e assertion above.

#### E13-S1-T3 Family-aware tests
Files: `tests/e2e/themes.spec.ts`, `tests/e2e/settings.spec.ts`, `tests/e2e/a11y.spec.ts`, `tests/unit/build-css.test.ts`, `tests/unit/family-sheets.test.ts` (new), `src/lib/shell/menus.test.ts`, `src/lib/state/palette.test.ts`
Depends: E13-S1-T2
Do:
1. `themes.spec.ts`, per-theme test: keep every existing assertion for `family === 'brutal'`. For the other families assert instead: `--background` is the mode's paper and `--primary` the accent (unchanged); `--glyph` equals `entry.ink` in light and is light (luminance > 0.5) in dark; contrast of `--foreground` on `--background` over 7:1; the `metrics` string per family (glass reads `--glass-blur`, neu reads the blur radius of the first shadow in `--shadow-brutal`); no `--pattern`. The seven-screen matrix is shot for every family the same way.
2. `themes.spec.ts`, replace "nothing in the bundle is soft or translucent" with "the papers are flat and hard": for each brutal theme × mode, read `getComputedStyle` of a `.btn`, a `.panel`, the `.tbl-wrap` and the `.topbar` on the Instances screen and assert `backdropFilter === 'none'`, `boxShadow` matches `/^rgb\(\d+, \d+, \d+\) -?\d+px -?\d+px 0px 0px$/` or `none`, and `backgroundColor` starts with `rgb(` (no alpha). Reason to move off the bundle text: Lightning CSS rewrites `rgba()` to 8-digit hex, so a text grep proves nothing once a family sheet is in the bundle. Keep one text assertion: the only `color-mix(` outside Tailwind's placeholder rule is `.overlay`.
3. `family-sheets.test.ts` (new, unit): for every `THEMES` entry whose family is not `brutal`, read `src/styles/families/<key>.css` and assert (a) every rule is scoped as the E13 rules say (parse with a small tokenizer: split on `}` outside strings, take the selector text, allow the `@media` wrappers named above); (b) the set of custom-property names declared in the light block equals the set declared by `[data-theme="poster"]` in `dfm-tokens.css`, and the same for the dark block against `.dark[data-theme="poster"]`; (c) `--glyph` is declared in both blocks; (d) no `@utility`, `@theme`, `@custom-variant`, `@apply`. With no family yet the loop is empty and the file says so in a comment.
4. `build-css.test.ts`: the theme list comes from `THEMES` (import from `../../src/lib/themes`); the `--status-failed` count is `THEMES.length * 2`.
5. `settings.spec.ts` L196: `toHaveCount(THEMES.length)`. `menus.test.ts` and `palette.test.ts`: the expected lists are built from `THEMES` rather than written out, so adding a family does not touch them again.
6. `a11y.spec.ts`: the screen loop runs for every entry of a `FAMILY_SAMPLES` list = one theme per family in both modes (`poster` today; E14/E15 append). Keep the run time in mind: the loop is the expensive part, so it is per family, not per theme.
Accept:
- [x] All suites green with five brutal themes and no family sheet; `family-sheets.test.ts` reports zero families checked.
- [x] Removing `--status-failed` from one theme block of a scratch copy of the tokens file makes `build-css.test.ts` fail (do this by hand once; do not commit it).
Test: themselves.

### E13-S2 Preview harness and the rules

#### E13-S2-T1 Style preview harness
Files: `scripts/harness/style-preview.mjs` (new), `durablefunctionsmonitor.svelte/package.json` (script `preview:styles`), `.gitignore`
Depends: E13-S1-T3
Do:
1. `style-preview.mjs` builds `durablefunctionsmonitor.svelte/build/style-preview/index.html` (gitignored) from the frozen `docs/ui-plans-artifacts/uploads/files/dfm-theme-preview.html`: copy it, add one `<link rel="stylesheet" href="…">` per file in `src/styles/families/` (base first, then the sheets, relative paths copied next to the page), and extend the page's inline `THEMES` switcher object with every non-brutal `THEMES` entry from `src/lib/themes.ts` (read the file, pull `key`, `label`, `idea`; do not import Svelte code). The frozen page is never edited and never copied into git.
2. `--shoot`: with Playwright from the Svelte project, open the page as `file://`, and for every theme × mode write three crops at 1440 px (0–1500, 1500–3000, 3000–end) to `durablefunctionsmonitor.svelte/test-results/style-preview/<key>-<mode>-<n>.png`, plus one line per combination printing the computed `--ink`, `--glyph`, `--shadow-brutal`, `--radius`, `--border-width`. This is the spike's procedure (`notes/theme-families-investigation.md`), made repeatable.
3. `npm run preview:styles` runs it with `--shoot`. Document the two commands in the harness header comment and in the commands list of the repo-root `CLAUDE.md`.
Accept:
- [x] With no family sheet the page builds, lists the five papers, and `--shoot` writes 10 combinations × 3 crops.
- [x] The built page loads the family sheets as plain CSS (open it in a browser: no console error, no Tailwind directive left unprocessed - assert by grepping the linked files for `@utility|@theme|@apply`).
Test: run it; a unit test for the patch step (`tests/unit/style-preview.test.ts`) feeds a small stand-in page and asserts the link tags and the switcher entries.

#### E13-S2-T2 Rules, contracts and the review checklist
Files: `docs/plans/svelte-rewrite/00-shared-contracts.md` (§1, §8, new §16), `.claude/skills/dfm-design-review/SKILL.md`, `.claude/agents/dfm-design-reviewer.md`, `.claude/skills/dfm-svelte-ui/SKILL.md`, `CLAUDE.md`, `docs/ui.md`
Depends: E13-S1-T2
Do:
1. Contracts §1: add `styles/families/base.css` and `styles/families/<key>.css` to the layout with one line each. §8: the theme values are "the keys of `THEMES`" instead of the five names. New §16 "Theme families": the family rules from the top of this epic, the universal-versus-brutalist split of `dfm-design-system.md` §3 (D14) as two lists, the `--glyph` token, and the sentence "a family sheet may override a `dfm-ui.css` rule for its own theme; nothing else may".
2. `dfm-design-review/SKILL.md`: the "Visual rules" block becomes two: universal (applies always) and brutalist (applies when the theme's family is `brutal`); add the family look rules for the review of a soft theme (Glass: one blur per surface, never on rows/chips/buttons, a strong glyph, the backdrop only on the page; Neu: one material, raised surfaces, inset inputs and pressed states, no visible line). The "Theme and responsive" line says "switching every theme in `THEMES`". The reviewer agent's procedure adds "and the family's own theme in both modes when the task is an E14/E15 one".
3. `dfm-svelte-ui/SKILL.md` law 1 gains: "family sheets under `src/styles/families/` are the one place allowed to override `dfm-ui.css`, scoped to their theme".
4. `CLAUDE.md` frozen-paths line: after "additions go to `dfm-ext.css`" add "; theme families go to `src/styles/families/` (contracts §16)".
5. `docs/ui.md` "Themes, and the small screen": say themes come in families and that a family's paper, line and shadow differ while status colours keep their meaning; the count is written as "the themes in the menu" so E14/E15 only add their screenshot rows and the value list of `dfmTheme`.
Accept:
- [x] `grep -n "five" docs/ui.md docs/plans/svelte-rewrite/00-shared-contracts.md .claude/skills/dfm-design-review/SKILL.md` shows no sentence that counts the themes as five.
- [x] A design review of E13 itself (the reviewer agent on the Settings screen in Poster) reports no deviation: nothing visible changed.
Test: docs; the reviewer run above, recorded in the commit message.
