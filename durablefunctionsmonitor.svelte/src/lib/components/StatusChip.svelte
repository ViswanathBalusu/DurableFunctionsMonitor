<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { statusClass } from '$lib/format/status';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    /** As the backend spells it; an unknown value still renders, without a status colour. */
    status: string;
    size?: 'md' | 'sm';
    class?: string;
  }

  let { status, size = 'md', class: className, ...rest }: Props = $props();
</script>

<!-- The text is the status verbatim (contracts §11: ContinuedAsNew is shown as it comes). -->
<span class={cn('chip', statusClass(status), size === 'sm' ? 'sm' : '', className)} {...rest}>{status}</span>
