<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let {
    ref = $bindable(null),
    class: className,
    heading,
    children,
    ...restProps
  }: CommandPrimitive.GroupProps & { heading?: Snippet | string } = $props();
</script>

<CommandPrimitive.Group bind:ref data-slot="command-group" class={className} {...restProps}>
  {#if heading}
    <CommandPrimitive.GroupHeading class="grp">
      {#if typeof heading === 'string'}
        {heading}
      {:else}
        {@render heading?.()}
      {/if}
    </CommandPrimitive.GroupHeading>
  {/if}
  <CommandPrimitive.GroupItems>
    {@render children?.()}
  </CommandPrimitive.GroupItems>
</CommandPrimitive.Group>
