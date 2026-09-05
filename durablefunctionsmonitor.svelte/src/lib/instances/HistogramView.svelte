<script lang="ts">
  import { getContext } from 'svelte';
  import StackedColumns from '$lib/charts/StackedColumns.svelte';
  import type { Range } from '$lib/charts/stacked-columns';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import { fmtInt } from '$lib/format/number';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { InstancesHistogram } from '$lib/state/instances-histogram.svelte';
  import type { Instances } from '$lib/state/instances.svelte';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  // The screen owns one Instances object for as long as it is on, so capturing it here is the point
  // svelte-ignore state_referenced_locally
  const histogram = new InstancesHistogram({ app, instances });

  /** The selection on the chart; a brush is a zoom, so it is cleared as soon as it is applied. */
  let brush = $state<Range | null>(null);

  /**
   * The histogram counts the whole filtered list, so it reloads when the filters or the shared range
   * change. Keyed on the inputs rather than on `instances.filter`, which resolves a preset range
   * against the clock and so is never twice the same string.
   */
  const filterKey = $derived(
    JSON.stringify([
      instances.statuses,
      instances.names,
      instances.column,
      instances.op,
      instances.applied,
      instances.includeEntities,
      app.timeRange,
    ]),
  );

  let loadedKey = '';

  $effect(() => {
    const key = filterKey;

    if (key === loadedKey) {
      return;
    }

    loadedKey = key;

    // Out of the effect: loading writes state, which is not what an effect is for
    queueMicrotask(() => void histogram.load());
  });

  $effect(() => app.onRefresh(() => void histogram.load()));

  function onBrush(range: Range | null): void {
    if (!range) {
      return;
    }

    // The brushed window becomes the whole range, so the selection has done its job
    brush = null;
    histogram.zoom(range);
  }
</script>

<!-- ScreenInstances.dc.html L110-L125: the columns, then the legend and what the brush does. -->
<div
  class="brutal-flat"
  style="background:var(--card);border-top:0;padding:0 0 12px;border-radius:0 0 var(--radius) var(--radius)"
>
  <!-- The padding of the mockup's `.hist`, which the chart itself does not carry (L111) -->
  <div style="padding:16px 12px 0">
    <StackedColumns
      bins={histogram.bins}
      series={histogram.series}
      bind:brush
      {onBrush}
      ariaLabel={histogram.ariaLabel}
      legendMeta="brush narrows the time filter"
    />
  </div>

  <div class="row" style="padding:10px 12px 0;gap:10px">
    <span class="meta">{fmtInt(histogram.scanned)} instances scanned</span>

    {#if histogram.zoomedIn}
      <LinkButton onclick={() => histogram.resetZoom()}>Reset zoom</LinkButton>
    {/if}
  </div>
</div>
