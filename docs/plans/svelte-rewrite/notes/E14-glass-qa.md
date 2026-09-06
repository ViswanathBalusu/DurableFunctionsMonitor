# E14-S2-T1 · Glass screens pass (2026-09-06)

`tests/e2e/themes.spec.ts` photographs the seven screens of the matrix in Glass light and dark
(Overview, Instances with the bulk bar, the Timeline tab, the Inputs tab with the replay dialog,
Failures, Settings, Login; `test-results/themes/glass-*.png`). What the matrix does not shoot was
photographed by hand against the running host, in both modes: the peek panel, the command palette,
the theme menu (`.pop`), a Select list, the histogram with a brush, the Instances timeline view, the
function graph (the instance's Graph tab and the Functions screen), the sequence diagram, the JSON
viewer (Raw tab and the input dialog), the JSON editor (Inputs tab), the swimlane legend, an ok toast,
the Entities, Storage and Activity screens, and at 390 px the Instances cards with the bottom nav, the
More sheet, the workspace and the peek sheet. `notes/E12-theme-qa.md` is the format.

## What was wrong, and what changed

| Where | What was wrong | What changed |
|---|---|---|
| Every frosted surface, in the app only | No pane was blurred: the sheet declared `backdrop-filter` and `-webkit-backdrop-filter` side by side, and the bundler kept only the prefixed one, which Chromium ignores. The preview harness loads the sheet raw, so the preview review could not see it; `getComputedStyle(...).backdropFilter` read `none` on the top bar, the side nav, the table frame and the peek. | `glass.css` declares the unprefixed property only; the bundler adds the prefix itself and keeps both. Recorded in the sheet's comment so that it is not "fixed" back. |
| Peek panel | The clear overlay under it took the veil's tint and blur: opening a peek dimmed and blurred the list it is meant to leave readable. | `.overlay:not(.clear)` carries the veil. |
| Dialogs, command palette | The page showed through the pane: an element with `backdrop-filter` is a backdrop root, so a dialog inside the blurred veil can only blur the veil, never the page. | `.dialog` and `.palette` take `--popover`, the family's denser fill (82 % white, 88 % night), and read on whatever is behind the veil. |
| Peek panel | No shadow: dfm-ui.css builds it from `--shadow-offset-lg`, which is 0 here. | `.peek { box-shadow: -8px 0 32px var(--shadow-ink) }`, cast to the left where the page is. |
| Function graph | An opaque paper pane: `.graph` paints `--background`. | `.graph { background: var(--card) }`; the dotted canvas shows through the frost. |
| JSON viewer and editor | The menu bar (text / tree / table, expand, copy, search) was the ink, a rim, with paper-coloured buttons on it: invisible. | `.jse-theme-dfm { --jse-theme-color: var(--glyph) }`, the bar the mockup's `.jse-bar` has. |
| Swimlane legend | The "orchestrator replay" swatch was white: `TimelineTab.svelte` paints it inline with `var(--ink)`. | The swatch is a mark, so `var(--glyph)` (`TimelineTab.svelte`); the papers do not change, the glyph is the ink there. |

## The inline candidates from the investigation note

| File | Inline value | Decision |
|---|---|---|
| `HistogramView.svelte` L74, `RawTab.svelte` L30 | `background:var(--card)` | A token; the card is translucent here and the frame around it carries the blur. Left. |
| `HistogramView.svelte` L74, `InstancesTable.svelte` L254, `TimelineView.svelte` L103 | `border-top:0; border-radius:0 0 var(--radius) var(--radius)` | Tokens; the tab strip joins the frame at the family's 14 px. Left. |
| `AppearancePanel.svelte` L95 | `border-color:var(--ink)` on every theme tile | The line, which is a rim here: the tiles read as rimmed pills and the picked one is filled. Left. |
| `HubAdminPanel.svelte` L97 | `border:2px solid var(--muted)` | A muted separator, not the line; 2 px of a 6 % tint is a faint box, which is what the papers have too. Left. |
| `Login.svelte` L27 | `box-shadow:var(--shadow-brutal)` | The token, which is the soft shadow here. Left. |
| `Login.svelte` L54, L72 | `border-…:var(--border-width) solid var(--ink)` | The line, a rim. Left. |
| `EntityChips.svelte` L86 | `border:0` | Nothing brutalist about it. Left. |

## Not defects

- The runtimeStatus chips in the Instances table are outlined, not filled: `.chip` (dfm-ui.css L78)
  paints the card over `.st-*` (L59) in every theme, Poster included; the spine carries the status.
- The histogram brush is framed and hatched in the glyph: it is a mark, drawn the way E13 draws it
  in the papers, and it has to read over the columns.
- A dialog over the veil shows a 6 px blur of the page around it, not through it: that is the
  overlay's own filter, which the plan asks for.

## What the shots showed once the fixes were in

- Light and dark: every surface frosted once, rims at 1 px, pills, the three blobs behind the shell,
  soft downward shadows, strong marks (ticks, carets, sort triangles, the "now" line, lifelines and
  arrowheads, the brush).
- The peek frosts the list behind it and keeps its own text sharp; the palette and the JSON dialog
  sit dense over the blurred veil; the More sheet and the bottom nav frost the cards behind them.
- The five papers: `themes.spec.ts` (their ten cases and "the papers are flat and hard") green,
  unchanged by anything above - every rule here is scoped to `[data-theme="glass"]`, and the one
  component change paints with a token that is the ink in the papers.
