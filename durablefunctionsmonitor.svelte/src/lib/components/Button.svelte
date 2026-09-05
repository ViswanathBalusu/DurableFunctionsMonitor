<script lang="ts" module>
  /**
   * `danger` is the stripe-topped destructive of dfm-ui.css L93-L94: it is what a Dangerous operation
   * (replay, restart in place) uses, so that it never looks like an ordinary destructive action.
   */
  export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'destructive' | 'danger' | 'ghost';

  export type ButtonSize = 'md' | 'sm';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLButtonAttributes & HTMLAnchorAttributes, 'children'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Drops the brutal shadow: for buttons that sit inside a bar or a toolbar. */
    flat?: boolean;
    /** Renders a real `<a>` - not a button with a role - so middle-click and copy-link work. */
    href?: string;
    /** Rendered before the label, at 16px (`.btn svg.ico`). */
    icon?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let {
    variant = 'default',
    size = 'md',
    flat = false,
    href,
    icon,
    children,
    class: className,
    type = 'button',
    ...rest
  }: Props = $props();

  const classes = $derived(
    cn('btn', variant === 'default' ? '' : variant, size === 'sm' ? 'sm' : '', flat ? 'flat' : '', className),
  );
</script>

{#if href}
  <a {href} class={classes} {...rest}>
    {@render icon?.()}
    {@render children?.()}
  </a>
{:else}
  <button {type} class={classes} {...rest}>
    {@render icon?.()}
    {@render children?.()}
  </button>
{/if}
