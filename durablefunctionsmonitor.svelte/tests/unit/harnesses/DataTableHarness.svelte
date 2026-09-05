<script lang="ts">
  // Test-only wrapper: DataTable takes cell and footer snippets and a bindable selection.
  import DataTable from '$lib/components/table/DataTable.svelte';
  import JsonCell from '$lib/components/table/cells/JsonCell.svelte';
  import LinkCell from '$lib/components/table/cells/LinkCell.svelte';
  import StatusCell from '$lib/components/table/cells/StatusCell.svelte';
  import type { ColumnDef, SortState } from '$lib/components/table/columns';

  interface Row {
    instanceId: string;
    name: string;
    runtimeStatus: string;
    customStatus?: unknown;
  }

  let {
    rows,
    selectable = false,
    hiddenColumns = [],
    sort = null,
    keep = false,
    flat = false,
    hideHeader = false,
    highlightKey = null,
    onRowClick,
    onRowEnter,
    onSort,
    onOpen,
    onOpenJson,
  }: {
    rows: Row[];
    selectable?: boolean;
    hiddenColumns?: string[];
    sort?: SortState | null;
    keep?: boolean;
    flat?: boolean;
    hideHeader?: boolean;
    highlightKey?: string | null;
    onRowClick?: (row: Row) => void;
    onRowEnter?: (row: Row) => void;
    onSort?: (id: string) => void;
    onOpen?: (id: string) => void;
    onOpenJson?: (value: unknown, title: string) => void;
  } = $props();

  let selected = $state(new Set<string>());

  const columns: ColumnDef<Row>[] = [
    { id: 'instanceId', header: 'instanceId', mono: true, cell: idCell },
    { id: 'name', header: 'name', accessor: (row) => row.name, sortable: true },
    { id: 'runtimeStatus', header: 'runtimeStatus', cell: statusCell },
    { id: 'customStatus', header: 'customStatus', mono: true, trunc: true, cell: jsonCell },
  ];
</script>

{#snippet idCell(row: Row)}
  <LinkCell text={row.instanceId} onclick={() => onOpen?.(row.instanceId)} />
{/snippet}

{#snippet statusCell(row: Row)}
  <StatusCell status={row.runtimeStatus} />
{/snippet}

{#snippet jsonCell(row: Row)}
  <JsonCell value={row.customStatus} title="customStatus" {onOpenJson} />
{/snippet}

<DataTable
  {columns}
  {rows}
  rowKey={(row) => row.instanceId}
  rowStatus={(row) => row.runtimeStatus}
  {selectable}
  bind:selected
  {hiddenColumns}
  {sort}
  {keep}
  {flat}
  {hideHeader}
  {highlightKey}
  ariaLabel="Instances"
  {onRowClick}
  {onRowEnter}
  {onSort}
>
  {#snippet footer()}
    <span class="meta">Showing {rows.length} of {rows.length}</span>
  {/snippet}
</DataTable>

<span data-testid="selection">{[...selected].join(',')}</span>
