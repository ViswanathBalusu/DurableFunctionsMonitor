<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    /** Under the top bar the bar has only a bottom border (DFM App.dc.html L96). */
    inline?: boolean;
    label?: string;
    class?: string;
  }

  let { inline = false, label = 'Loading', class: className, style, ...rest }: Props = $props();
</script>

<!-- Indeterminate by design: DfMon never knows how far a scan has got, only that it is running. -->
<div
  class={cn('progress', className)}
  role="progressbar"
  aria-label={label}
  style={inline ? `border-width:0 0 var(--border-width);${style ?? ''}` : (style as string | undefined)}
  {...rest}
></div>
