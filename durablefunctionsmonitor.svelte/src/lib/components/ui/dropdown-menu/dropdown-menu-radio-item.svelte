<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import type { Snippet } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    value,
    children: childrenProp,
    ...restProps
  }: WithoutChildrenOrChild<DropdownMenuPrimitive.RadioItemProps> & {
    children?: Snippet;
  } = $props();
</script>

<DropdownMenuPrimitive.RadioItem
  bind:ref
  {value}
  data-slot="dropdown-menu-radio-item"
  class={cn('mi', className)}
  {...restProps}
>
  {#snippet children({ checked })}
    <!-- The chosen row is `.mi.active` (dfm-ui.css L232); no bullet glyph. -->
    <span class={checked ? 'active' : undefined}>
      {@render childrenProp?.()}
    </span>
  {/snippet}
</DropdownMenuPrimitive.RadioItem>
