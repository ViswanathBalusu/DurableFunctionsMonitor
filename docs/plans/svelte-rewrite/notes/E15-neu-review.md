# E15-S1-T2 · Neu preview review (2026-09-06)

`npm run preview:styles` builds the frozen design-system preview page with the family sheets linked
and photographs every theme in both modes; the six Neu crops under
`test-results/style-preview/neu-{light,dark}-{1,2,3}.png` (an artifact, not committed) were read
section by section against the look described at the top of `E15-neu-theme.md` and the universal
rules of contracts §16, the way `E14-glass-review.md` reads the Glass crops.

## What each section showed

| Section | What was wrong | Token or rule changed |
|---|---|---|
| Shell and Overview | Nothing. One material; the side nav casts to the right, the top bar downward, the panels and the table frame are raised, the stat tiles are pastel with dark text. | - |
| Palette | The spike's six poster fills were the chart hues (indigo 600, pink 600, cyan 600, green 600, amber 600, violet 600) under white text, at 3.0–5.3:1 with three of them under 4.5. | Written into the sheet before the first shoot: `--on-poster: #1F2937`, `--poster-1..6` the pastels `#A5B4FC #F9A8D4 #67E8F9 #86EFAC #FCD34D #C4B5FD` (README D14: dark text on every fill that carries text). The chart series keep the 600s; no text sits on them. |
| Palette | The spike's destructive `#E5484D` under white text sat at 3.9:1. | `--destructive: #D0343A` (light), 4.96:1; dark keeps `#F87171` with dark text. |
| Palette | The preview's own "Ink" tile prints `--paper` on `--ink`, which here is a 35 % shade: paper on paper. | Nothing: the tile is the page's illustration of the token, not an app surface. |
| Runtime status and kind | Nothing. Eight pastels with dark text by day, the jewel set by night, the two greys light-on-dark at night. | - |
| Controls | Nothing. Raised pill buttons, sunk selects and inputs, a white tick on the primary checkbox, a dark knob on the periwinkle switch (and a light one on the indigo accent at night), the selected tab and a pressed segment sunk. | - |
| Orchestrations list | Nothing. The header row is the material with the muted step for its rule, which reads in both modes; the row separators are the muted step too. | - |
| Instance header | Nothing. | - |
| Functions graph nodes | Nothing. Raised node cards, pastel bands, edges in the glyph. | - |
| Gantt chart | Nothing. Bars at the family's 1 px, the "now" line in the glyph. | - |
| Time histogram | Nothing. | - |
| Inputs tab | Nothing. Raised cards with sunk editors inside them; the disabled dangerous buttons keep the stripe. | - |
| JSON viewer | The spike's `--json-number` `#0E7490` on the material sat at 4.3:1 - the material is darker than Glass's white pane. | `--json-number: #0B6479` (light), 5.48:1. |
| JSON viewer | Nothing else: the menu bar is the glyph with paper text. | - |
| Dialog, progress, toast, empty | Nothing. The dialog is raised at the large pair, the toast in the coral, the empty state raised. | - |
| Type | Nothing. | - |

Also outside any one section: the spike gave the dark mode its own primary, `#818CF8`. The theme
matrix holds every theme to one accent across modes, and indigo `#5B5BD6` with white text reads on
the night material at 5.4:1, so the dark block keeps the light mode's primary and the lighter tint
stays with the first chart series, as Glass does.

## Contrast

Computed from the sheet's own values; every surface of this family is opaque and the same material,
so nothing needed compositing except the two shadow colours below. Text pairs need 4.5:1, the focus
ring 3:1. The same script and pair list as the Glass review.

### Light

