<script lang="ts">
  import type { BatchResultItem } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import type { ColumnDef } from '$lib/components/table/columns';
  import { fmtInt } from '$lib/format/number';

  interface Props {
    /** Bindable. */
    open?: boolean;
    /** What was run, in the words of its confirm button. */
    title: string;
    results: BatchResultItem[];
  }

  let { open = $bindable(false), title, results }: Props = $props();

  const okCount = $derived(results.filter((result) => result.ok).length);

  /** Failures first: they are why this dialog opened at all. */
  const rows = $derived([...results].sort((a, b) => Number(a.ok) - Number(b.ok)));

  const columns: ColumnDef<BatchResultItem>[] = [
    { id: 'instanceId', header: 'instanceId', mono: true, cell: idCell },
    { id: 'status', header: 'status', mono: true, cell: statusCell },
    { id: 'message', header: 'message', cell: messageCell },
  ];
</script>

{#snippet idCell(row: BatchResultItem)}
  {row.instanceId}
{/snippet}

{#snippet statusCell(row: BatchResultItem)}
  <Chip size="sm" class={row.ok ? 'st-completed' : 'st-failed'}>{row.status}</Chip>
{/snippet}

{#snippet messageCell(row: BatchResultItem)}
  {row.message ?? ''}
{/snippet}

<!-- What every id answered, because a bulk action that half worked has to say which half. -->
<Dialog bind:open {title} width={720}>
  <p class="meta">{fmtInt(okCount)} ok, {fmtInt(results.length - okCount)} failed</p>

  <DataTable {columns} {rows} rowKey={(row) => row.instanceId} keep flat ariaLabel="Bulk result" />

  {#snippet footer()}
    <Button variant="primary" onclick={() => (open = false)}>Close</Button>
  {/snippet}
</Dialog>
