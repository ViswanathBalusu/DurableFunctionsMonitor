<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Command from './command.svelte';
  import type { ComponentProps } from 'svelte';

  let {
    open = $bindable(false),
    ref = $bindable(null),
    value = $bindable(''),
    title = 'Command palette',
    portalProps,
    children,
    ...restProps
  }: ComponentProps<typeof Command> & {
    open?: boolean;
    title?: string;
    portalProps?: ComponentProps<typeof Dialog.Portal>;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Portal {...portalProps}>
    <Dialog.Overlay class="pal" />
    <Dialog.Content class="palette" aria-label={title}>
      <Command bind:value bind:ref {...restProps}>
        {@render children?.()}
      </Command>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
