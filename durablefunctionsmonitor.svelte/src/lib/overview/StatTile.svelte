<script lang="ts">
  import Sparkline from '$lib/charts/Sparkline.svelte';
  import { fmtInt } from '$lib/format/number';
  import { cn } from '$lib/utils';

  interface Props {
    label: string;
    count: number;
    /** One value per bin of the range; the line takes its colour from the tile (`currentColor`). */
    values: number[];
    /** The status or kind fill: `st-running`, `kind-entity`, … (contracts §11). */
    class?: string;
    onclick?: () => void;
  }

  let { label, count, values, class: className, onclick }: Props = $props();
</script>

<!--
  ScreenOverview.dc.html L31-L36: the label, the number and the shape of the range under it. The
  whole tile is the link - a number worth showing is a number worth opening the list behind.
-->
<button class={cn('stat-tile', className)} type="button" {onclick}>
  <span class="lbl">{label}</span>
  <span class="num">{fmtInt(count)}</span>
  <Sparkline {values} />
</button>