| Text | On | Composited | Ratio | Needs |
|---|---|---|---|---|
| `--foreground` | `--background` | #1f2937 on #e3e8f0 | 11.93 | 4.5 |
| `--muted-foreground` | `--card` | #4b5563 on #e3e8f0 | 6.14 | 4.5 |
| `--muted-foreground` | `--background` | #4b5563 on #e3e8f0 | 6.14 | 4.5 |
| `--foreground` | `--card` | #1f2937 on #e3e8f0 | 11.93 | 4.5 |
| `--foreground` | `--input` | #1f2937 on #e3e8f0 | 11.93 | 4.5 |
| `--foreground` | `--muted` | #1f2937 on #d6dce7 | 10.66 | 4.5 |
| `--primary-foreground` | `--primary` | #ffffff on #5b5bd6 | 5.37 | 4.5 |
| `--secondary-foreground` | `--secondary` | #1f2937 on #e3e8f0 | 11.93 | 4.5 |
| `--accent-foreground` | `--accent` | #1e1b4b on #c7d2fe | 10.72 | 4.5 |
| `--destructive-foreground` | `--destructive` | #ffffff on #d0343a | 4.96 | 4.5 |
| `--status-completed-foreground` | `--status-completed` | #052e16 on #86efac | 10.62 | 4.5 |
| `--status-running-foreground` | `--status-running` | #1f1300 on #fde68a | 14.64 | 4.5 |
| `--status-failed-foreground` | `--status-failed` | #450a0a on #fca5a5 | 8.51 | 4.5 |
| `--status-pending-foreground` | `--status-pending` | #083344 on #a5f3fc | 10.74 | 4.5 |
| `--status-terminated-foreground` | `--status-terminated` | #0f172a on #cbd5e1 | 12.02 | 4.5 |
| `--status-canceled-foreground` | `--status-canceled` | #0f172a on #d9dfe8 | 13.32 | 4.5 |
| `--status-continued-foreground` | `--status-continued` | #2e1065 on #ddd6fe | 10.97 | 4.5 |
| `--status-suspended-foreground` | `--status-suspended` | #431407 on #fed7aa | 11.56 | 4.5 |
| `--kind-orchestration-foreground` | `--kind-orchestration` | #1f2937 on #e3e8f0 | 11.93 | 4.5 |
| `--kind-entity-foreground` | `--kind-entity` | #500724 on #f9a8d4 | 8.29 | 4.5 |
| `--on-poster` | `--poster-1` | #1f2937 on #a5b4fc | 7.36 | 4.5 |
| `--on-poster` | `--poster-2` | #1f2937 on #f9a8d4 | 8.09 | 4.5 |
| `--on-poster` | `--poster-3` | #1f2937 on #67e8f9 | 10.13 | 4.5 |
| `--on-poster` | `--poster-4` | #1f2937 on #86efac | 10.45 | 4.5 |
| `--on-poster` | `--poster-5` | #1f2937 on #fcd34d | 10.18 | 4.5 |
| `--on-poster` | `--poster-6` | #1f2937 on #c4b5fd | 7.95 | 4.5 |
| `--json-string` | `--card` | #be185d on #e3e8f0 | 4.91 | 4.5 |
| `--json-number` | `--card` | #0b6479 on #e3e8f0 | 5.48 | 4.5 |
| `--json-boolean` | `--card` | #6d28d9 on #e3e8f0 | 5.77 | 4.5 |
| `--json-null` | `--card` | #4b5563 on #e3e8f0 | 6.14 | 4.5 |
| `--json-string` | `--input` | #be185d on #e3e8f0 | 4.91 | 4.5 |
| `--json-number` | `--input` | #0b6479 on #e3e8f0 | 5.48 | 4.5 |
| `--json-boolean` | `--input` | #6d28d9 on #e3e8f0 | 5.77 | 4.5 |
| `--paper` | `--glyph` (the editor bar) | #e3e8f0 on #1f2937 | 11.93 | 4.5 |
| `--ring` | `--background` | #7c3aed on #e3e8f0 | 4.63 | 3 |
| `--ring` | `--card` | #7c3aed on #e3e8f0 | 4.63 | 3 |

### Dark

