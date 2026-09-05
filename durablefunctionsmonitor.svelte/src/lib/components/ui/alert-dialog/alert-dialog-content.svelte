<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import AlertDialogOverlay from './alert-dialog-overlay.svelte';
  import AlertDialogPortal from './alert-dialog-portal.svelte';
  import type { Snippet } from 'svelte';
  import type { ComponentProps } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    ...restProps
  }: WithoutChildrenOrChild<AlertDialogPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>;
    children: Snippet;
  } = $props();
</script>

<!-- Inside the overlay, as `.overlay > .dialog` in the mockups: see dialog-content.svelte. -->
<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay>
    <AlertDialogPrimitive.Content
      bind:ref
      data-slot="alert-dialog-content"
      class={cn('dialog', className)}
      {...restProps}
    >
      {@render children?.()}
    </AlertDialogPrimitive.Content>
  </AlertDialogOverlay>
</AlertDialogPortal>
