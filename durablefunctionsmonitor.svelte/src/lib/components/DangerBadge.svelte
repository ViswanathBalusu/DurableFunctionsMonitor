<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    size?: 'md' | 'sm';
    /** The wording of `DFM App.dc.html` L69. */
    text?: string;
    class?: string;
  }

  let {
    size = 'md',
    text = 'Dangerous operations on',
    class: className,
    title = '/about lists DurableFunctionsMonitor.DangerousOperations',
    ...rest
  }: Props = $props();
</script>

<span class={cn('dbadge', size === 'sm' ? 'sm' : '', className)} {title} {...rest}>{text}</span>
