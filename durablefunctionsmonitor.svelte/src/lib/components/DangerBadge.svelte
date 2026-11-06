<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    size?: 'md' | 'sm';
    /** The wording of `DFM App.dc.html` L69. */
    text?: string;
    /**
     * A shorter wording, for a place that runs out of room: the top bar swaps it in at the widths a
     * laptop gives it beside the side nav (dfm-ext.css `.dbadge-short`). Only one of the two is ever
     * displayed, so a screen reader reads one.
     */
    short?: string;
    class?: string;
  }

  let {
    size = 'md',
    text = 'Dangerous operations on',
    short,
    class: className,
    title = '/about lists DurableFunctionsMonitor.DangerousOperations',
    ...rest
  }: Props = $props();
</script>

<span class={cn('dbadge', size === 'sm' ? 'sm' : '', className)} {title} {...rest}
  >{#if short}<span class="dbadge-long">{text}</span><span class="dbadge-short">{short}</span>{:else}{text}{/if}</span
>
