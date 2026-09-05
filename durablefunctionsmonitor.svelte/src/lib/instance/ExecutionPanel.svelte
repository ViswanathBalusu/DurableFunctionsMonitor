<script lang="ts">
  import type { Snippet } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import { fmtBytes } from '$lib/format/bytes';
  import type { InstanceState } from '$lib/state/instance.svelte';

  interface Props {
    instance: InstanceState;
    /** Rendered above the Execution heading (E8's Children panel). */
    children?: Snippet;
  }

  let { instance, children }: Props = $props();

  /**
   * What `/spans` reports about this execution. Every one of these is an em dash until it answers:
   * an execution id nobody has asked for is not the same as one that is not there.
   */
  const spans = $derived(instance.spans.response);

  const tags = $derived(Object.entries(instance.details?.tags ?? {}));

  /** `31 rows`, and `31 rows · 18.2 KB` where the provider also measures what they weigh. */
  const history = $derived.by(() => {
    const counted = spans
      ? `${spans.historyRows} rows`
      : `${instance.history.rows.length}${instance.history.hasMore ? '+' : ''} rows`;

    const bytes = spans?.historyBytes ?? null;

    return bytes === null ? counted : `${counted} · ${fmtBytes(bytes)}`;
  });

  const rows = $derived.by<KvRow[]>(() => {
    const list: KvRow[] = [
      { k: 'executionId', v: spans?.executionId ?? '—', mono: true },
      { k: 'generation', v: spans == null || spans.generation === null ? '—' : String(spans.generation), mono: true },
      { k: 'history', v: history, mono: true },
      { k: 'large blobs', v: spans?.largeMessageBlobs?.toString() ?? '—', mono: true },
    ];

    // Tags are absent far more often than they are empty, so the row is not drawn without them
    if (tags.length > 0) {
      list.push({ k: 'tags', v: tagCells });
    }

    return list;
  });
</script>

{#snippet tagCells()}
  {#each tags as [key, value] (key)}
    <Chip size="sm" style="margin-right:6px">{key}:{value}</Chip>
  {/each}
{/snippet}

<!-- ScreenInstance.dc.html L77-L84: what this execution is, under the children it started. -->
<div class="panel">
  {@render children?.()}

  <div class="panel-h" style={children ? 'margin-top:14px' : undefined}>
    <h3>Execution</h3>
  </div>

  <Kv {rows} />
</div>
