<script lang="ts">
  import { getContext } from 'svelte';
  import Swimlane from '$lib/charts/Swimlane.svelte';
  import { saveSvg } from '$lib/charts/svg-export';
  import Button from '$lib/components/Button.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import { statusClass } from '$lib/format/status';
  import { isRouterClick } from '$lib/router.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { InstancesTimeline, TIMELINE_TICKS } from '$lib/state/instances-timeline.svelte';
  import type { Instances } from '$lib/state/instances.svelte';
  import { toPeekItem } from './columns';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  // The screen owns one Instances object for as long as it is on, so capturing it here is the point
  // svelte-ignore state_referenced_locally
  const timeline = new InstancesTimeline({ app, instances });

  let chart = $state<ReturnType<typeof Swimlane> | null>(null);

  /** The statuses the mockup's legend lists, in its order (L107). */
  const LEGEND = ['Completed', 'Running', 'Failed', 'Pending', 'Terminated', 'Suspended', 'ContinuedAsNew'];

  /**
   * The timeline is its own query - 500 rows in created order - so it reloads when the filters or
   * the shared range change. Keyed on the filter inputs rather than on `instances.filter`, which
   * resolves the range against the clock and so is never twice the same string.
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
    queueMicrotask(() => void timeline.load());
  });

  $effect(() => {
    // The screen's Refresh, the palette's and VS Code's all reload what is on screen (E2-S6-T2)
    return app.onRefresh(() => void timeline.load());
  });

  function open(key: string): void {
    const row = timeline.rowOf(key);

    if (row) {
      app.peek.open(toPeekItem(row));
    }
  }

  function goToInstance(key: string, event: MouseEvent): void {
    if (!isRouterClick(event)) {
      return;
    }

    event.preventDefault();
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId: key });
  }

  async function save(): Promise<void> {
    const svg = chart?.toSvg();

    if (svg) {
      await app.track(saveSvg(app.client, svg, 'instances-gantt.svg'));
    }
  }
</script>

<!-- ScreenInstances.dc.html L99-L108: the lanes under the view strip, then the legend and the export. -->
<Swimlane
  bind:this={chart}
  lanes={timeline.lanes}
  domain={timeline.domain}
  ticks={TIMELINE_TICKS}
  formatTick={(_, index) => timeline.axisTicks[index] ?? ''}
  axisLabel="instance"
  ariaLabel="Instances timeline"
  style="border-top:0;border-radius:0 0 var(--radius) var(--radius)"
  onLaneClick={open}
  onLaneLabelClick={goToInstance}
/>

<div class="row" style="justify-content:space-between;margin-top:10px">
  <div class="legend">
    {#each LEGEND as status (status)}
      <span><i class={statusClass(status)}></i>{status}</span>
    {/each}
  </div>

  {#if timeline.loading}
    <ProgressBar inline />
  {/if}

  <Button variant="ghost" size="sm" onclick={() => void save()}>Save as SVG</Button>
</div>
