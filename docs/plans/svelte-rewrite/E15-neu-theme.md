# E15 · Neu

Goal: a Neumorphism theme, `neu`, in light and dark: one material for page and surfaces, elevation from a pair of soft shadows (light from the top left, shade to the bottom right), inputs and pressed states sunk into the surface, no visible line, strong marks. A theme like the five papers - same menu, same key, same `dfmTheme` - so the choice is `data-theme="neu"` and nothing more.

Prerequisites: E13. Read `notes/theme-families-investigation.md` and the candidate sheet `notes/theme-families-spike/families.css` (the Neu half is the starting point of E15-S1-T1; every value may change in review, the structure should not). Contracts §16. E14 is not a prerequisite; where E14-S2-T1 moved an inline value to a `base.css` token, reuse the token rather than adding a second one.

Exit criteria: Neu appears in the theme menu, the Settings tiles and the palette; every screen of the theme QA matrix reads as neumorphic in both modes; the a11y pass is green in both modes; the five papers are pixel-for-pixel what they were.

The look, in words (the reviewer's reference until the preview is shot):
- **Material.** `--background`, `--card`, `--sidebar`, `--secondary`, `--input` are the *same* colour: `#E3E8F0` light, `#2A2E37` dark. `--popover` is one step lighter; `--muted` one step darker (header rows, hover).
- **Elevation.** `--shadow-brutal` is a pair: `6px 6px 14px` of the shade colour and `-6px -6px 14px` of the light colour (`--neu-dark` `rgba(163,177,198,.55)` / `--neu-light` `rgba(255,255,255,.85)` in light; `rgba(15,17,22,.75)` / `rgba(62,68,80,.7)` in dark). `-sm` is 3/8, `-lg` 12/28, hover 9/20. A new `--shadow-inset` is the same pair inset at 4/10 and is what an input, a pressed button, a pressed segment and the selected tab wear. Panels, the swimlane, the sequence diagram, the graph frame, notes and banners are raised (dfm-ui.css leaves `.panel` shadowless on purpose; the family adds it). The side nav casts to the right, the top bar downward.
- **Line.** `--border-width: 1px`; `--ink` is the shade colour at 35 % (light) or white at 6 % (dark) - present so that rules and separators still exist, but never read as an outline. `--glyph` is the text colour.
- **Motion.** Hover deepens the shadow; press swaps it for `--shadow-inset`; nothing translates.
- **Radius.** 16 px (`--radius`).
- **Colour.** Primary `#5B5BD6` / `#818CF8`, accent periwinkle, destructive coral; status fills are the eight hues as pastels in light (`#86EFAC`, `#FDE68A`, `#FCA5A5`, …) with dark text, and the jewel set in dark; kind-entity pink; the five series indigo / magenta / teal / green / amber.
- **Overlay.** `rgba(20,24,32,.3)`, no blur.
- **More contrast.** `@media (prefers-contrast: more)`: `--ink` becomes `--muted-foreground` at 40 % so every surface gets a discernible edge; the shadows stay.

### E15-S1 Tokens and sheet

#### E15-S1-T1 neu.css and the descriptor
Files: `src/styles/families/neu.css` (new), `src/app.css`, `src/lib/themes.ts`, `src/lib/host.svelte.ts`, `tests/unit/family-sheets.test.ts`
Depends: E13
Do:
1. `neu.css` from the Neu half of the spike sheet, in this order with a comment above each block: (1) the light token block `[data-theme="neu"]` - every token Poster declares, plus `--glyph`, `--neu-light`, `--neu-dark`, `--shadow-inset`, the four `--shadow-brutal*` and `--stripe` re-declared; (2) the dark block `.dark[data-theme="neu"]`, same set; (3) `html[data-theme="neu"] body` (no pattern); (4) the raised surfaces (`.panel`, `.swim`, `.seq`, `.graph`, `.note`, `.banner`, the `.snav` and `.topbar` casts); (5) the sunk surfaces (`.input`, `.ed`, `.palette > input`) and `.tbl th` transparent, `.overlay`; (6) motion (`:hover` no translate, `:active` inset, `.seg button[aria-pressed="true"]`, `.tab[aria-selected="true"]` inset); (7) the glyph re-points (the same list as E14-S1-T1 step 1 (7)); (8) the 2 px hard-coded borders thinned to 1 px (same list as E14); (9) the `prefers-contrast: more` block.
2. `app.css`: `@import './styles/families/neu.css';` after the last family import.
3. `themes.ts`: append `{ key: 'neu', family: 'neu', label: 'Neu', idea: 'one soft material', metrics: '16 px · 1 px · 14 px', paper: '#E3E8F0', ink: '#1F2937', primary: '#5B5BD6', dark: '#2A2E37' }` - `ink` is the glyph colour. `host.svelte.ts`: `'neu'` joins the union.
4. Run `npm run preview:styles`; adjust until the description holds. The table header rule and the row separators are the first things to check: with a 6 % line they can vanish in dark mode, and the answer is `border-bottom-color: var(--muted)` on `.tbl th` inside the family sheet, not a stronger `--ink`.
Accept:
- [x] `family-sheets.test.ts` checks Neu and passes.
- [x] `npm run build && npm run verify` pass; `build-css.test.ts` counts `THEMES.length * 2`.
- [x] `themes.spec.ts` for `Neu light` and `Neu dark` passes the family assertions and shoots the seven screens.
Test: as named.

#### E15-S1-T2 Preview review
Files: `docs/plans/svelte-rewrite/notes/E15-neu-review.md` (new), `src/styles/families/neu.css`
Depends: E15-S1-T1
Do:
1. Review the preview crops of both modes against the look above and the universal rules, section by section as E14-S1-T2 does; table of section / defect / change.
2. Contrast, both modes: foreground on background, muted-foreground on background, every status foreground on its pastel or jewel fill, primary-foreground on primary, destructive-foreground on destructive, ring on background - and, specific to this family, the *edge* of a raised surface: the luminance difference between `--neu-dark` composited over the paper and the paper itself is written down, so a reviewer can say whether the elevation reads on a cheap screen. Text pairs 4.5:1, ring 3:1.
3. Fix the sheet; re-shoot.
Accept:
- [x] The notes file lists every pair with its ratio and none is under the threshold.
- [x] Both modes of the preview page have no section the review still marks wrong.
Test: manual review, recorded; `themes.spec.ts` green.

### E15-S2 In the app

#### E15-S2-T1 Screens pass
Files: `src/styles/families/neu.css`, touched components, `docs/plans/svelte-rewrite/notes/E15-neu-qa.md` (new)
Depends: E15-S1-T2
Do:
1. As E14-S2-T1: the matrix shots plus the overlays and the drawn things by hand (peek, palette, More sheet and bottom nav at 390 px, a menu, a Select list, the JSON viewer and editor - `.jse-theme-dfm` should sit in a sunk frame like `.ed`, the graph, the swimlane, the sequence diagram, the histogram brush, toasts, the progress stripe). Two things are Neu-specific: (a) a raised surface inside a raised surface (a `.card` in a `.panel`, a `.btn` in a `.tbl-wrap`) must still read - if the inner shadow is lost against the outer, the inner one goes to `-sm`; (b) the selected table row (`--accent`) and the hover row (`--muted`) must be visible on the same material.
2. Defects go to a token, a rule in `neu.css`, or a component; the component rule of E14-S2-T1 step 2 applies unchanged.
3. Notes file as `E12-theme-qa.md`.
Accept:
- [x] No screen of the matrix and no overlay breaks the look (an outline, a hard shadow, a flat panel among raised ones, an input that is not sunk, a mark that vanished).
- [x] The five papers' `themes.spec.ts` cases and the brutalist computed-style test are unchanged and green.
Test: e2e; the notes file.

#### E15-S2-T2 Accessibility in Neu
Files: `tests/e2e/a11y.spec.ts`, `tests/e2e/themes.spec.ts`, touched components or `neu.css`
Depends: E15-S2-T1
Do:
1. `a11y.spec.ts`: add `neu` to `FAMILY_SAMPLES`; fix every serious/critical violation in both modes. The low-contrast risk of this family is edges, not text; axe does not measure edges, so:
2. `themes.spec.ts`, for `family === 'neu'`: assert the computed `box-shadow` of a `.btn` and of `.tbl-wrap` on the Instances screen has two components and that neither is `none` in either mode; assert the focus ring on a focused `.btn` (`outline-color`) is 3:1 or better against the paper.
3. `prefers-contrast: more` cannot be emulated by Playwright; assert in `family-sheets.test.ts` that the block exists and re-declares `--ink`.
Accept:
- [ ] `a11y.spec.ts` green for Poster, Glass (if E14 has landed) and Neu, both modes.
- [ ] The shadow and ring checks pass in both modes.
Test: itself.

#### E15-S2-T3 Docs and release
Files: `docs/ui.md`, `readme/screenshots/dfm-theme-neu.png` (new), `durablefunctionsmonitor-vscodeext/CHANGELOG.md`, `durablefunctionsmonitor.dotnetisolated.core/README.md`
Depends: E15-S2-T2
Do:
1. `docs/ui.md`: a row for Neu in the theme screenshot table (Instances, light, 1440 px); `neu` in the `dfmTheme` value list.
2. Core README: the `DFM_CLIENT_CONFIG` example mentions the value.
3. Extension CHANGELOG: "Neu theme" in the same "Unreleased" entry as Glass, or its own line if E14 has not landed.
Accept:
- [ ] `grep -n neu docs/ui.md` shows the value list and the screenshot row.
Test: docs.
