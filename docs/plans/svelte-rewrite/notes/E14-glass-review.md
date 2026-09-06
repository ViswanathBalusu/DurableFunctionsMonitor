# E14-S1-T2 · Glass preview review (2026-09-06)

`npm run preview:styles` builds the frozen design-system preview page with `families/base.css` and
`families/glass.css` linked and photographs every theme in both modes; the six Glass crops under
`test-results/style-preview/glass-{light,dark}-{1,2,3}.png` (an artifact, not committed) were read
section by section against the look described at the top of `E14-glass-theme.md` and the universal
rules of contracts §16. Two rounds: the first shoot, on the spike sheet as restructured by E14-S1-T1,
and a second after the fixes below.

## What each section showed

| Section | What was wrong | Token or rule changed |
|---|---|---|
| Shell and Overview | Nothing. Frosted sidebar and top bar over the three blobs, indigo active item, jewel stat tiles with dark text, panels at 55 % white (8 % in dark). | - |
| Palette | The six poster fills carried white text at 2.2–4.2:1 in light mode; the entity kind was white on pink at 3.5:1. | `--on-poster: #101828`; `--poster-1..6` are the family's 400 tints (`#818CF8 #F472B6 #22D3EE #4ADE80 #FBBF24 #A78BFA`); `--kind-entity: #F472B6` / `--kind-entity-foreground: #500724`. The chart hues stay the 500s: no text sits on them. |
| Palette | The preview's own "Ink" tile prints `--paper` on `--ink`, which in Glass is paper on a 70 % white rim. | Nothing: the tile is the page's illustration of the token, not an app surface. |
| Runtime status and kind | Nothing. Eight jewel fills with dark text, the two greys turn dark-with-light-text at night. | - |
| Controls | The tick on the primary checkbox was the glyph on indigo (2.8:1) and all but vanished; the switch knob, the glyph on the sky accent, sat light-on-light at night. | `.box.on::after { background: var(--primary-foreground) }`, `.switch.on::after { background: var(--accent-foreground) }`: a mark on a coloured fill takes that fill's own text colour. |
| Controls | Destructive buttons were white on `#E5484D` at 3.9:1. | `--destructive: #D0343A` (light); dark keeps `#F87171` with dark text. |
| Controls | Nothing else: pill buttons with the soft shadow, ghost and disabled ones still, selects with a strong caret, tabs on the rim baseline. | - |
| Orchestrations list | Nothing. Frame frosted once, table transparent, spine and status pills as in the papers. | - |
| Instance header | Nothing. | - |
| Functions graph nodes | Nothing. Frosted node cards, coloured bands, edges in the glyph. | - |
| Gantt chart | Bars kept dfm-ui.css's hard-coded 2 px rim, twice the family's line. | `.bar { border-width: 1px }`; the same for the segments of the "where the time went" bar, `.wbar i { border-right-width: 1px }`. |
| Time histogram | Nothing. Segment outlines are the rim, the legend squares 1 px, the brush hatch in the glyph. | - |
| Inputs tab | The editor inside a frosted card carried a second `backdrop-filter`, which shows nothing (the card has already blurred what is behind it) and costs a compositing layer per card. | A surface nested inside a frosted surface loses its blur: `[data-theme="glass"] :is(<frosted>) :is(.panel, .card, .tbl-wrap, .empty, .group, .hero, .banner, .note, .swim, .seq, .graph, .ed) { backdrop-filter: none }`. The floating surfaces (`.pop`, `.dialog`, `.peek`, `.palette`, `.bulk`, `.sheet`, `.bottom-nav`) are never nested and keep theirs. |
| JSON viewer | Nothing. The menu bar is the glyph with paper text; the pressed mode button reads in the glyph. | - |
| Dialog, progress, toast, empty | Nothing. Stripe bands in primary and glyph, the toast in the deeper coral. | - |
| Type | Nothing. | - |

Also from the first round, outside any one section: the spike gave the dark mode its own primary,
`#818CF8`. The theme matrix (`themes.spec.ts`) holds every theme to one accent across modes, as the
papers are, and indigo `#4F46E5` with white text reads on the night paper at 6.3:1, so the dark block
keeps the light mode's primary and the lighter tint stays with the first chart series.

## Contrast

Computed from the sheet's own values, translucent fills composited over `--background` (the blobs
are lighter than the paper in light mode and darker in dark mode by construction, so the paper is
the worse case). Text pairs need 4.5:1, the focus ring 3:1. The script is ten lines of WCAG 2
relative luminance; the pairs are the ones the task names plus the ones axe checks on the screens.

### Light

