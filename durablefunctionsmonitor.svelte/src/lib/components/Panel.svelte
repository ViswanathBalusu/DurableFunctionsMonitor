<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
    title?: string;
    /** Rendered at the right end of the panel header - counts, a link, a small select. */
    meta?: Snippet;
    /** Heading level: a panel inside a section is an h3, a top-level one an h2. */
    level?: 2 | 3;
    children?: Snippet;
    class?: string;
  }

  let { title, meta, level = 2, children, class: className, ...rest }: Props = $props();
</script>

<div class={cn('panel', className)} {...rest}>
  {#if title || meta}
    <div class="panel-h">
      {#if title}
        {#if level === 2}
          <h2>{title}</h2>
        {:else}
          <h3>{title}</h3>
        {/if}
      {/if}
      {#if meta}
        <span class="grow"></span>
        {@render meta()}
      {/if}
    </div>
  {/if}
  {@render children?.()}
</div>
