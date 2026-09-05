<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';

  export type CommandRootApi = CommandPrimitive.Root;

  let {
    api = $bindable(null),
    ref = $bindable(null),
    value = $bindable(''),
    class: className,
    role,
    children,
    ...restProps
  }: CommandPrimitive.RootProps & {
    api?: CommandRootApi | null;
    children?: Snippet;
    role?: HTMLAttributes<HTMLDivElement>['role'];
  } = $props();
</script>

<!--
  Rendered through the `child` snippet so that the caller's `role` survives: bits-ui labels the root
  `application`, and the palette of the mockups is a dialog (DFM App.dc.html L200). Everything else
  bits-ui puts on the element - its id, its data attributes, its handlers - is kept.
-->
<CommandPrimitive.Root bind:this={api} bind:value bind:ref {...restProps}>
  {#snippet child({ props })}
    <div
      {...props}
      data-slot="command"
      class={cn('palette', className)}
      role={role ?? (props.role as HTMLAttributes<HTMLDivElement>['role'])}
    >
      {@render children?.()}
    </div>
  {/snippet}
</CommandPrimitive.Root>
