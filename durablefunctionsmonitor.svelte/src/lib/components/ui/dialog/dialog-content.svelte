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

<!-- No floating close button: every dialog in the mockups closes through its own `.foot` buttons. -->
<DialogPortal {...portalProps}>
  <Dialog.Overlay />
  <DialogPrimitive.Content bind:ref data-slot="dialog-content" class={cn('dialog', className)} {...restProps}>
    {@render children?.()}
  </DialogPrimitive.Content>
</DialogPortal>
