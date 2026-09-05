<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as DialogPrimitive from '$lib/components/ui/dialog/index.js';

  interface Props {
    /** Bindable. */
    open?: boolean;
    /** Rendered as the `<h3 class="display">` at the top of the body. */
    title?: string;
    /** The hazard stripe above the body, for anything destructive or Dangerous. */
    band?: boolean;
    ariaLabel?: string;
    /** The mockups' dialogs are 560px; the wider ones say so. */
    width?: number;
    children?: Snippet;
    /** The buttons, rendered inside `.foot`. */
    footer?: Snippet;
  }

  let { open = $bindable(false), title, band = false, ariaLabel, width = 560, children, footer }: Props = $props();
</script>

<!--
  Structure of the mockups' dialogs (ScreenInstances.dc.html L143-L150): `.overlay > .dialog >
  (.warn) .body + .foot`. Escape, the overlay click, the focus trap and returning focus on close all
  come from the restyled bits-ui dialog.
-->
<DialogPrimitive.Root bind:open>
  <DialogPrimitive.Content aria-label={ariaLabel ?? title} style={`width:min(${width}px,100%)`}>
    {#if band}
      <div class="warn"></div>
    {/if}
    <DialogPrimitive.Header>
      {#if title}
        <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
      {/if}
      {@render children?.()}
    </DialogPrimitive.Header>
    {#if footer}
      <DialogPrimitive.Footer>
        {@render footer()}
      </DialogPrimitive.Footer>
    {/if}
  </DialogPrimitive.Content>
</DialogPrimitive.Root>
