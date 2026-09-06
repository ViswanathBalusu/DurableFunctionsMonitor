# E12-S3-T3 · Theme QA matrix (2026-09-05)

`tests/e2e/themes.spec.ts` photographs seven screens in five themes and both modes at 1440 px, plus
Instances and the workspace at 1024 px and 390 px, and asserts the tokens behind them. 78 shots under
`test-results/themes/` (an artifact, not committed). This is the review those shots were read against.

## What the spec asserts, so the review does not have to look for it

| Check | Where it comes from |
|---|---|
| `--background` is the theme's paper for the mode | themes.ts (the swatches) vs. what the browser computed |
| `--primary` is the theme's accent | same |
| `--ink` is the theme's ink in light mode, a light colour in dark | design system §7: dark mode inverts the pair |
| ink on paper is over 7:1 | §7 - flat colour, and the line has to read |
| `radius · line · shadow` is what the Settings screen prints | themes.ts `metrics` vs. `--radius`, `--border-width`, `--shadow-brutal` |
| the shadow is a hard offset (`Npx Npx 0`), never a blur | §6 |
| the paper's pattern is `none`/`halftone`/`dots`/`grid` per theme | §7 |
| the bundle has no `rgba(`, no `blur(` outside Tailwind's unused `.blur` utility, and one translucent surface: `.overlay` | §6, §7 |

## What was reviewed by eye, and what it showed

- **Poster light and dark** - bone and ink violet, black line at 2 px, 0 radius, 4 px shadow. The
  reference the mockups are drawn in; every other theme was read against these two.
- **Riso** - newsprint paper with the halftone, riso black line, magenta accent. Sunflower shadows in
  dark mode, as §7 asks.
- **Memphis** - lilac white and plum, 3 px line, 10 px radius everywhere (no mixed radii), pastel
  stat tiles with dark text, dot paper.
- **Blueprint** - drafting grid on the page and nowhere inside a card, cobalt line, safety orange for
  the primary action; the bulk bar and the destructive buttons keep the red family rather than the
  accent, which is what §7 asks of the status hues.
- **Hazard** - graphite paper, caution yellow, and the stripes where the design puts them: the
  "Dangerous operations on" badge and the frame of a failure group. Destructive buttons are red, not
  yellow.
- **390 px** - the bottom nav, the More sheet, and the stacked table cards with the select box in the
  card's top-right corner. That corner is the frozen stylesheet's own rule (dfm-ui.css L442), not a
  deviation: the id line runs under it by design.
- **1024 px** - the side nav collapses to icons and the workspace keeps its hero; nothing overlaps.

## Deviations found

None in §7 or §13. The two colour defects this pass turned up were found by axe rather than by eye
and are fixed under E12-S3-T2: the picked theme tile's metrics kept `.meta`'s muted grey on a painted
tile, and a swimlane bar kept a status foreground on the card background - black on near-black in
dark mode. Both were compositions of frozen rules, not wrong tokens.

## What a reviewer should do with the shots

Open `test-results/themes/` after a run and compare a theme's ten shots against the row for it in
`dfm-design-system.md` §13. The spec fails on the tokens; the shots are for the things a token table
cannot say - whether a screen still reads as that theme.
