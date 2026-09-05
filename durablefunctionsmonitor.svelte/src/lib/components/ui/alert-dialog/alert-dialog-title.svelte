<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let { ref = $bindable(null), class: className, ...restProps }: AlertDialogPrimitive.TitleProps = $props();
</script>

<!-- Same heading as a plain dialog (ScreenInstances.dc.html L146). -->
<AlertDialogPrimitive.Title bind:ref data-slot="alert-dialog-title" class={cn('display', className)} {...restProps}>
  {#snippet child({ props })}
    <h3 {...props}>{@render restProps.children?.()}</h3>
  {/snippet}
</AlertDialogPrimitive.Title>
