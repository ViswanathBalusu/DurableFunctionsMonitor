<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    label: string;
    /**
     * The id of the control inside. Given one, the label points at it; without one the label still
     * wraps nothing and the control needs its own aria-label - which is why `for` is a prop and not a
     * generated id: a Field can hold a whole group.
     */
    for?: string;
    children?: Snippet;
    class?: string;
  }

  let { label, for: htmlFor, children, class: className, ...rest }: Props = $props();
</script>

<div class={cn('field', className)} {...rest}>
  <label for={htmlFor}>{label}</label>
  {@render children?.()}
</div>
