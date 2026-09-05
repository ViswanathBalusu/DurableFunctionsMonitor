<script lang="ts">
  import { SPARKLINE_HEIGHT, SPARKLINE_WIDTH, sparklinePoints } from './sparkline';

  interface Props {
    values: number[];
    class?: string;
  }

  let { values, class: className }: Props = $props();

  const points = $derived(sparklinePoints(values));
</script>

<!--
  The trend line inside a stat tile (ScreenOverview.dc.html L31). aria-hidden: the number beside it is
  the information; the line is its shape. The stroke comes from the tile's `currentColor`, so a tile
  that changes status colour changes its line with it.
-->
<svg
  viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
  preserveAspectRatio="none"
  aria-hidden="true"
  class={className}
>
  <polyline {points}></polyline>
</svg>