| Text | On | Composited | Ratio | Needs |
|---|---|---|---|---|
| `--foreground` | `--background` | #101828 on #eef1f8 | 15.70 | 4.5 |
| `--muted-foreground` | `--card` over paper | #475467 on #f7f9fc | 7.29 | 4.5 |
| `--muted-foreground` | `--background` | #475467 on #eef1f8 | 6.80 | 4.5 |
| `--foreground` | `--card` over paper | #101828 on #f7f9fc | 16.83 | 4.5 |
| `--foreground` | `--input` over paper | #101828 on #f7f8fc | 16.72 | 4.5 |
| `--foreground` | `--muted` over paper | #101828 on #e1e4ec | 13.95 | 4.5 |
| `--primary-foreground` | `--primary` | #ffffff on #4f46e5 | 6.29 | 4.5 |
| `--secondary-foreground` | `--secondary` over paper | #101828 on #fafbfd | 17.14 | 4.5 |
| `--accent-foreground` | `--accent` | #0b2a45 on #bfe3ff | 10.93 | 4.5 |
| `--destructive-foreground` | `--destructive` | #ffffff on #d0343a | 4.96 | 4.5 |
| `--status-completed-foreground` | `--status-completed` | #052e16 on #34d399 | 7.75 | 4.5 |
| `--status-running-foreground` | `--status-running` | #1f1300 on #fbbf24 | 10.93 | 4.5 |
| `--status-failed-foreground` | `--status-failed` | #2a0505 on #f87171 | 6.76 | 4.5 |
| `--status-pending-foreground` | `--status-pending` | #083344 on #67e8f9 | 9.24 | 4.5 |
| `--status-terminated-foreground` | `--status-terminated` | #0f172a on #cbd5e1 | 12.02 | 4.5 |
| `--status-canceled-foreground` | `--status-canceled` | #0f172a on #e2e8f0 | 14.48 | 4.5 |
| `--status-continued-foreground` | `--status-continued` | #2e1065 on #c4b5fd | 8.25 | 4.5 |
| `--status-suspended-foreground` | `--status-suspended` | #431407 on #fdba74 | 9.28 | 4.5 |
| `--kind-orchestration-foreground` | `--kind-orchestration` over paper | #101828 on #f8f9fc | 16.86 | 4.5 |
| `--kind-entity-foreground` | `--kind-entity` | #500724 on #f472b6 | 5.68 | 4.5 |
| `--on-poster` | `--poster-1` | #101828 on #818cf8 | 5.95 | 4.5 |
| `--on-poster` | `--poster-2` | #101828 on #f472b6 | 6.70 | 4.5 |
| `--on-poster` | `--poster-3` | #101828 on #22d3ee | 9.82 | 4.5 |
| `--on-poster` | `--poster-4` | #101828 on #4ade80 | 10.18 | 4.5 |
| `--on-poster` | `--poster-5` | #101828 on #fbbf24 | 10.63 | 4.5 |
| `--on-poster` | `--poster-6` | #101828 on #a78bfa | 6.52 | 4.5 |
| `--json-string` | `--card` over paper | #be185d on #f7f9fc | 5.72 | 4.5 |
| `--json-number` | `--card` over paper | #0e7490 on #f7f9fc | 5.08 | 4.5 |
| `--json-boolean` | `--card` over paper | #6d28d9 on #f7f9fc | 6.74 | 4.5 |
| `--json-null` | `--card` over paper | #475467 on #f7f9fc | 7.29 | 4.5 |
| `--json-string` | `--input` over paper | #be185d on #f7f8fc | 5.69 | 4.5 |
| `--json-number` | `--input` over paper | #0e7490 on #f7f8fc | 5.05 | 4.5 |
| `--json-boolean` | `--input` over paper | #6d28d9 on #f7f8fc | 6.69 | 4.5 |
| `--paper` | `--glyph` (the editor bar) | #eef1f8 on #101828 | 15.70 | 4.5 |
| `--ring` | `--background` | #7c3aed on #eef1f8 | 5.04 | 3 |
| `--ring` | `--card` over paper | #7c3aed on #f7f9fc | 5.40 | 3 |

### Dark

