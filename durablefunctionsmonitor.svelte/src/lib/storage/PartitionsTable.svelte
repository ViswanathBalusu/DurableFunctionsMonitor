<script lang="ts" module>
  /** `durablefunctionshub-control-00` is the queue's name; the partition is the tail of it (L61). */
  export function partitionName(name: string): string {
    const control = name.lastIndexOf('control-');

    return control === -1 ? name : name.slice(control);
  }

  /**
   * Where the ownership on screen was read from (ScreenStorage.dc.html L67). The partitions table is
   * what a current hub keeps leases in; older ones keep them in blobs, and a hub that has neither has
   * no ownership to report - which the rows already show one by one.
   */
  export function ownershipNote(source: 'table' | 'lease-blob' | 'none', table: string | null): string {
    if (source === 'lease-blob') {
      return 'Ownership from the lease blobs.';
    }

    if (source === 'none') {
      return 'Ownership is in neither the partitions table nor the lease blobs of this hub.';
    }

    return `Ownership from the ${table ?? 'partitions'} table; lease blobs are the fallback on older hubs.`;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import { fmtDateTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { Storage } from '$lib/state/storage.svelte';

  interface Props {
    storage: Storage;
  }

  let { storage }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  const note = $derived(ownershipNote(storage.partitionSource, storage.tables?.partitions ?? null));
</script>

<!-- ScreenStorage.dc.html L58-L68: which worker holds which control queue, and since when. -->
<div class="tbl-wrap keep">
  <table class="tbl" aria-label="Partitions">
    <thead>
      <tr>
        <th>partition</th>
        <th>owner</th>
        <th>owned since</th>
        <th>draining</th>
      </tr>
    </thead>
    <tbody>
      {#each storage.partitions as partition (partition.name)}
        <tr>
          <td class="mono">{partitionName(partition.name)}</td>
          <td class="mono">{partition.owner ?? '—'}</td>
          <td class="mono">{partition.ownedSince ? fmtDateTime(partition.ownedSince, showTimeAs) : '—'}</td>
          <td>
            {#if partition.isDraining === null}
              <span class="muted">—</span>
            {:else if partition.isDraining}
              <span class="chip st-suspended sm">yes → {partition.nextOwner ?? 'another worker'}</span>
            {:else}
              <span class="chip sm">no</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="tfoot">
    <span class="meta">{note}</span>
    <Button variant="ghost" size="sm" onclick={() => app.router.navigate({ name: 'overview', hub: app.hub })}>
      Backlog on Overview
    </Button>
  </div>
</div>
