<script lang="ts" module>
  import type { SpansTotals } from '$lib/api/types';

  /** A slice narrower than this is drawn at {@link MIN_SLICE} instead of not at all. */
  export const THIN_SLICE = 0.01;
  export const MIN_SLICE = '2px';

  export interface TimeSlice {
    id: string;
    label: string;
    /** What the slice is filled with - the `.wbar` bar and the `.swq` swatch alike (dfm-ext.css). */
    fill: string;
    ms: number;
    /** How much of the run this kind took, as a fraction - which is what `fmtPct` takes. */
    share: number;
  }

  /**
   * The kinds in the order the mockup's bar stacks them (L59), without the ones that took no time
   * at all and without the orchestrator when the provider reports no episodes to measure.
   *
   * The shares are of the run's wall clock, so they need not add up to it: an orchestrator that sat
   * idle leaves a gap, and activities that ran in parallel add up to more than the run they ran in.
   * `.wbar` is a flex row, so slices that together exceed it shrink to fit rather than spilling out.
   */
  export function timeSlices(totals: SpansTotals): TimeSlice[] {
    const kinds: (Omit<TimeSlice, 'share' | 'ms'> & { ms: number | null })[] = [
      { id: 'activities', label: 'activities', fill: 'st-completed', ms: totals.activitiesMs },
      { id: 'externalEvent', label: 'external event', fill: 'wait', ms: totals.externalEventWaitMs },
      { id: 'timers', label: 'timers', fill: 'st-suspended', ms: totals.timersMs },
      { id: 'orchestrator', label: 'orchestrator', fill: 'orch', ms: totals.orchestratorMs },
      { id: 'subOrchestrations', label: 'sub-orchestrations', fill: 'st-running', ms: totals.subOrchestrationsMs },
    ];

    const total = totals.totalMs > 0 ? totals.totalMs : 0;

    return kinds
      .filter((kind): kind is Omit<TimeSlice, 'share'> => typeof kind.ms === 'number' && kind.ms > 0)
      .map((kind) => ({ ...kind, share: total > 0 ? kind.ms / total : 0 }));
  }
</script>

<script lang="ts">
  import { fmtDuration } from '$lib/format/duration';
  import { fmtPct } from '$lib/format/number';
  import { cn } from '$lib/utils';

  interface Props {
    totals: SpansTotals;
  }

  let { totals }: Props = $props();

  const slices = $derived(timeSlices(totals));

  function width(slice: TimeSlice): string {
    const percent = `width:${(slice.share * 100).toFixed(2)}%`;

    return slice.share < THIN_SLICE ? `${percent};min-width:${MIN_SLICE}` : percent;
  }
</script>

<!--
  ScreenInstance.dc.html L57-L65: the run as a stacked bar of what it spent its time on, and the same
  numbers underneath in the fills the swimlane uses for them.
-->
<div class="panel">
  <div class="panel-h">
    <h3>Where the time went</h3>
    <span class="fine muted" style="margin-left:auto">/spans · {fmtDuration(totals.totalMs)}</span>
  </div>

  <div class="wbar" aria-hidden="true">
    {#each slices as slice (slice.id)}
      <i class={slice.fill} style={width(slice)}></i>
    {/each}
  </div>

  <dl class="kv" style="grid-template-columns:auto 1fr auto;margin-top:10px">
    {#each slices as slice (slice.id)}
      <dt><span class={cn('swq', slice.fill)}></span> {slice.label}</dt>
      <dd class="mono">{fmtDuration(slice.ms)}</dd>
      <dd class="mono muted">{fmtPct(slice.share)}</dd>
    {/each}
  </dl>
</div>
