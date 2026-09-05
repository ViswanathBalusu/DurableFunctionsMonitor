<script lang="ts">
  import type { Snippet } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import { fmtBytes } from '$lib/format/bytes';
  import type { InstanceState } from '$lib/state/instance.svelte';

  interface Props {
    instance: InstanceState;
    /**
     * What `/spans` reports about this execution (E8). Every one of these is an em dash until it
     * does: an execution id nobody has asked for is not the same as one that is not there.
     */
    executionId?: string | null;
    generation?: number | null;
    historyBytes?: number | null;
    largeMessageBlobs?: number | null;
    /** The rows `/spans` counted; until E8 it is what the History tab has loaded. */
    historyRows?: number | null;
    /** Rendered above the Execution heading (E8's Children panel). */
    children?: Snippet;
  }

  let {
    instance,
    executionId = null,
    generation = null,
    historyBytes = null,
    largeMessageBlobs = null,
    historyRows = null,
    children,
  }: Props = $props();

  const tags = $derived(Object.entries(instance.details?.tags ?? {}));

  /** `31 rows`, `31 rows · 18.2 KB` once E8 knows the size. */
  const history = $derived.by(() => {
    const rows = historyRows ?? instance.history.rows.length;
    const counted = `${rows}${instance.history.hasMore && historyRows === null ? '+' : ''} rows`;

    return historyBytes === null ? counted : `${counted} · ${fmtBytes(historyBytes)}`;
  });

  const rows = $derived.by<KvRow[]>(() => {
    const list: KvRow[] = [
      { k: 'executionId', v: executionId ?? '—', mono: true },
      { k: 'generation', v: generation === null ? '—' : String(generation), mono: true },
      { k: 'history', v: history, mono: true },
      { k: 'large blobs', v: largeMessageBlobs === null ? '—' : String(largeMessageBlobs), mono: true },
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
