<script lang="ts">
  import { Switch as SwitchPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    checked = $bindable(false),
    ...restProps
  }: WithoutChildrenOrChild<SwitchPrimitive.RootProps> = $props();
</script>

<!-- The knob is `.switch::after`; a Thumb element would draw a second one on top of it. -->
<SwitchPrimitive.Root
  bind:ref
  bind:checked
  data-slot="switch"
  class={cn('switch', checked ? 'on' : '', className)}
  {...restProps}
/>
