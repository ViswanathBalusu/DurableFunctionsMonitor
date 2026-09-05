<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
    title: string;
    /** The controls that sit after the title (ScreenOverview.dc.html L17-L22). */
    children?: Snippet;
    class?: string;
  }

  let { title, children, class: className, ...rest }: Props = $props();
</script>

<div class={cn('ptitle', className)} {...rest}>
  <h1 class="display">{title}</h1>
  {@render children?.()}
</div>
