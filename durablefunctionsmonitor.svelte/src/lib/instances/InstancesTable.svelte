<script lang="ts">
  import { getContext } from 'svelte';
  import type { OrchestrationStatus } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import JsonCell from '$lib/components/table/cells/JsonCell.svelte';
  import StatusCell from '$lib/components/table/cells/StatusCell.svelte';
  import { nextSort, type ColumnDef, type SortState } from '$lib/components/table/columns';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtInt } from '$lib/format/number';
  import { fmtDateTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { Instances } from '$lib/state/instances.svelte';
  import { baseColumns, displayName, durationOf, toPeekItem } from './columns';

  interface Props {
    instances: Instances;
    /** Opens the full JSON viewer for a cell (E4-S8); without it the preview is not a link. */
    onOpenJson?: (value: unknown, title: string) => void;
  }

  let { instances, onOpenJson }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  const sort = $derived<SortState>({ id: instances.orderBy, dir: instances.dir });

  const hiddenCount = $derived(instances.effectiveHiddenColumns.length);

  const columns = $derived<ColumnDef<OrchestrationStatus>[]>(
    baseColumns().map((column) => ({
      ...column,
      cell:
        column.id === 'instanceId'
          ? instanceIdCell
          : column.id === 'name'
            ? nameCell
            : column.id === 'createdTime'
              ? createdCell
              : column.id === 'lastUpdatedTime'
                ? updatedCell
                : column.id === 'runtimeStatus'
                  ? statusCell
                  : column.id === 'duration'
                    ? durationCell
                    : column.id === 'customStatus'
                      ? customStatusCell
                      : column.id === 'input'
                        ? inputCell
                        : column.id === 'output'
                          ? outputCell
                          : column.id === 'parentInstanceId'
                            ? parentCell
                            : lastEventCell,
    })),
  );

  function href(instanceId: string): string {
    return app.router.href({ name: 'instance', hub: app.hub, instanceId });
  }

  function open(row: OrchestrationStatus, event: MouseEvent): void {
    // Ctrl/⌘ opens a second window, which is how the mockups let you compare two instances
    if (event.ctrlKey || event.metaKey) {
      app.client.host.openInNewWindow(row.instanceId);
      return;
    }

    app.router.navigate({ name: 'instance', hub: app.hub, instanceId: row.instanceId });
  }

  function sortBy(id: string): void {
    const next = nextSort(sort, id);

    // Unsorted is not something the backend can be asked for; falling back to the default order is
    instances.setOrder(next?.id ?? 'createdTime', next?.dir ?? 'desc');
  }
</script>

{#snippet instanceIdCell(row: OrchestrationStatus)}
  <LinkButton mono stopPropagation href={href(row.instanceId)} onclick={(event) => open(row, event)}>
    {row.instanceId}
  </LinkButton>
{/snippet}

{#snippet nameCell(row: OrchestrationStatus)}
  {displayName(row)}
  {#if row.entityType === 'DurableEntity'}
    <Chip size="sm" class="kind-entity" style="margin-left:6px">entity</Chip>
  {/if}
{/snippet}

{#snippet createdCell(row: OrchestrationStatus)}
  {fmtDateTime(row.createdTime, showTimeAs)}
{/snippet}

{#snippet updatedCell(row: OrchestrationStatus)}
  {fmtDateTime(row.lastUpdatedTime, showTimeAs)}
{/snippet}

{#snippet statusCell(row: OrchestrationStatus)}
  <StatusCell status={row.runtimeStatus} />
{/snippet}

{#snippet durationCell(row: OrchestrationStatus)}
  {fmtDuration(durationOf(row))}
{/snippet}

{#snippet customStatusCell(row: OrchestrationStatus)}
  <JsonCell value={row.customStatus} title="customStatus" {onOpenJson} />
{/snippet}

{#snippet inputCell(row: OrchestrationStatus)}
  <JsonCell value={row.input} title="input" {onOpenJson} />
{/snippet}

{#snippet outputCell(row: OrchestrationStatus)}
  <JsonCell value={row.output} title="output" {onOpenJson} />
{/snippet}

{#snippet lastEventCell(row: OrchestrationStatus)}
  {row.lastEvent ?? '—'}
{/snippet}

{#snippet parentCell(row: OrchestrationStatus)}
  {#if row.parentInstanceId}
    <LinkButton mono stopPropagation href={href(row.parentInstanceId)}>{row.parentInstanceId}</LinkButton>
  {:else}
    —
  {/if}
{/snippet}

<!-- ScreenInstances.dc.html L77-L96: the table under the view strip, so it carries no top border. -->
<DataTable
  {columns}
  rows={instances.rows}
  rowKey={(row) => row.instanceId}
  rowStatus={(row) => row.runtimeStatus}
  selectable
  selected={instances.selection.ids}
  hiddenColumns={instances.effectiveHiddenColumns}
  {sort}
  ariaLabel="Instances"
  style="border-top:0;border-radius:0 0 var(--radius) var(--radius)"
  onRowClick={(row) => app.peek.open(toPeekItem(row))}
  onSort={sortBy}
>
  {#snippet footer()}
    <span class="meta">
      Showing {fmtInt(instances.rows.length)}
      {#if hiddenCount > 0}
        · {hiddenCount} column{hiddenCount === 1 ? '' : 's'} hidden ·
        <LinkButton onclick={() => instances.setHiddenColumns([])}>show all</LinkButton>
      {/if}
    </span>

    {#if instances.loading}
      <ProgressBar inline />
    {/if}

    {#if instances.hasMore}
      <Button onclick={() => void instances.loadMore()}>Load more</Button>
    {/if}
  {/snippet}
</DataTable>
