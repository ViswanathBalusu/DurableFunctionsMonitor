<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    /** A menu of actions, or a popover holding arbitrary content (a column chooser, a filter). */
    kind?: 'menu' | 'popover';
    /**
     * The trigger, which receives the props that make it one - spread them onto your element. It is
     * wrapped in `.anchor`, which is what the `.pop` positions against.
     */
    anchor: Snippet<[{ props: Record<string, unknown> }]>;
    children: Snippet;
    /** Bindable. */
    open?: boolean;
    align?: 'start' | 'end';
    ariaLabel?: string;
    minWidth?: string;
    padding?: string;
    class?: string;
  }

  let {
    kind = 'menu',
    anchor,
    children,
    open = $bindable(false),
    align = 'start',
    ariaLabel,
    minWidth,
    padding,
    class: className,
  }: Props = $props();

  // `.pop.right` is the end-aligned variant (dfm-ui.css L228); the rest is inline sizing the mockups
  // set per popover.
  const contentClass = $derived(cn(align === 'end' ? 'right' : '', className));
  const contentStyle = $derived(
    [minWidth ? `min-width:${minWidth}` : '', padding ? `padding:${padding}` : ''].filter(Boolean).join(';') ||
      undefined,
  );
</script>

<div class="anchor">
  {#if kind === 'menu'}
    <DropdownMenu.Root bind:open>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          {@render anchor({ props })}
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class={contentClass} style={contentStyle} aria-label={ariaLabel} {align}>
        {@render children()}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {:else}
    <Popover.Root bind:open>
      <Popover.Trigger>
        {#snippet child({ props })}
          {@render anchor({ props })}
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class={contentClass} style={contentStyle} aria-label={ariaLabel} {align}>
        {@render children()}
      </Popover.Content>
    </Popover.Root>
  {/if}
</div>
