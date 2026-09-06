<script lang="ts" module>
  /** The six fills of the mockup's legend, in its order (ScreenInstance.dc.html L99). */
  export const TIMELINE_LEGEND: readonly { label: string; cls?: string; style?: string }[] = [
    { label: 'activity', cls: 'st-completed' },
    { label: 'failed', cls: 'st-failed' },
    { label: 'running', cls: 'st-running' },
    { label: 'timer', cls: 'st-suspended' },
    { label: 'waiting for event', style: 'border-style:dotted' },
    // A mark, so the glyph: the ink in the papers, a strong colour where the line is a rim (E14)
    { label: 'orchestrator replay', style: 'background:var(--glyph)' },
  ];

  /** What the meta beside the legend says the picture is for (L99). */
  export const HOVER_HINT = 'hover a span to find its history rows';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { HistoryEvent } from '$lib/api/types';
  import Swimlane from '$lib/charts/Swimlane.svelte';
  import Button from '$lib/components/Button.svelte';
  import { fmtTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { isTerminal, type InstanceState } from '$lib/state/instance.svelte';
  import HistoryTab from './HistoryTab.svelte';
  import { buildTimeline } from './timeline-lanes';
  import { cn } from '$lib/utils';

  interface Props {
    instance: InstanceState;
  }

  let { instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const spans = $derived(instance.spans);
  const history = $derived(instance.history);

  let swimlane = $state<Swimlane | null>(null);

  const timeline = $derived(
    buildTimeline({
      spans: spans.response,
      name: instance.functionName,
      running: !isTerminal(instance.status),
      history: history.rows,
    }),
  );

  /** `31 of 31 events`, or what is loaded of what the provider counted (L118). */
  const counted = $derived(
    spans.historyRows === null
      ? `${history.rows.length} events`
      : `${history.rows.length} of ${spans.historyRows} events`,
  );

  /** A row hovered lights its span; a span hovered lights every row it was built from. */
  function enterRow(row: HistoryEvent): void {
    spans.hover = spans.spanForSequence(row.SequenceNumber)?.id ?? null;
  }

  /**
   * A row clicked scrolls its span into view. The strip scrolls sideways under a long run, so a
   * click on the last row of a history is the only way to see the bar it belongs to.
   */
  function scrollToSpan(row: HistoryEvent): void {
    const id = spans.spanForSequence(row.SequenceNumber)?.id;
    const root = swimlane?.element();

    if (!id || !root) {
      return;
    }

    const bar = root.querySelector(`[data-bar="${CSS.escape(id)}"]`);
    const lane = bar?.closest('.lane') ?? root.querySelector(`[data-lane="${CSS.escape(id)}"]`);

    lane?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
</script>

<!--
  ScreenInstance.dc.html L88-L118: the swimlane of this execution, what its fills mean, and the same
  history the History tab shows - here without its rail, because the picture above is drawn over the
  whole execution and a filtered table under it would not line up with it.
-->
<Swimlane
  bind:this={swimlane}
  lanes={timeline.lanes}
  domain={timeline.domain}
  highlightKey={spans.hover}
  ariaLabel="Timeline"
  formatTick={(date) => fmtTime(date.toISOString(), app.prefs.showTimeAs)}
  onLaneEnter={(key) => (spans.hover = key)}
  onLaneLeave={() => (spans.hover = null)}
/>

<div class="row" style="justify-content:space-between">
  <div class="legend">
    {#each TIMELINE_LEGEND as item (item.label)}
      <span><i class={cn(item.cls)} style={item.style}></i>{item.label}</span>
    {/each}
  </div>

  <span class="meta">{HOVER_HINT}</span>
</div>

<HistoryTab
  {instance}
  linked
  highlightKey={spans.hoveredRowKeys}
  onRowEnter={enterRow}
  onRowLeave={() => (spans.hover = null)}
  onRowClick={scrollToSpan}
>
  {#snippet tableFooter()}
    <span class="meta">{counted} · SequenceNumber from the provider</span>

    <Button variant="ghost" size="sm" onclick={() => instance.setTab('history')}>Open History tab</Button>
  {/snippet}
</HistoryTab>
