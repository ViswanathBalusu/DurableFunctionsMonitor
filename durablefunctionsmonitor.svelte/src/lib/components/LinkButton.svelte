<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'children'> {
    /** Renders a real `<a>`, so an instance link can be opened in a new tab or copied. */
    href?: string;
    /** Monospace, for instance ids and other identifiers. */
    mono?: boolean;
    muted?: boolean;
    /**
     * Table rows are clickable in their own right (they open the workspace), so a link inside one has
     * to keep its click to itself.
     */
    stopPropagation?: boolean;
    children?: Snippet;
    class?: string;
  }

  let {
    href,
    mono = false,
    muted = false,
    stopPropagation = false,
    children,
    class: className,
    onclick,
    type = 'button',
    ...rest
  }: Props = $props();

  const classes = $derived(cn('link', mono ? 'mono' : '', muted ? 'muted' : '', className));

  function handleClick(event: MouseEvent): void {
    if (stopPropagation) {
      event.stopPropagation();
    }

    (onclick as ((event: MouseEvent) => void) | undefined)?.(event);
  }
</script>

{#if href}
  <a {href} class={classes} onclick={handleClick} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button {type} class={classes} onclick={handleClick} {...rest}>
    {@render children?.()}
  </button>
{/if}
