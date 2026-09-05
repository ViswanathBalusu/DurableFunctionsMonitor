<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!-- The caller renders the buttons: every dialog in the mockups names its own actions. -->
<div bind:this={ref} data-slot="dialog-footer" class={cn('foot', className)} {...restProps}>
  {@render children?.()}
</div>
