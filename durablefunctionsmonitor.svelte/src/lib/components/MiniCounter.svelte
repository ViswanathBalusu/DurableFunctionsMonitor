<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { statusClass } from '$lib/format/status';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    count: number;
    /** Colours the counter with the status palette (ScreenFunctions.dc.html L57). */
    status?: string;
    class?: string;
  }

  let { count, status, class: className, ...rest }: Props = $props();
</script>

<span class={cn('mini', statusClass(status), className)} {...rest}>{count}</span>
