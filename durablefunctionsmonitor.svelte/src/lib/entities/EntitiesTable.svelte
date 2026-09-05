<script lang="ts" module>
  /** What the footer says the state column is (ScreenEntities.dc.html L54). */
  export const STATE_NOTE = 'state is the first line of the entity row, full state in the peek panel';

  /**
   * ...and what it says instead on a backend without the entities endpoint: `/orchestrations` lists
   * entities with their state left out, so there is no first line to show.
   */
  export const NO_STATE_NOTE = 'this backend lists entities without their state; /entities is what parses it';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { EntityRow } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import StatusCell from '$lib/components/table/cells/StatusCell.svelte';
  import type { ColumnDef, SortState } from '$lib/components/table/columns';
  import { fmtInt } from '$lib/format/number';
  import { fmtDateTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { Entities } from '$lib/state/entities.svelte';

  interface Props {
    entities: Entities;
  }

  let { entities }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  /** The backend hands the rows over in its own order; the screen is the one that dates them. */
  const sort: SortState = { id: 'lastUpdatedTime', dir: 'desc' };

  const columns = $derived<ColumnDef<EntityRow>[]>([
    { id: 'entityName', header: 'entity name', cell: nameCell },
    { id: 'key', header: 'key', mono: true, cell: keyCell },
    { id: 'state', header: 'state', mono: true, trunc: true, cell: stateCell },
    { id: 'lastUpdatedTime', header: 'lastUpdatedTime', mono: true, cell: updatedCell },
    { id: 'runtimeStatus', header: 'status', cell: statusCell },
    { id: 'actions', header: 'actions', align: 'right', cell: actionsCell },
  ]);

  const total = $derived(entities.total);

  function peek(row: EntityRow): void {
    app.peek.open({
      id: row.instanceId,
      name: row.entityName,
      kind: 'DurableEntity',
      status: row.runtimeStatus,
      // An entity listing carries no created time, and the panel says so rather than guessing one
      created: '',
      updated: row.lastUpdatedTime,
      duration: null,
      state: row.state,
    });
  }

  /** What the signal and purge dialogs need to know about the entity (E5's ActionTarget). */
  function target(row: EntityRow) {
    return { id: row.instanceId, name: row.entityName, status: row.runtimeStatus, isEntity: true, key: row.key };
  }
</script>

{#snippet nameCell(row: EntityRow)}
  <span style="font-weight:700">{row.entityName}</span>
  <Chip size="sm" class="kind-entity" style="margin-left:6px">entity</Chip>
{/snippet}

{#snippet keyCell(row: EntityRow)}
  <LinkButton mono stopPropagation onclick={() => peek(row)}>{row.key}</LinkButton>
{/snippet}

{#snippet stateCell(row: EntityRow)}
  {#if row.stateError}
    <span class="muted" title={row.stateError}>could not be read</span>
  {:else if row.stateSummary}
    <LinkButton mono stopPropagation onclick={() => peek(row)}>{row.stateSummary}</LinkButton>
  {:else}
    <span class="muted">—</span>
  {/if}
{/snippet}

{#snippet updatedCell(row: EntityRow)}
  {fmtDateTime(row.lastUpdatedTime, showTimeAs)}
{/snippet}

{#snippet statusCell(row: EntityRow)}
  <StatusCell status={row.runtimeStatus} />
{/snippet}

{#snippet actionsCell(row: EntityRow)}
  <span class="row" style="justify-content:flex-end;gap:8px;display:inline-flex">
    <Button
      size="sm"
      disabled={app.readOnly}
      onclick={(event) => {
        event.stopPropagation();
        app.actions.open('signal', target(row));
      }}
    >
      Signal
    </Button>
    <Button
      size="sm"
      variant="destructive"
      disabled={app.readOnly}
      onclick={(event) => {
        event.stopPropagation();
        app.actions.open('purge', target(row));
      }}
    >
      Purge
    </Button>
  </span>
{/snippet}

<!-- ScreenEntities.dc.html L37-L55: one row per entity, its state as one line, the peek for the rest. -->
<DataTable
  {columns}
  rows={entities.rows}
  rowKey={(row) => row.instanceId}
  rowStatus={(row) => row.runtimeStatus}
  {sort}
  ariaLabel="Entities"
  onRowClick={peek}
>
  {#snippet footer()}
    <span class="meta">
      Showing {fmtInt(entities.rows.length)}{total === null ? '' : ` of ${fmtInt(total)}`} ·
      {entities.supported ? STATE_NOTE : NO_STATE_NOTE}
    </span>

    {#if entities.hasMore}
      <Button onclick={() => void entities.loadMore()} disabled={entities.loading}>Load more</Button>
    {/if}
  {/snippet}
</DataTable>
