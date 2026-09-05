<script lang="ts" module>
  import type { AuditRow } from '$lib/api/types';

  /** `audit · last 4 in range` - what the panel is showing, and where it came from. */
  export function activityMeta(rows: AuditRow[]): string {
    return `audit · last ${rows.length} in range`;
  }

  /** What the outcome chip says: `ok`, or the status code that was not ok. */
  export function outcomeLabel(row: AuditRow): string {
    return row.outcome === 'ok' ? 'ok' : String(row.status);
  }

  /** One row, identified by what makes it that row rather than another. */
  export function rowKey(row: AuditRow): string {
    return `${row.at}|${row.operation}|${row.instanceId ?? ''}`;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import type { ColumnDef } from '$lib/components/table/columns';
  import { fmtTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    rows: AuditRow[];
  }

  let { rows }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const columns = $derived<ColumnDef<AuditRow>[]>([
    { id: 'time', header: 'time', mono: true, accessor: (row) => fmtTime(row.at, app.prefs.showTimeAs) },
    { id: 'user', header: 'user', accessor: (row) => row.user },
    { id: 'operation', header: 'operation', accessor: (row) => row.operation },
    { id: 'instance', header: 'instance', mono: true, cell: instanceCell },
    { id: 'outcome', header: 'outcome', cell: outcomeCell },
  ]);

  function open(instanceId: string): void {
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId });
  }
</script>

{#snippet instanceCell(row: AuditRow)}
  {#if row.instanceId}
    <LinkButton mono onclick={() => open(row.instanceId as string)}>{row.instanceId}</LinkButton>
  {:else}
    <!-- A hub-wide operation (a purge, a clean) belongs to no instance -->
    —
  {/if}
{/snippet}

{#snippet outcomeCell(row: AuditRow)}
  <Chip size="sm" class={row.outcome === 'ok' ? 'st-completed' : 'st-failed'}>{outcomeLabel(row)}</Chip>
{/snippet}

<!-- ScreenOverview.dc.html L102-L115: who did what to this hub, most recently. -->
<Panel title="Recent activity">
  {#snippet meta()}
    <span class="fine muted">{activityMeta(rows)}</span>
  {/snippet}

  <DataTable {columns} {rows} {rowKey} flat hideHeader ariaLabel="Recent activity" />

  <p class="meta" style="margin-top:10px">
    <LinkButton onclick={() => app.router.navigate({ name: 'activity', hub: app.hub })}>Activity</LinkButton>
  </p>
</Panel>
