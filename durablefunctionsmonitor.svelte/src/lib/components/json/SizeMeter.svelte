<script lang="ts">
  import { MAX_INLINE_BYTES, fmtBytes } from '$lib/format/bytes';
  import { cn } from '$lib/utils';

  interface Props {
    bytes: number;
    /** Past this the payload no longer fits inline and the meter turns red. */
    limit?: number;
    class?: string;
  }

  let { bytes, limit = MAX_INLINE_BYTES, class: className }: Props = $props();

  const pct = $derived(Math.min(100, Math.max(0, Math.round((bytes / limit) * 100))));
  const over = $derived(bytes > limit);
</script>

<!-- ScreenInstances.dc.html L167: how much of the inline budget this payload uses. -->
<span class={cn('meter', over ? 'over' : '', className)}>
  <i style={`--pct:${pct}%`}></i>
  {fmtBytes(bytes)} of {fmtBytes(limit)}
</span>
