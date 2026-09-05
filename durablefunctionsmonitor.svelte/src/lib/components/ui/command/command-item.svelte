<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let { ref = $bindable(null), class: className, children, ...restProps }: CommandPrimitive.ItemProps = $props();
</script>

<!-- The active row is `.prow.sel` (dfm-ui.css L268); nothing is appended to the row itself. -->
<CommandPrimitive.Item bind:ref data-slot="command-item" class={cn('prow', className)} {...restProps}>
  {@render children?.()}
</CommandPrimitive.Item>
