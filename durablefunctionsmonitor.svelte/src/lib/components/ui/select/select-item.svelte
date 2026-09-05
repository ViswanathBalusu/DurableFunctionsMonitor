<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn, type WithoutChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    value,
    label,
    children: childrenProp,
    ...restProps
  }: WithoutChild<SelectPrimitive.ItemProps> = $props();
</script>

<SelectPrimitive.Item bind:ref {value} data-slot="select-item" class={cn('mi', className)} {...restProps}>
  {#snippet children({ selected, highlighted })}
    <!-- The selected row is marked by `.mi.active`, not by an icon (dfm-ui.css L232). -->
    <span class={selected ? 'active' : undefined}>
      {#if childrenProp}
        {@render childrenProp({ selected, highlighted })}
      {:else}
        {label || value}
      {/if}
    </span>
  {/snippet}
</SelectPrimitive.Item>
