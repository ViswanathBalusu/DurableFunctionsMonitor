<script lang="ts" module>
  import type { StatsByName } from '$lib/api/types';
  import type { SortState } from '$lib/components/table/columns';

  /** What the panel header says the numbers are: whose they are, and what they were taken over. */
  export const TOP_META = 'p50 and p95 over terminal instances';

  /** The chip after the name of an orchestrator that runs inside another one. */
  export const SUB_ORCHESTRATOR = 'sub-orchestrator';

  /** The order the panel opens in (ScreenOverview.dc.html L79). */
  export const DEFAULT_SORT: SortState = { id: 'started', dir: 'desc' };

  /** What each column sorts on; a null is a value the backend does not have, not a zero. */
  const SORT_VALUES: Readonly<Record<string, (row: StatsByName) => string | number | null>> = {
    name: (row) => row.name,
    started: (row) => row.started,
    completed: (row) => row.completed,
    failed: (row) => row.failed,
    rate: (row) => row.failureRate,
    p50: (row) => row.p50Ms,
    p95: (row) => row.p95Ms,
    last: (row) => (row.lastFailedAt ? Date.parse(row.lastFailedAt) : null),
  };

  /**
   * Sorting is this panel's own: `/stats` returns every orchestrator of the range at once, so there
   * is no page to ask the backend to reorder. Rows the backend has no value for sort last whichever
   * way the column points - an orchestrator that never failed does not have the oldest last failure.
   */
  export function sortRows(rows: StatsByName[], sort: SortState | null): StatsByName[] {
    const value = sort ? SORT_VALUES[sort.id] : undefined;

    if (!sort || !value) {
      return rows;
    }

    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);

      if (left === right) {
        return a.name.localeCompare(b.name);
      }
      if (left === null) {
        return 1;
      }
      if (right === null) {
        return -1;
      }

      const order = typeof left === 'string' ? left.localeCompare(String(right)) : left - Number(right);

      return sort.dir === 'asc' ? order : -order;
    });
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { nextSort, type ColumnDef } from '$lib/components/table/columns';
  import { toQuery } from '$lib/filters/time-range';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtInt, fmtPct } from '$lib/format/number';
  import { fmtTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    rows: StatsByName[];
    /** The names the function map classifies as running inside another orchestrator. */
    subOrchestrators?: string[];
  }

  let { rows, subOrchestrators = [] }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let sort = $state<SortState | null>(DEFAULT_SORT);

  const sorted = $derived(sortRows(rows, sort));

  const rangeQuery = $derived(
    Object.fromEntries(Object.entries(toQuery(app.timeRange)).filter(([, value]) => value !== null)),
  );

  const columns = $derived<ColumnDef<StatsByName>[]>([
    // Sentence case, and every figure right-aligned so the columns compare digit by digit
    { id: 'name', header: 'Name', sortable: true, cell: nameCell },
    {
      id: 'started',
      header: 'Started',
      mono: true,
      align: 'right',
      sortable: true,
      accessor: (row) => fmtInt(row.started),
    },
    {
      id: 'completed',
      header: 'Completed',
      mono: true,
      align: 'right',
      sortable: true,
      accessor: (row) => fmtInt(row.completed),
    },
    { id: 'failed', header: 'Failed', mono: true, align: 'right', sortable: true, cell: failedCell },
    { id: 'rate', header: 'Failure rate', mono: true, align: 'right', sortable: true, cell: rateCell },
    { id: 'p50', header: 'p50', mono: true, align: 'right', sortable: true, accessor: (row) => fmtDuration(row.p50Ms) },
    { id: 'p95', header: 'p95', mono: true, align: 'right', sortable: true, accessor: (row) => fmtDuration(row.p95Ms) },
    {
      id: 'last',
      header: 'Last failure',
      mono: true,
      align: 'right',
      sortable: true,
      accessor: (row) => (row.lastFailedAt ? fmtTime(row.lastFailedAt, app.prefs.showTimeAs) : '—'),
    },
  ]);

  function open(name: string): void {
    app.router.navigate({ name: 'instances', hub: app.hub }, { query: { ...rangeQuery, name } });
  }
</script>

<!-- A failure count and a failure rate that are not zero say so (dfm-ext.css `.fail-num`), and the
     rate draws its share as a bar: what failed is the loudest figure in the row -->
{#snippet failedCell(row: StatsByName)}
  <span class={row.failed > 0 ? 'fail-num' : ''}>{fmtInt(row.failed)}</span>
{/snippet}

{#snippet rateCell(row: StatsByName)}
  {#if row.failed > 0}
    <span class="rate-bar" aria-hidden="true">
      <i style={`width:${Math.min(100, Math.max(0, row.failureRate * 100))}%`}></i>
    </span>
  {/if}
  <span class={row.failed > 0 ? 'fail-num' : ''}>{fmtPct(row.failureRate)}</span>
{/snippet}

{#snippet nameCell(row: StatsByName)}
  <LinkButton onclick={() => open(row.name)}>{row.name}</LinkButton>
  {#if subOrchestrators.includes(row.name)}
    <Chip size="sm" style="margin-left:8px">{SUB_ORCHESTRATOR}</Chip>
  {/if}
{/snippet}

<!-- ScreenOverview.dc.html L75-L88: every orchestrator of the range, and how it went. -->
<Panel title="Top orchestrators">
  {#snippet meta()}
    <span class="fine muted">{TOP_META}</span>
  {/snippet}

  <DataTable
    {columns}
    rows={sorted}
    rowKey={(row) => row.name}
    {sort}
    onSort={(id) => (sort = nextSort(sort, id))}
    flat
    keep
    ariaLabel="Top orchestrators"
  />
</Panel>
