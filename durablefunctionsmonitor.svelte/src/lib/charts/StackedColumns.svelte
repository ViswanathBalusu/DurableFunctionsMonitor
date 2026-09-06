<script lang="ts">
  import { brushX, type D3BrushEvent } from 'd3-brush';
  import { select } from 'd3-selection';
  import { cn } from '$lib/utils';
  import {
    binsInPixelRange,
    layoutColumns,
    rangeOfBins,
    ticksFor,
    type ChartBin,
    type ChartSeries,
    type Range,
  } from './stacked-columns';

  interface Props {
    bins: ChartBin[];
    series: ChartSeries[];
    /** Bindable: the brushed range, or null when there is none. */
    brush?: Range | null;
    height?: number;
    /** How many ticks the axis under the chart shows. */
    xTicks?: number;
    formatTick?: (date: Date) => string;
    ariaLabel: string;
    /** A note at the end of the legend row ("brush narrows the time filter"). */
    legendMeta?: string;
    class?: string;
    onBrush?: (range: Range | null) => void;
  }

  let {
    bins,
    series,
    brush = $bindable(null),
    height = 160,
    xTicks = 6,
    formatTick = (date: Date) => date.toISOString().slice(11, 16),
    ariaLabel,
    legendMeta,
    class: className,
    onBrush,
  }: Props = $props();

  /** The SVG is drawn in a fixed user space and scaled to the element's width by the viewBox. */
  const WIDTH = 1000;

  const layout = $derived(layoutColumns(bins, series, WIDTH, height));
  const ticks = $derived(ticksFor(bins, WIDTH, xTicks, formatTick));

  let hovered = $state<number | null>(null);
  let brushGroup = $state<SVGGElement | null>(null);
  let svg = $state<SVGSVGElement | null>(null);

  /** The brush selection in pixels, or null - kept in sync with the `brush` prop. */
  const selection = $derived.by<[number, number] | null>(() => {
    if (!brush || bins.length === 0) {
      return null;
    }

    const columnWidth = WIDTH / bins.length;
    const first = bins.findIndex((bin) => bin.end > brush!.from);
    const lastIndex = bins.map((bin) => bin.start < brush!.to).lastIndexOf(true);

    if (first < 0 || lastIndex < 0) {
      return null;
    }

    return [first * columnWidth, (lastIndex + 1) * columnWidth];
  });

  $effect(() => {
    const group = brushGroup;

    if (!group) {
      return;
    }

    const behaviour = brushX<unknown>()
      .extent([
        [0, 0],
        [WIDTH, height],
      ])
      .on('end', (event: D3BrushEvent<unknown>) => {
        // A programmatic move (the effect below, reflecting the prop) fires `end` with no source
        // event. Acting on it would report a range the caller just gave us, and loop.
        if (!event.sourceEvent) {
          return;
        }

        const range = event.selection as [number, number] | null;

        if (!range) {
          apply(null);
          return;
        }

        const span = binsInPixelRange(bins, WIDTH, range[0], range[1]);
        apply(span ? rangeOfBins(bins, span[0], span[1]) : null);
      });

    const target = select(group);
    target.call(behaviour as never);

    // Reflect the current selection, so a range set elsewhere (the time-range chips) shows here too
    if (selection) {
      target.call(behaviour.move as never, selection as never);
    } else {
      target.call(behaviour.move as never, null as never);
    }

    return () => {
      target.on('.brush', null);
    };
  });

  export function applyBrush(x0: number, x1: number): void {
    const span = binsInPixelRange(bins, WIDTH, x0, x1);
    apply(span ? rangeOfBins(bins, span[0], span[1]) : null);
  }

  /** The SVG element, so a screen can save the chart (svg-export). */
  export function element(): SVGSVGElement | null {
    return svg;
  }

  function apply(range: Range | null): void {
    brush = range;
    onBrush?.(range);
  }

  function clear(): void {
    apply(null);
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && brush) {
      event.preventDefault();
      clear();
    }
  }
</script>

<!--
  The histogram of ScreenOverview.dc.html L41-L60, drawn in SVG so that it can be brushed and
  exported. Columns touch and every segment carries the 2px ink stroke, which is what makes the
  stack read as one block; the selection is an outlined rect over a diagonal hatch, never a
  translucent wash (design system §8). The hatch, the selection's edge and its handles are marks, so
  they are drawn in `--glyph` (E13); the segment outlines stay `--ink`.
-->
<svelte:window onkeydown={onWindowKeydown} />

<div class={cn('chart', className)} role="group" aria-label={ariaLabel}>
  <svg
    bind:this={svg}
    viewBox={`0 0 ${WIDTH} ${height}`}
    preserveAspectRatio="none"
    style="width:100%;height:{height}px"
  >
    <defs>
      <pattern id="dfm-brush-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="var(--glyph)" stroke-width="2" />
      </pattern>
    </defs>

    {#each layout.segments as segment (`${segment.binIndex}-${segment.seriesKey}`)}
      <rect
        x={segment.x}
        y={segment.y}
        width={segment.width}
        height={segment.height}
        fill={`var(--${segment.color})`}
        stroke="var(--ink)"
        stroke-width="2"
        role="presentation"
        onmouseenter={() => (hovered = segment.binIndex)}
        onmouseleave={() => (hovered = null)}
      ></rect>
    {/each}

    <line x1="0" y1={height} x2={WIDTH} y2={height} stroke="var(--muted)" stroke-width="1" />

    <g bind:this={brushGroup} class="dfm-brush"></g>
  </svg>

  <div class="row" style="justify-content:space-between;font-family:var(--font-mono);font-size:11px">
    {#each ticks as tick, index (index)}
      <span class="muted">{tick.label}</span>
    {/each}
  </div>

  <div class="legend" style="margin-top:8px">
    {#each series as s (s.key)}
      <span>
        <i style={`background:var(--${s.color})`}></i>
        {s.label}
      </span>
    {/each}

    {#if brush}
      <button class="link" type="button" onclick={clear}>clear</button>
    {/if}

    {#if legendMeta}
      <span class="meta" style="margin-left:auto">{legendMeta}</span>
    {/if}
  </div>

  {#if hovered !== null && bins[hovered]}
    <!-- The hover card: an ink-outlined `.pop`, the counts in mono, no translucency. -->
    <div class="pop" style="position:static;margin-top:8px;min-width:0" role="status">
      <div class="meta mono">
        {formatTick(bins[hovered].start)} – {formatTick(bins[hovered].end)}
      </div>
      {#each series as s (s.key)}
        {#if (bins[hovered].values[s.key] ?? 0) > 0}
          <div class="mono">{s.label}: {bins[hovered].values[s.key]}</div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* d3-brush draws its own overlay; the selection has to look like the design system, not like d3. */
  :global(.dfm-brush .selection) {
    fill: url(#dfm-brush-hatch);
    fill-opacity: 1;
    stroke: var(--glyph);
    stroke-width: 2;
  }

  :global(.dfm-brush .handle) {
    fill: var(--glyph);
  }
</style>