| Text | On | Composited | Ratio | Needs |
|---|---|---|---|---|
| `--foreground` | `--background` | #e5e7eb on #2a2e37 | 10.98 | 4.5 |
| `--muted-foreground` | `--card` | #a3a9b5 on #2a2e37 | 5.76 | 4.5 |
| `--muted-foreground` | `--background` | #a3a9b5 on #2a2e37 | 5.76 | 4.5 |
| `--foreground` | `--card` | #e5e7eb on #2a2e37 | 10.98 | 4.5 |
| `--foreground` | `--input` | #e5e7eb on #2a2e37 | 10.98 | 4.5 |
| `--foreground` | `--muted` | #e5e7eb on #363b46 | 9.07 | 4.5 |
| `--primary-foreground` | `--primary` | #ffffff on #5b5bd6 | 5.37 | 4.5 |
| `--secondary-foreground` | `--secondary` | #e5e7eb on #2a2e37 | 10.98 | 4.5 |
| `--accent-foreground` | `--accent` | #eef2ff on #4338ca | 7.07 | 4.5 |
| `--destructive-foreground` | `--destructive` | #2a0505 on #f87171 | 6.76 | 4.5 |
| `--status-completed-foreground` | `--status-completed` | #052e16 on #34d399 | 7.75 | 4.5 |
| `--status-running-foreground` | `--status-running` | #1f1300 on #fbbf24 | 10.93 | 4.5 |
| `--status-failed-foreground` | `--status-failed` | #2a0505 on #f87171 | 6.76 | 4.5 |
| `--status-pending-foreground` | `--status-pending` | #083344 on #67e8f9 | 9.24 | 4.5 |
| `--status-terminated-foreground` | `--status-terminated` | #f8fafc on #64748b | 4.55 | 4.5 |
| `--status-canceled-foreground` | `--status-canceled` | #f8fafc on #475569 | 7.24 | 4.5 |
| `--status-continued-foreground` | `--status-continued` | #2e1065 on #c4b5fd | 8.25 | 4.5 |
| `--status-suspended-foreground` | `--status-suspended` | #431407 on #fdba74 | 9.28 | 4.5 |
| `--kind-orchestration-foreground` | `--kind-orchestration` | #e5e7eb on #2a2e37 | 10.98 | 4.5 |
| `--kind-entity-foreground` | `--kind-entity` | #0b1020 on #f472b6 | 7.15 | 4.5 |
| `--on-poster` | `--poster-1` | #0b1020 on #818cf8 | 6.35 | 4.5 |
| `--on-poster` | `--poster-2` | #0b1020 on #f472b6 | 7.15 | 4.5 |
| `--on-poster` | `--poster-3` | #0b1020 on #22d3ee | 10.48 | 4.5 |
| `--on-poster` | `--poster-4` | #0b1020 on #4ade80 | 10.86 | 4.5 |
| `--on-poster` | `--poster-5` | #0b1020 on #fbbf24 | 11.34 | 4.5 |
| `--on-poster` | `--poster-6` | #0b1020 on #a78bfa | 6.96 | 4.5 |
| `--json-string` | `--card` | #f9a8d4 on #2a2e37 | 7.50 | 4.5 |
| `--json-number` | `--card` | #67e8f9 on #2a2e37 | 9.38 | 4.5 |
| `--json-boolean` | `--card` | #c4b5fd on #2a2e37 | 7.37 | 4.5 |
| `--json-null` | `--card` | #a3a9b5 on #2a2e37 | 5.76 | 4.5 |
| `--json-string` | `--input` | #f9a8d4 on #2a2e37 | 7.50 | 4.5 |
| `--json-number` | `--input` | #67e8f9 on #2a2e37 | 9.38 | 4.5 |
| `--json-boolean` | `--input` | #c4b5fd on #2a2e37 | 7.37 | 4.5 |
| `--paper` | `--glyph` (the editor bar) | #2a2e37 on #e5e7eb | 10.98 | 4.5 |
| `--ring` | `--background` | #a78bfa on #2a2e37 | 5.00 | 3 |
| `--ring` | `--card` | #a78bfa on #2a2e37 | 5.00 | 3 |

The terminated status at night is the one pair near the line (4.55), as in Glass; the ring in light
mode is the next nearest (4.63 against a 3:1 need).

### The edge of a raised surface

This family has no line to speak of, so what says "this is a surface" is the pair of shadows. The
densest pixel of each, composited over the paper, against the paper itself:

| Mode | Paper | Shade edge (`--neu-dark` over paper) | Ratio | Light edge (`--neu-light` over paper) | Ratio |
|---|---|---|---|---|---|
| light | #e3e8f0, L 0.803 | #c0cad9, L 0.585 | 1.34 | #fbfcfd, L 0.972 | 1.20 |
| dark | #2a2e37, L 0.027 | #16181e, L 0.009 | 1.30 | #383d49, L 0.047 | 1.25 |

About 1.3:1 at the edge and fading to 1:1 over 14 px in both modes: the elevation reads on a
calibrated screen and is soft by design. On a cheap panel that crushes the blacks, the dark mode's
shade edge (L 0.009 against 0.027) is the first thing to go and the light edge on the top-left is
what carries the surface; a reader who needs more asks for it through `prefers-contrast: more`, which
gives every surface a 40 % line as well.

### Not text pairs

`--node-foreground` is declared for every theme but nothing paints text with it (a node fill is the
band on a function-graph card and a legend square); listed so that the numbers exist, as in the Glass
review. Poster's own dark block fails the same two.

| Mode | Text | On | Composited | Ratio |
|---|---|---|---|---|
| light | `--node-foreground` | every `--node-*` | #1f2937 on the pastels | 8.09–12.11 |
| dark | `--node-foreground` | `--node-orchestrator` … `--node-timer` | #0b1020 on the tints | 6.35–11.34 |
| dark | `--node-foreground` | `--node-queue` | #0b1020 on #64748b | 3.98 |
| dark | `--node-foreground` | `--node-other` | #0b1020 on #30353f | 1.54 |

## Left to E15-S2-T1

The preview page has no peek panel, palette, bottom nav, More sheet, JSON editor or Svelte Flow
canvas. Known from the stylesheet before any shot: the JSON viewer and editor (`.jse-theme-dfm`)
paint the card's material with a 35 % line and no inset, so they sit flat where `.ed` is sunk; a
raised surface inside a raised surface (a `.tbl-wrap` in a `.panel`, a `.btn` in a `.tbl-wrap`) has
to be read for whether the inner shadow still shows against the outer; the selected and the hovered
table row are one step of the material apart and have to be read on the real list.