| Text | On | Composited | Ratio | Needs |
|---|---|---|---|---|
| `--foreground` | `--background` | #eef2ff on #0b1020 | 16.93 | 4.5 |
| `--muted-foreground` | `--card` over paper | #a5b4cf on #1f2332 | 7.46 | 4.5 |
| `--muted-foreground` | `--background` | #a5b4cf on #0b1020 | 9.04 | 4.5 |
| `--foreground` | `--card` over paper | #eef2ff on #1f2332 | 13.97 | 4.5 |
| `--foreground` | `--input` over paper | #eef2ff on #1a1e2d | 14.82 | 4.5 |
| `--foreground` | `--muted` over paper | #eef2ff on #1c2130 | 14.34 | 4.5 |
| `--primary-foreground` | `--primary` | #ffffff on #4f46e5 | 6.29 | 4.5 |
| `--secondary-foreground` | `--secondary` over paper | #eef2ff on #282d3b | 12.28 | 4.5 |
| `--accent-foreground` | `--accent` | #0b1020 on #38bdf8 | 8.84 | 4.5 |
| `--destructive-foreground` | `--destructive` | #2a0505 on #f87171 | 6.76 | 4.5 |
| `--status-completed-foreground` | `--status-completed` | #052e16 on #34d399 | 7.75 | 4.5 |
| `--status-running-foreground` | `--status-running` | #1f1300 on #fbbf24 | 10.93 | 4.5 |
| `--status-failed-foreground` | `--status-failed` | #2a0505 on #f87171 | 6.76 | 4.5 |
| `--status-pending-foreground` | `--status-pending` | #083344 on #67e8f9 | 9.24 | 4.5 |
| `--status-terminated-foreground` | `--status-terminated` | #f8fafc on #64748b | 4.55 | 4.5 |
| `--status-canceled-foreground` | `--status-canceled` | #f8fafc on #475569 | 7.24 | 4.5 |
| `--status-continued-foreground` | `--status-continued` | #2e1065 on #c4b5fd | 8.25 | 4.5 |
| `--status-suspended-foreground` | `--status-suspended` | #431407 on #fdba74 | 9.28 | 4.5 |
| `--kind-orchestration-foreground` | `--kind-orchestration` over paper | #eef2ff on #232836 | 13.15 | 4.5 |
| `--kind-entity-foreground` | `--kind-entity` | #0b1020 on #f472b6 | 7.15 | 4.5 |
| `--on-poster` | `--poster-1` | #0b1020 on #818cf8 | 6.35 | 4.5 |
| `--on-poster` | `--poster-2` | #0b1020 on #f472b6 | 7.15 | 4.5 |
| `--on-poster` | `--poster-3` | #0b1020 on #22d3ee | 10.48 | 4.5 |
| `--on-poster` | `--poster-4` | #0b1020 on #4ade80 | 10.86 | 4.5 |
| `--on-poster` | `--poster-5` | #0b1020 on #fbbf24 | 11.34 | 4.5 |
| `--on-poster` | `--poster-6` | #0b1020 on #a78bfa | 6.96 | 4.5 |
| `--json-string` | `--card` over paper | #f9a8d4 on #1f2332 | 8.61 | 4.5 |
| `--json-number` | `--card` over paper | #67e8f9 on #1f2332 | 10.77 | 4.5 |
| `--json-boolean` | `--card` over paper | #c4b5fd on #1f2332 | 8.46 | 4.5 |
| `--json-null` | `--card` over paper | #a5b4cf on #1f2332 | 7.46 | 4.5 |
| `--json-string` | `--input` over paper | #f9a8d4 on #1a1e2d | 9.14 | 4.5 |
| `--json-number` | `--input` over paper | #67e8f9 on #1a1e2d | 11.43 | 4.5 |
| `--json-boolean` | `--input` over paper | #c4b5fd on #1a1e2d | 8.97 | 4.5 |
| `--paper` | `--glyph` (the editor bar) | #0b1020 on #eef2ff | 16.93 | 4.5 |
| `--ring` | `--background` | #a78bfa on #0b1020 | 6.96 | 3 |
| `--ring` | `--card` over paper | #a78bfa on #1f2332 | 5.74 | 3 |

The terminated status at night is the one pair near the line (4.55); its fill is slate 500, the
lightest grey that still reads as "off" next to the jewel fills.

### Not text pairs

`--node-foreground` is declared for every theme but nothing in `dfm-ui.css` or the components paints
text with it: a node fill is the 10 px band on a function-graph card and a legend square. It is
listed so that the numbers exist, not because they gate anything; Poster's own dark block fails the
same two (`#000000` on `#A39EB4` at 4.4, on `#262342` at 1.3).

| Mode | Text | On | Composited | Ratio |
|---|---|---|---|---|
| light | `--node-foreground` | every `--node-*` | #101828 on the tints | 8.90–16.86 |
| dark | `--node-foreground` | `--node-orchestrator` … `--node-timer` | #0b1020 on the tints | 6.35–11.34 |
| dark | `--node-foreground` | `--node-queue` | #0b1020 on #64748b | 3.98 |
| dark | `--node-foreground` | `--node-other` over paper | #0b1020 on #232836 | 1.29 |

## Left to E14-S2-T1

The preview page has no `.graph` container, peek panel, palette, bottom nav, More sheet, JSON editor
or Svelte Flow canvas. Two things are already known from reading the stylesheet rather than the
crops: `.graph` paints `--background`, an opaque paper, so its blur does nothing until the family
gives it the card's translucency; and `.peek` builds its shadow from `--shadow-offset-lg`, which is
0 here, so the panel has none. Both are surfaces of the app, not of the preview, and belong to the
screens pass.
