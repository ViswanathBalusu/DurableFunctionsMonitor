<script lang="ts">
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn, type WithoutChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChild<SelectPrimitive.TriggerProps> = $props();
</script>

<!-- No chevron: the `.sel` wrapper around this trigger draws it with `::after`. -->
<SelectPrimitive.Trigger bind:ref data-slot="select-trigger" class={cn('input', className)} {...restProps}>
  {@render children?.()}
</SelectPrimitive.Trigger>
