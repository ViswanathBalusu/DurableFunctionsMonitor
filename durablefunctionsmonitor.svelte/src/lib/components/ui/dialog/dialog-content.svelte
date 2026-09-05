<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import * as Dialog from './index.js';
  import DialogPortal from './dialog-portal.svelte';
  import type { Snippet } from 'svelte';
  import type { ComponentProps } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
    children: Snippet;
  } = $props();
</script>

<!--
  No floating close button: every dialog in the mockups closes through its own `.foot` buttons.
  The dialog sits *inside* the overlay, as `.overlay > .dialog` does in every mockup: that is what
  centres it (the overlay is the flex container) and what puts it above the sheet of ink - as
  siblings the overlay would paint over the dialog and swallow every click on it.
-->
<DialogPortal {...portalProps}>
  <Dialog.Overlay>
    <DialogPrimitive.Content bind:ref data-slot="dialog-content" class={cn('dialog', className)} {...restProps}>
      {@render children?.()}
    </DialogPrimitive.Content>
  </Dialog.Overlay>
</DialogPortal>
