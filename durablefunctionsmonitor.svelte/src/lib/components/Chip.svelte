<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    size?: 'md' | 'sm';
    children?: Snippet;
    class?: string;
  }

  let { size = 'md', children, class: className, ...rest }: Props = $props();
</script>

<span class={cn('chip', size === 'sm' ? 'sm' : '', className)} {...rest}>
  {@render children?.()}
</span>
