---
name: dfm-d3-charts
description: Patterns for the D3 charts (stacked columns with brush, sparklines, swimlane timeline, sequence diagram) and the Svelte Flow function graph in the DFM Svelte UI - D3 computes, Svelte renders, tokens via CSS variables, SVG export without scripts. Use for E1-S8, E4-S4/S5, E5-S5/S6, E7-S2, E8-S2 and any chart or graph task.
---

# DFM charts and graphs

Design rules: `docs/ui-plans-artifacts/uploads/files/dfm-design-system.md` §8 (Gantt, Time histogram, Sequence diagram, Functions Graph, Timeline swimlane) and §6 (motion). Solid fills, 2 px ink outlines, hard shadows, mono labels, no gradients, no alpha except the hatch pattern for brushes.

## D3 computes, Svelte renders

Use D3 for math only (`d3-scale`, `d3-shape`, `d3-time`, `d3-array`) and let Svelte own the DOM:

```svelte
<script lang="ts">
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { stack } from 'd3-shape';
  let { bins, series, width = 800, height = 160 }: Props = $props();
  const x = $derived(scaleTime().domain([bins[0].start, bins.at(-1)!.end]).range([12, width - 12]));
  const y = $derived(scaleLinear().domain([0, maxTotal(bins)]).range([height - 16, 16]));
  const stacked = $derived(stack<Bin>().keys(series.map((s) => s.key)).value((b, k) => b.values[k] ?? 0)(bins));
</script>

<svg viewBox="0 0 {width} {height}" role="img" aria-label={ariaLabel}>
  {#each stacked as layer, i}
    {#each layer as [y0, y1], j}
      <rect x={x(bins[j].start)} width={x(bins[j].end) - x(bins[j].start)} y={y(y1)} height={y(y0) - y(y1)}
            style="fill: var(--{series[i].color}); stroke: var(--ink); stroke-width: 2" />
    {/each}
  {/each}
</svg>
```

- Colours: `style="fill: var(--status-completed)"` so theme and mode switches apply live. Resolve to real colours only for export (`tokenColor` in `src/lib/charts/chart-tokens.ts`).
- Size: measure the container with a `ResizeObserver` in an `$effect`, keep `width` in `$state`; charts are responsive, not fixed.
- The only D3 DOM users are `d3-brush` (attach to a `<g bind:this>` inside an `$effect`, clean up in the return) and `d3-selection` for that brush. Never let D3 render data joins into the Svelte-owned tree.
- Brush selections render as an ink-outlined rect filled with a `<pattern>` of 45° hatch lines, never a translucent fill. Snap to bin edges; call `onBrush` on `end`; Escape clears.
- Axis ticks: mono 11 px (`class="fine"`), `fmtTime` formatters from `$lib/format/time` so UTC/Local applies.
- Tooltips: an absolutely positioned `<div class="pop">` next to the pointer with mono values; no SVG `<title>`-only tooltips.
- Motion: none except hover lift on buttons; charts re-render instantly on data change. Respect `prefers-reduced-motion` by having nothing to reduce.

## Swimlane and sequence diagram are HTML

`Swimlane.svelte` and `SequenceDiagram.svelte` reproduce the mockup's HTML/CSS structure (`.swim .lane .track .bar`, `.seq .parts .life .smsg .arrow`) because the stylesheet already styles them. Compute `left`/`width` percentages with `scaleLinear` over the time domain. Provide a `toSvg()` method that builds an equivalent SVG string for "Save as SVG".

## Function graph (Svelte Flow)

- `@xyflow/svelte` with a custom node type that renders the mockup's `.node` markup (band, kind, name, mini counters). Layout with `@dagrejs/dagre` (`rankdir: 'LR'`, `ranksep: 48`, `nodesep: 16`), positions applied before mounting.
- Edges `smoothstep` with `borderRadius: 0`, 2 px ink, filled square-ish arrowhead (`markerEnd` type `arrowclosed`); active path edges get class `active` (ring colour, 3 px). Theming through the `.svelte-flow` bridge variables in `dfm-tokens.css`; overrides in `src/styles/dfm-ext.css`.
- Controls and minimap restyled to `.gctl` / `.minimap` looks via `dfm-ext.css`.
- Export: `graphToSvg(model, positions)` builds plain SVG (rects, text, polylines); never `foreignObject` or scripts (VS Code refuses SVG containing `<script`).

## Testing charts

- Unit-test the pure layout/model functions (`stacked-columns.ts`, `swimlane.ts`, `sequence-model.ts`, `function-graph-model.ts`, `layout.ts`, `graph-svg.ts`) with fixtures from the mockups.
- Component tests assert DOM structure (counts of rects/lanes, classes, labels) in jsdom with `ResizeObserver` mocked (`tests/unit/setup.ts`).
- Visual correctness is checked in the E12 theme matrix screenshots, not in unit tests.
