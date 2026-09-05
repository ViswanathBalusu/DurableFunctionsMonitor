<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    level = 3,
    ...restProps
  }: DialogPrimitive.TitleProps & { level?: 2 | 3 } = $props();
</script>

<!-- The mockups head every dialog with an `<h3 class="display">` (ScreenInstances.dc.html L146). -->
<DialogPrimitive.Title bind:ref data-slot="dialog-title" class={cn('display', className)} {...restProps}>
  {#snippet child({ props })}
    {#if level === 2}
      <h2 {...props}>{@render restProps.children?.()}</h2>
    {:else}
      <h3 {...props}>{@render restProps.children?.()}</h3>
    {/if}
  {/snippet}
</DialogPrimitive.Title>
