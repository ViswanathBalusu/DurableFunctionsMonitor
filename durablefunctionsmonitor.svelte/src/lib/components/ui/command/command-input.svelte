<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';

  let {
    ref = $bindable(null),
    class: className,
    value = $bindable(''),
    ...restProps
  }: CommandPrimitive.InputProps = $props();
</script>

<!-- `.palette > input` is styled by the child selector, so this stays a bare input. -->
<CommandPrimitive.Input bind:ref bind:value data-slot="command-input" class={className} {...restProps} />
