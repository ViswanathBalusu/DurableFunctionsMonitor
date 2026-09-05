<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export interface KvRow {
    /** The term. */
    k: string;
    /** The value: a string, or a snippet when it needs markup (a chip, a link). */
    v: string | Snippet;
    /** Monospace value, for numbers and identifiers. */
    mono?: boolean;
    /** The third column of the three-column variant (ScreenOverview.dc.html L92). */
    extra?: string | Snippet;
  }
</script>

<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
    rows: KvRow[];
    /**
     * Two columns by default (term, value). Three adds the trailing column the storage and overview
     * panels use for a chip: `grid-template-columns:auto 1fr auto`.
     */
    columns?: 2 | 3;
    class?: string;
  }

  let { rows, columns = 2, class: className, style, ...rest }: Props = $props();

  const gridStyle = $derived(
    columns === 3 ? `grid-template-columns:auto 1fr auto;${style ?? ''}` : (style as string | undefined),
  );
</script>

<dl class={cn('kv', className)} style={gridStyle} {...rest}>
  {#each rows as row (row.k)}
    <dt>{row.k}</dt>
    <dd class={row.mono ? 'mono' : undefined}>
      {#if typeof row.v === 'string'}{row.v}{:else}{@render row.v()}{/if}
    </dd>
    {#if columns === 3}
      <dd>
        {#if typeof row.extra === 'string'}{row.extra}{:else if row.extra}{@render row.extra()}{/if}
      </dd>
    {/if}
  {/each}
</dl>
