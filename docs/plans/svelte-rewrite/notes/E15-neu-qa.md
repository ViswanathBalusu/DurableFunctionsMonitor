# E15-S2-T1 · Neu screens pass (2026-09-06)

`tests/e2e/themes.spec.ts` photographs the seven screens of the matrix in Neu light and dark
(Overview, Instances with the bulk bar, the Timeline tab, the Inputs tab with the replay dialog,
Failures, Settings, Login; `test-results/themes/neu-*.png`). What the matrix does not shoot was
photographed by hand against the running host, in both modes, with the same script and list as the
Glass pass (`notes/E14-glass-qa.md`): the peek panel, the command palette, the theme menu (`.pop`), a
Select list, the histogram with a brush, the Instances timeline view, the function graph (the
instance's Graph tab and the Functions screen), the sequence diagram, the JSON viewer (Raw tab and
the input dialog), the JSON editor (Inputs tab), the swimlane legend, an ok toast, the Entities,
Storage and Activity screens, and at 390 px the Instances cards with the bottom nav, the More sheet,
the workspace and the peek sheet.

## What was wrong, and what changed

| Where | What was wrong | What changed |
|---|---|---|
| JSON viewer (Raw tab, the input dialog) | Flat: the viewer host paints the card's material with the 35 % line and no inset, so it sat level with the panel where the editor beside it is sunk in `.ed`. | `.jse-theme-dfm` paints no background of its own (`--jse-background-color: transparent`), so the inset pair shows through its content; a host that nothing wraps (`:not(.ed) > .jse-theme-dfm`) wears the inset pair and the radius itself. An editor keeps the single inset of the `.ed` around it. |
| Bottom nav (390 px) | A flat strip: dfm-ui.css gives it a top line and nothing else, which on one material is invisible next to the raised cards above it. | `.bottom-nav { box-shadow: 0 -6px 16px var(--neu-dark) }`, cast upward from the bottom edge. |
| More sheet (390 px) | The same flat strip, over the veil. | `.sheet` takes the same upward cast. |

Nothing else needed a change; the three above are all rules in `neu.css`, no component moved.

## The two Neu-specific checks the plan asks for

- **A raised surface inside a raised surface.** The Top orchestrators table (`.tbl-wrap`) inside the
  Overview panel, the buttons inside a failure group, the buttons in the peek panel, the cards in the
  Inputs tab: every inner shadow still reads against the outer one in both modes. The pair is
  narrow enough (14 px) that an outer shadow never reaches the inner element's edge, so nothing had
  to go to `-sm`.
- **The selected row and the hover row.** Selected rows take `--accent` (periwinkle by day, indigo
  by night) and read at once; the hover row takes `--muted`, one step darker than the material
  (`#D6DCE7` on `#E3E8F0`, `#363B46` on `#2A2E37`), which is the same step the table header's rule
  and the row separators use, and reads on the real list in both modes.

## The inline candidates from the investigation note

The same seven as the Glass pass, with the same decisions: every one names a token that this family
already gives a soft value to (`--card` and `--input` are the material, `--shadow-brutal` is the
raised pair, `var(--border-width) solid var(--ink)` is the 35 % line, `var(--radius)` is 16 px), or
a muted separator that is not the line. None moved.

## Not defects

- The runtimeStatus chips in the Instances table are outlined, not filled, in every theme (dfm-ui.css
  L78 paints the card over `.st-*`); here the outline is the 35 % line and the chips read as faint
  pills on the material, with the spine carrying the status.
- The selected tab and a pressed segment wear the inset pair over the primary fill, which is what the
  plan asks for: they read as pressed into the strip.
- The "waiting for event" legend swatch is a dotted 35 % line on the material, faint by the same
  rule that makes it faint in Glass; the swimlane bar it explains is dotted the same way.
- The modal veil is a 30 % tint with no blur, in both modes: on the night material it dims less than
  by day, and the dialog's large pair carries the separation.

## What the shots showed once the fixes were in

- Light and dark: one material with every surface extruded from it (panels, the table frame, cards,
  buttons, the peek, the palette, dialogs, the toast, the graph frame, the swimlane, the sequence
  diagram), inputs and editors sunk, selects sunk, the side nav casting right and the top bar
  downward, marks strong (ticks, carets, sort triangles, the "now" line, lifelines and arrowheads,
  the brush frame and hatch).
- The five papers: `themes.spec.ts` (their ten cases and "the papers are flat and hard") green,
  unchanged by anything above - every rule here is scoped to `[data-theme="neu"]`, and no component
  changed.
