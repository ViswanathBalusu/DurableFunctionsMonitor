<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLButtonAttributes, 'children'> {
    /** The current choice of a radio group, or the current screen in a nav menu. */
    active?: boolean;
    /** Purge, delete, terminate: coloured by `.mi.destructive`. */
    destructive?: boolean;
    role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
    checked?: boolean;
    /** An icon or a box before the label. */
    leading?: Snippet;
    /** A shortcut or a count after the label, in `.meta` (DFM App.dc.html L50). */
    meta?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let {
    active = false,
    destructive = false,
    role = 'menuitem',
    checked,
    leading,
    meta,
    children,
    class: className,
    type = 'button',
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  class={cn('mi', active ? 'active' : '', destructive ? 'destructive' : '', className)}
  {role}
  aria-checked={role === 'menuitem' ? undefined : (checked ?? active)}
  {...rest}
>
  {@render leading?.()}
  {@render children?.()}
  {#if meta}
    <span class="grow"></span>
    <span class="meta">{@render meta()}</span>
  {/if}
</button>
