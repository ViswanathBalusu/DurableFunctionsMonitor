<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<!-- dfm-ui.css draws the mark with `.box.on::after`, so there is no indicator element and no icon. -->
<CheckboxPrimitive.Root
  bind:ref
  data-slot="checkbox"
  class={cn('box', checked || indeterminate ? 'on' : '', className)}
  bind:checked
  bind:indeterminate
  {...restProps}
/>
