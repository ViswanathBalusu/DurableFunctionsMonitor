<script lang="ts">
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLTableAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    wrapperClass,
    children,
    ...restProps
  }: WithElementRef<HTMLTableAttributes> & { wrapperClass?: string } = $props();
</script>

<!-- `.tbl-wrap` scrolls, `.tbl` is the table: two elements, two classes (dfm-ui.css L151-L153). -->
<div data-slot="table-container" class={cn('tbl-wrap', wrapperClass)}>
  <table bind:this={ref} data-slot="table" class={cn('tbl', className)} {...restProps}>
    {@render children?.()}
  </table>
</div>
