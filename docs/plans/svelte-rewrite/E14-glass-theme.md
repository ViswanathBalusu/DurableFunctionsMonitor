# E14 · Glass

Goal: a Glassmorphism theme, `glass`, in light and dark: frosted, translucent surfaces over a soft colour backdrop, a thin light rim instead of an ink outline, one blur per surface, strong marks. It is a theme like the five papers - picked from the same menu, stored in the same key, injected through the same `dfmTheme` - so the choice is `data-theme="glass"` and nothing more.

Prerequisites: E13. Read `notes/theme-families-investigation.md` and the candidate sheet `notes/theme-families-spike/families.css` (the Glass half is the starting point of E14-S1-T1; every value in it may change in review, the structure should not). Contracts §16.

Exit criteria: Glass appears in the theme menu, the Settings tiles and the palette; every screen of the theme QA matrix reads as glass in both modes; the a11y pass is green in both modes; the five papers are pixel-for-pixel what they were.

The look, in words (the reviewer's reference until the preview is shot):
- **Backdrop.** The page is a solid paper (`--background`) with three large radial colour blobs behind everything (`body::before`, fixed, `z-index: -1`): indigo top-left, pink top-right, cyan bottom. Light: pale paper `#EEF1F8`, blobs at 30–38 %. Dark: `#0B1020`, blobs at 32–45 %, the cyan turned teal.
- **Surfaces.** `--card`, `--sidebar`, `--popover`, `--input` are white (light) or white-on-dark (dark) at low alpha; each surface class gets `backdrop-filter: blur(16px) saturate(160%)` once. Rows, chips, buttons and inputs are translucent but never blurred themselves.
- **Line.** `--border-width: 1px`; `--ink` is a white rim (`rgba(255,255,255,.7)` light, `.16` dark); `--glyph` is the text colour, so ticks, carets and arrows stay strong.
- **Shadow.** Soft and downward: `0 8px 24px` of a blue-black at 12–14 % (light) or black at 45 % (dark), plus a 1 px inner highlight at the top. `-sm` and `-lg` scale it; hover lifts by 1 px and deepens it; press returns to `-sm`. No translate on hover.
- **Radius.** 14 px everywhere (`--radius`); chips and buttons become pills, which is the family's look.
- **Colour.** Primary indigo (`#4F46E5` / `#818CF8`), accent sky, destructive coral; status fills are the same eight hues at jewel saturation with dark text, kind-entity pink; five chart series indigo / pink / cyan / green / amber.
- **Overlay.** `rgba(8,10,20,.35)` with a 6 px blur (dark: 50 %).
- **Reduced transparency.** `@media (prefers-reduced-transparency: reduce)`: surfaces go opaque and every `backdrop-filter` is removed; the theme still reads as itself through the radius, the rim and the shadow.

### E14-S1 Tokens and sheet

#### E14-S1-T1 glass.css and the descriptor
Files: `src/styles/families/glass.css` (new), `src/app.css`, `src/lib/themes.ts`, `src/lib/host.svelte.ts`, `tests/unit/family-sheets.test.ts`
Depends: E13
Do:
1. `glass.css` from the Glass half of the spike sheet, restructured in this order with a comment line above each block: (1) the light token block `[data-theme="glass"]` - every token Poster declares, plus `--glyph`, `--glass-blur: 16px`, `--glass-overlay`, and the four `--shadow-brutal*` and `--stripe` re-declared for the family; (2) the dark block `.dark[data-theme="glass"]`, same set; (3) the backdrop (`html[data-theme="glass"] body`, `body::before`, dark variant); (4) the surface list with the one `backdrop-filter`; (5) `.tbl`/`.tfoot` transparent, `.overlay`; (6) motion (`:hover`/`:active` of `.btn` and `.stat-tile`); (7) the glyph re-points (`.box.on::after`, `.switch::after`, `.tri`, `.sel::after`, `.tbl th.sort::after` + `.desc`, `.jse-bar`, `.wbar i.orch`, `.bar.orch`, `.now`, `.life`, `.arrow` + `::after`, `.gcanvas polyline`/`rect`, the `.wbar i.wait`/`.brush` hatch); (8) the 2 px hard-coded borders thinned to 1 px (`.seg-b`, `.legend i`, `.swq`, `.mini`, `.tag`, `.prow .kbd`, `.fchip .x`, `.meter i`, `.ttile .sw i`, `.avatar`); (9) the reduced-transparency block.
2. `app.css`: `@import './styles/families/glass.css';` after `base.css`.
3. `themes.ts`: append `{ key: 'glass', family: 'glass', label: 'Glass', idea: 'frosted panes over colour', metrics: '14 px · 1 px · blur 16', paper: '#EEF1F8', ink: '#101828', primary: '#4F46E5', dark: '#0B1020' }` - `ink` is the glyph colour here (E13-S1-T3 asserts `--glyph` against it). `host.svelte.ts`: `'glass'` joins the `ThemeName` union.
4. Run `npm run preview:styles` and look at the six crops; adjust tokens until the description above holds. Keep the shots out of git.
Accept:
- [x] `family-sheets.test.ts` now checks one family and passes: scoping, the full token set in both blocks, `--glyph`, no Tailwind directives.
- [x] `npm run build && npm run verify` pass; `build-css.test.ts` counts 12 `--status-failed`.
- [x] `themes.spec.ts` for `Glass light` and `Glass dark` passes the family assertions and shoots the seven screens.
Test: the unit tests named; the two e2e cases.

#### E14-S1-T2 Preview review
Files: `docs/plans/svelte-rewrite/notes/E14-glass-review.md` (new), `src/styles/families/glass.css`
Depends: E14-S1-T1
Do:
1. Review the preview crops of both modes against the look above and the universal rules (contracts §16), section by section of the preview page: shell and Overview, statuses, controls, list, instance header, graph nodes, Gantt, histogram, Inputs tab, JSON, dialog/progress/toast/empty, type. Write a table: section, what was wrong, the token or rule changed.
2. Contrast: compute, for both modes, the pairs foreground/background, muted-foreground/card-over-paper (composite the alpha over `--background` by hand or in a 10-line node script), every status foreground on its fill, primary-foreground on primary, destructive-foreground on destructive, ring on background. Every text pair 4.5:1 or better, ring 3:1 or better. Put the numbers in the notes file.
3. Fix the sheet accordingly; re-shoot.
Accept:
- [x] The notes file lists every pair with its ratio and none is under the threshold.
- [x] Both modes of the preview page have no section the review still marks wrong.
Test: manual review, recorded; `themes.spec.ts` still green.

### E14-S2 In the app

#### E14-S2-T1 Screens pass
Files: `src/styles/families/glass.css`, touched components, `docs/plans/svelte-rewrite/notes/E14-glass-qa.md` (new)
Depends: E14-S1-T2
Do:
1. Run `npx playwright test tests/e2e/themes.spec.ts` and read the Glass shots of the matrix (Overview, Instances with the bulk bar, the Timeline tab, the Inputs tab with the replay dialog, Failures, Settings, Login), then by hand the things the matrix does not shoot: the peek panel, the command palette, the More sheet and bottom nav at 390 px, a `Pop` menu, a Select list, the JSON viewer and editor (`.jse-theme-dfm` - its `--jse-main-border` uses `--ink`, which is now a rim; decide whether the editor gets a card background of its own), the function graph (Svelte Flow canvas dots, edges in `--glyph`, node cards frosted), the swimlane, the sequence diagram, the histogram brush, toasts, the progress stripe.
2. For each defect decide: a token, a rule in `glass.css`, or a component whose inline style names a brutalist value. The nine inline candidates are listed in the investigation note (`HistogramView.svelte` L74 `background:var(--card)`, `InstancesTable.svelte` L254, `TimelineView.svelte` L103, `AppearancePanel.svelte` L95 `border-color:var(--ink)`, `HubAdminPanel.svelte` L97, `Login.svelte` L27, L54, L72, `EntityChips.svelte` L86). A component change must not alter the five papers: where it does, the value moves to a token (`--glyph` or a new family-neutral one declared in `base.css` with the brutalist default).
3. Record the pass in the notes file the way `notes/E12-theme-qa.md` does: what was looked at, what was wrong, what changed.
Accept:
- [x] No screen of the matrix and no overlay in the list above breaks the look (a hard offset shadow, an ink outline, a doubled blur, a mark that vanished).
- [x] `themes.spec.ts` for the five papers is unchanged and green; the brutalist computed-style test (E13-S1-T3) is green.
Test: e2e (the matrix); the notes file.

#### E14-S2-T2 Accessibility in Glass
Files: `tests/e2e/a11y.spec.ts`, `tests/e2e/themes.spec.ts`, touched components or `glass.css`
Depends: E14-S2-T1
Do:
1. `a11y.spec.ts`: add `glass` to `FAMILY_SAMPLES`; the screen loop and the overlays test run in Glass light and dark. Fix every serious/critical violation.
2. axe marks text on a translucent background as "incomplete" rather than failing it. Add to `themes.spec.ts`, for non-brutal families, a computed check on the Instances screen: sample the table's first cell text colour and the composited background (`--card` over `--background`; ignore the blobs, they are lighter than the paper in light mode and darker in dark mode by construction) and assert 4.5:1; the same for `.meta` text (`--muted-foreground`) inside a `.panel` on the Overview.
3. Keyboard: the focus ring (`--ring`) must be visible on a frosted button in both modes; if it is not, the family sets a `--ring` with more contrast, not a thicker outline.
Accept:
- [ ] `a11y.spec.ts` green for Poster and Glass, both modes.
- [ ] The two computed-contrast checks pass in both modes of Glass.
Test: itself.

#### E14-S2-T3 Docs and release
Files: `docs/ui.md`, `readme/screenshots/dfm-theme-glass.png` (new), `durablefunctionsmonitor-vscodeext/CHANGELOG.md`, `durablefunctionsmonitor.dotnetisolated.core/README.md`
Depends: E14-S2-T2
Do:
1. `docs/ui.md`: a row for Glass in the theme screenshot table (the Instances screen, dark, 1440 px, cropped like the others); `glass` in the `dfmTheme` value list.
2. Core README: `DFM_CLIENT_CONFIG` example mentions the value; nothing else.
3. Extension CHANGELOG: an "Unreleased" entry "Glass theme" in one sentence. The version bump itself is a release task, not this one.
Accept:
- [ ] `grep -n glass docs/ui.md` shows the value list and the screenshot row.
Test: docs.
