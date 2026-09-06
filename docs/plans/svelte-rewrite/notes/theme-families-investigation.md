# Theme families: investigation (2026-09-06)

Asked for: two more looks for the UI, Glassmorphism and Neumorphism. This note is what was found before
the plan (E13, E14, E15) was written, so the plan does not have to re-derive it.

## How theming works today

- One preference, `dfm.theme`, picks one of five papers (`poster`, `riso`, `memphis`, `blueprint`,
  `hazard`); `dfm.mode` picks the face (`light`, `dark`, `system`). `Prefs.apply()`
  (`src/lib/state/prefs.svelte.ts`) writes `data-theme` and the `dark` class on `<html>`; nothing else
  touches the document.
- The look is entirely tokens. `src/styles/dfm-tokens.css` (frozen, verbatim from
  `docs/ui-plans-artifacts/uploads/files/dfm-tokens.css`) declares ~85 custom properties per theme and
  mode, plus a `:root` block of derived ones (`--shadow-brutal*`, `--stripe`, the heights). Every
  colour, radius, line and shadow in `src/styles/dfm-ui.css` (frozen too) is a `var(--…)`.
- The app names a colour in exactly one place: `src/lib/themes.ts` (`THEMES`), the swatches the theme
  menu, the Settings tiles and the command palette are built from. `tests/e2e/themes.spec.ts` asserts
  that what the browser computes matches those swatches.
- The VS Code extension injects only `theme` (light/dark), `showTimeAs` and `hubName`; `dfmTheme`
  comes from the backend's `DFM_CLIENT_CONFIG` and is validated against the theme list, so a new theme
  name needs no host change.

## What a soft family needs that the frozen stylesheets do not offer

| Need | Where it bites | Answer |
|---|---|---|
| Translucent surfaces and `backdrop-filter` (glass), blurred dual shadows (neu) | `themes.spec.ts` "nothing in the bundle is soft or translucent" forbids `rgba(` and `blur(` in the whole bundle; the design system §3 rule 7 says never | Scope the rule to the brutalist family (decision D14); assert it on computed styles per theme, not on the bundle text (Lightning CSS rewrites `rgba()` to 8-digit hex anyway) |
| A soft line, but strong marks | `--ink` is both the line colour (68 `border: var(--border-width) solid var(--ink)` sites) *and* the colour of small solid marks: checkbox tick, switch knob, select caret, sort triangles, sequence arrowheads, the "now" line, the orchestration bar, `.jse-bar` | A new token `--glyph`, `var(--ink)` by default (so the five papers do not change), a strong colour in the soft families; ~14 selectors re-pointed per family, ~6 component strokes re-pointed once (E13-S1-T2) |
| Overriding a handful of `dfm-ui.css` rules (hover translate, `:active` collapse, `.tbl` background, `.overlay`) | `dfm-ext.css` may never override a `dfm-ui.css` rule; the hook freezes `dfm-ui.css` | Family sheets in `src/styles/families/*.css` are allowed to, scoped under their own `[data-theme]` and nothing else (decision D13) |
| A full token set per family and mode | `:root, [data-theme="poster"]` declares every token, so a family that forgets one silently inherits Poster's value | A unit test compares the token names of each family block with Poster's, both modes (E13-S1-T3) |
| A visual reference | `docs/ui-plans-artifacts/` is frozen, so no new mockup can go there | A generated preview: the frozen `dfm-theme-preview.html` plus the family sheets, built into `build/` and photographed by a harness script (E13-S2-T1) |

## The spike

`theme-families-spike/families.css` is a candidate sheet for both families, written against the
frozen preview page with **no edit to `dfm-tokens.css` or `dfm-ui.css`**. It was rendered by copying
`dfm-theme-preview.html` to a scratch folder, adding `<link rel="stylesheet" href="families.css">` and
two entries to its `THEMES` switcher, and screenshotting Glass and Neu in both modes at 1440 px.

What the shots showed:

- Both families are recognisable at first glance: frosted panes over a three-blob backdrop for Glass,
  one extruded material with light from the top left for Neu. Status tiles, chips, spines and the
  charts keep their meaning (universal rules, D14) while every line, shadow and radius changes.
- The `--glyph` split is necessary and sufficient: without it the select carets, the checkbox tick, the
  switch knob and the Gantt "now" line vanish into the soft line colour; with it they read.
- The stripe (`--stripe`) has to be re-declared per family (primary + glyph); the dangerous badge and
  the striped buttons then look right.
- Inputs in Neu need the inset shadow explicitly (`.input`, `.ed`, the palette input); the raised look
  of `.panel` (which `dfm-ui.css` leaves shadowless on purpose) has to be added for Neu, or panels look
  flat next to the extruded tiles.
- Glass must not blur rows, chips or buttons: one `backdrop-filter` per *surface* (`.snav`, `.topbar`,
  `.panel`, `.card`, `.tbl-wrap`, `.pop`, `.dialog`, `.peek`, `.palette`, `.bulk`, `.sheet`,
  `.bottom-nav`, `.empty`, `.group`, `.hero`, `.banner`, `.note`, `.swim`, `.seq`, `.graph`, `.ed`) is
  enough, and `.tbl`/`.tfoot` have to go transparent or the table is frosted twice.
- Size: ~85 tokens × 2 modes + ~40 override rules per family, ~170 lines each. No component markup had
  to change for the preview page; the app itself has nine inline `style` attributes that name
  `--ink`, `--shadow-brutal` or a border (grep in the investigation), which the QA tasks look at.

Things the spike could not tell, left to the tasks:

- Real screens: the preview page has no peek panel, palette, bottom nav, More sheet, JSON editor or
  Svelte Flow canvas. E14-S2-T1 / E15-S2-T1 walk the theme QA matrix on the app.
- Contrast on translucent surfaces: axe reports text on a translucent background as "incomplete", not
  as a failure. E14-S2-T2 adds explicit computed-contrast checks for the text colours on `--card`
  composited over the backdrop.
- The VS Code webview: `backdrop-filter` and a fixed `body::before` layer are plain Chromium features,
  but the webview smoke (E0-S5-T2) is still the manual pass it always was.

## Tests that name the five themes today (all touched by E13-S1-T3)

`src/lib/shell/menus.test.ts` (key list), `src/lib/state/palette.test.ts` (labels),
`tests/unit/build-css.test.ts` (count of `--status-failed`), `tests/e2e/settings.spec.ts` (five
radios), `tests/e2e/themes.spec.ts` (token assertions, the "nothing soft" test),
`tests/e2e/a11y.spec.ts` (Poster only). `tests/unit/tokens-verbatim.test.ts` is unaffected: the family
sheets are not in the tokens file.
