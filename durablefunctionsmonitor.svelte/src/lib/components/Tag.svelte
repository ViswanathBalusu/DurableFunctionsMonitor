<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLButtonAttributes, 'children'> {
    children?: Snippet;
    class?: string;
  }

  let { children, class: className, type = 'button', ...rest }: Props = $props();
</script>

<!-- The history table's "input" tag (ScreenInstance.dc.html L109): a button, because it opens the viewer. -->
<button {type} class={cn('tag', className)} {...rest}>{@render children?.()}</button>
