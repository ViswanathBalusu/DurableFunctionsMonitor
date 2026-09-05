<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
    children?: Snippet;
    class?: string;
  }

  let { children, class: className, ...rest }: Props = $props();
</script>

<!-- Every screen's outermost element: a single-column grid with the 24px rhythm (dfm-ui.css L171). -->
<section class={cn('page', className)} {...rest}>
  {@render children?.()}
</section>
