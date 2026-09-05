<script lang="ts" module>
  /** What the footer says about the numbers this table cannot show (ScreenFunctions.dc.html L43). */
  export const ACTIVITY_NOTE =
    'Activity-level numbers need history scans, so they appear only for instances loaded in Instances.';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { StatsByName } from '$lib/api/types';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { nextSort, type ColumnDef, type SortState } from '$lib/components/table/columns';
  import { toQuery } from '$lib/filters/time-range';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtInt, fmtPct } from '$lib/format/number';
  import { fmtTime } from '$lib/format/time';
  import { DEFAULT_SORT, sortRows } from '$lib/overview/TopOrchestrators.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { Functions } from '$lib/state/functions.svelte';

  interface Props {
    functions: Functions;
  }

  let { functions }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let sort = $state<SortState | null>(DEFAULT_SORT);

  const rows = $derived(sortRows(functions.rows, sort));

  const rangeQuery = $derived(
    Object.fromEntries(Object.entries(toQuery(app.timeRange)).filter(([, value]) => value !== null)),
  );

  const columns = $derived<ColumnDef<StatsByName>[]>([
    { id: 'name', header: 'orchestrator', mono: true, sortable: true, cell: nameCell },
    { id: 'started', header: 'started', mono: true, sortable: true, accessor: (row) => fmtInt(row.started) },
    { id: 'completed', header: 'completed', mono: true, sortable: true, accessor: (row) => fmtInt(row.completed) },
    { id: 'failed', header: 'failed', mono: true, sortable: true, accessor: (row) => fmtInt(row.failed) },
    { id: 'rate', header: 'rate', mono: true, sortable: true, accessor: (row) => fmtPct(row.failureRate) },
    { id: 'p50', header: 'p50', mono: true, sortable: true, accessor: (row) => fmtDuration(row.p50Ms) },
    { id: 'p95', header: 'p95', mono: true, sortable: true, accessor: (row) => fmtDuration(row.p95Ms) },
    {
      id: 'last',
      header: 'last failure',
      mono: true,
      sortable: true,
      accessor: (row) => (row.lastFailedAt ? fmtTime(row.lastFailedAt, app.prefs.showTimeAs) : '—'),
    },
  ]);

  function open(name: string): void {
    app.router.navigate({ name: 'instances', hub: app.hub }, { query: { ...rangeQuery, name } });
  }
</script>

{#snippet nameCell(row: StatsByName)}
  <!-- The row selects; the link opens the list, so it has to keep its click to itself -->
  <LinkButton mono stopPropagation onclick={() => open(row.name)}>{row.name}</LinkButton>
{/snippet}

<!-- ScreenFunctions.dc.html L23-L45: every orchestrator the range counted, spined in its node colour. -->
<DataTable
  {columns}
  {rows}
  rowKey={(row) => row.name}
  spineColor="var(--node-orchestrator)"
  {sort}
  onSort={(id) => (sort = nextSort(sort, id))}
  highlightKey={functions.selected}
  onRowClick={(row) => functions.select(row.name)}
  ariaLabel="Orchestrators"
>
  {#snippet footer()}
    <span class="meta">{ACTIVITY_NOTE}</span>
    <span class="fine muted">scanned {fmtInt(functions.scanned)} · {functions.partial ? 'partial' : 'full'}</span>
  {/snippet}
</DataTable>
