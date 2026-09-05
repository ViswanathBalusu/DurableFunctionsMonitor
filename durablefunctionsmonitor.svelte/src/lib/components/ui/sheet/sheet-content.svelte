<script lang="ts">
  import { Dialog as SheetPrimitive } from 'bits-ui';
  import SheetOverlay from './sheet-overlay.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import type { Snippet } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    overlayClass,
    portalProps,
    side = 'right',
    children,
    ...restProps
  }: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
    portalProps?: SheetPrimitive.PortalProps;
    side?: 'top' | 'right' | 'bottom' | 'left';
    /** `clear` for the peek panel, whose overlay only catches the outside click (dfm-ui.css L244). */
    overlayClass?: string;
    children: Snippet;
  } = $props();

  // The two the design system knows: the right-hand peek panel and the bottom sheet of the mobile
  // More menu. `top` and `left` fall back to the peek, which is the only other panel shape there is.
  const sideClass = $derived(side === 'bottom' ? 'sheet' : 'peek');
</script>

<SheetPrimitive.Portal {...portalProps}>
  <SheetOverlay class={overlayClass} />
  <SheetPrimitive.Content
    bind:ref
    data-slot="sheet-content"
    data-side={side}
    class={cn(sideClass, className)}
    {...restProps}
  >
    {@render children?.()}
  </SheetPrimitive.Content>
</SheetPrimitive.Portal>
