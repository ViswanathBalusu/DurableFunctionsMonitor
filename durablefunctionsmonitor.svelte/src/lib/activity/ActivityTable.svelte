<script lang="ts" module>
  /** What the footer says about the order the rows are in (ScreenActivity.dc.html L43). */
  export const ORDER_NOTE = 'PartitionKey yyyyMMdd · RowKey reverse ticks · newest first';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { AuditRow } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import type { ColumnDef, SortState } from '$lib/components/table/columns';
  import { auditRowKey, outcomeLabel } from '$lib/activity/audit';
  import { fmtDateTime } from '$lib/format/time';
  import type { Activity } from '$lib/state/activity.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    activity: Activity;
  }

  let { activity }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  /** The store hands the rows over newest first; the header says so rather than offering to re-sort. */
  const sort: SortState = { id: 'time', dir: 'desc' };

  const columns = $derived<ColumnDef<AuditRow>[]>([
    { id: 'time', header: 'time', mono: true, cell: timeCell },
    { id: 'user', header: 'user', accessor: (row) => row.user },
    { id: 'operation', header: 'operation', cell: operationCell },
    { id: 'instance', header: 'instance', mono: true, cell: instanceCell },
    { id: 'outcome', header: 'outcome', cell: outcomeCell },
    { id: 'details', header: 'details', trunc: true, cell: detailsCell },
  ]);

  function open(instanceId: string): void {
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId });
  }
</script>

{#snippet timeCell(row: AuditRow)}
  {fmtDateTime(row.at, showTimeAs)}
{/snippet}

{#snippet operationCell(row: AuditRow)}
  <span style="font-weight:700">{row.operation}</span>
  {#if row.kind === 'Dangerous'}
    <!-- A label, not a control: the tag says what the operation was, and does nothing (L40) -->
    <span class="tag" style="cursor:default">dangerous</span>
  {/if}
{/snippet}

{#snippet instanceCell(row: AuditRow)}
  {#if row.instanceId}
    <LinkButton mono onclick={() => open(row.instanceId as string)}>{row.instanceId}</LinkButton>
  {:else}
    <!-- A hub-wide operation (a purge of history, a clean) belongs to no instance -->
    <span class="muted">—</span>
  {/if}
{/snippet}

{#snippet outcomeCell(row: AuditRow)}
  <Chip size="sm" class={row.outcome === 'ok' ? 'st-completed' : 'st-failed'}>{outcomeLabel(row)}</Chip>
{/snippet}

{#snippet detailsCell(row: AuditRow)}
  {#if row.message}
    <!-- The cell truncates; the whole message is the title, which is all the room a table has -->
    <span title={row.message}>{row.message}</span>
  {:else}
    <span class="muted">—</span>
  {/if}
{/snippet}

<!-- ScreenActivity.dc.html L27-L45: one row per audited call, newest first, and the way to more. -->
<DataTable
  {columns}
  rows={activity.rows}
  rowKey={auditRowKey}
  rowStatus={(row) => (row.outcome === 'ok' ? 'Completed' : 'Failed')}
  {sort}
  ariaLabel="Activity"
>
  {#snippet footer()}
    <span class="meta">{ORDER_NOTE}</span>

    {#if activity.hasMore}
      <Button onclick={() => void activity.loadMore()} disabled={activity.loading}>Load more</Button>
    {/if}
  {/snippet}
</DataTable>
