<script lang="ts">
  import { getContext } from 'svelte';
  import type { OrchestrationStatus } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import JsonDialog from '$lib/components/json/JsonDialog.svelte';
  import JsonCell from '$lib/components/table/cells/JsonCell.svelte';
  import StatusCell from '$lib/components/table/cells/StatusCell.svelte';
  import { nextSort, type ColumnDef, type SortState } from '$lib/components/table/columns';
  import { SvelteSet } from 'svelte/reactivity';
  import { isRouterClick } from '$lib/router.svelte';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtInt } from '$lib/format/number';
  import { fmtDateTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { DEFAULT_DIR, DEFAULT_ORDER_BY, type Instances } from '$lib/state/instances.svelte';
  import { baseColumns, displayName, durationOf, toPeekItem } from './columns';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /** The cell whose value is being read in full, or nothing. */
  let json = $state<{ title: string; instanceId: string; value: unknown } | null>(null);

  /** The endpoint's name for a column, for the fields that can be saved as a file. */
  const DOWNLOAD_FIELDS: Record<string, string> = {
    input: 'input',
    output: 'output',
    customStatus: 'custom-status',
  };

  const showTimeAs = $derived(app.prefs.showTimeAs);

  const sort = $derived<SortState>({ id: instances.orderBy, dir: instances.dir });

  const hiddenCount = $derived(instances.effectiveHiddenColumns.length);

  /**
   * The table works in plain sets of row keys; the selection store is what the bulk bar and the
   * dialogs read, and it keeps the orchestrator name of every id beside it. The two are joined by a
   * function binding rather than by handing the store's own set over: `DataTable` reassigns the set
   * it is given, which a store cannot be told about.
   */
  const selectedKeys = $derived(new SvelteSet(instances.selection.ids));

  function selectKeys(keys: Set<string>): void {
    instances.selection.set(
      instances.rows
        .filter((row) => keys.has(row.instanceId))
        .map((row) => ({ instanceId: row.instanceId, name: displayName(row) })),
    );
  }

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
      event.preventDefault();
      app.client.host.openInNewWindow(row.instanceId);
      return;
    }

    if (!isRouterClick(event)) {
      // Shift or the middle button: the browser's own way of opening the link elsewhere
      return;
    }

    event.preventDefault();
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId: row.instanceId });
  }

  /** The parent link navigates in the app as well; the anchor is there for copy and open-in-new. */
  function openParent(instanceId: string, event: MouseEvent): void {
    if (!isRouterClick(event)) {
      return;
    }

    event.preventDefault();
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId });
  }

  /** A cell opens the viewer for its own row, which is why the snippets close over it. */
  function openJson(row: OrchestrationStatus, value: unknown, title: string): void {
    json = { title, instanceId: row.instanceId, value };
  }

  /**
   * The big fields are saved through the backend rather than out of the page: what is on screen may
   * be a blob URL, and only the backend can read what is behind it (React `downloadFieldValue`).
   */
  async function download(): Promise<void> {
    const open = json;

    if (!open) {
      return;
    }

    try {
      await app.track(() => app.endpoints.downloadField(open.instanceId, DOWNLOAD_FIELDS[open.title]));
    } catch (error) {
      app.toast.fromError(`Could not download ${open.title}`, error);
    }
  }

  function sortBy(id: string): void {
    const next = nextSort(sort, id);

    if (next) {
      instances.setOrder(next.id, next.dir);
      return;
    }

    // "Unsorted" is not something the backend can be asked for, so the third click falls back to the
    // default order - except on the default column itself, which has no order to fall back to and
    // would be stuck facing one way for ever. There it flips instead.
    if (id === DEFAULT_ORDER_BY) {
      instances.setOrder(id, 'asc');
      return;
    }

    instances.setOrder(DEFAULT_ORDER_BY, DEFAULT_DIR);
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
  <JsonCell value={row.customStatus} title="customStatus" onOpenJson={(value, title) => openJson(row, value, title)} />
{/snippet}

{#snippet inputCell(row: OrchestrationStatus)}
  <JsonCell value={row.input} title="input" onOpenJson={(value, title) => openJson(row, value, title)} />
{/snippet}

{#snippet outputCell(row: OrchestrationStatus)}
  <JsonCell value={row.output} title="output" onOpenJson={(value, title) => openJson(row, value, title)} />
{/snippet}

{#snippet lastEventCell(row: OrchestrationStatus)}
  {row.lastEvent ?? '—'}
{/snippet}

{#snippet parentCell(row: OrchestrationStatus)}
  {#if row.parentInstanceId}
    <LinkButton
      mono
      stopPropagation
      href={href(row.parentInstanceId)}
      onclick={(event) => openParent(row.parentInstanceId as string, event)}
    >
      {row.parentInstanceId}
    </LinkButton>
  {:else}
    —
  {/if}
{/snippet}

<!-- ScreenInstances.dc.html L173-L182: the whole value, pretty-printed and expanded (contracts §9). -->
{#if json}
  <JsonDialog
    bind:open={
      () => json !== null,
      (next) => {
        if (!next) {
          json = null;
        }
      }
    }
    title={json.title}
    subtitle={json.instanceId}
    value={json.value}
    onDownload={DOWNLOAD_FIELDS[json.title] ? () => void download() : undefined}
    onCopied={() => app.toast.ok(`Copied ${json?.title} to the clipboard`)}
  />
{/if}

<!-- ScreenInstances.dc.html L77-L96: the table under the view strip, so it carries no top border. -->
<DataTable
  {columns}
  rows={instances.rows}
  rowKey={(row) => row.instanceId}
  rowStatus={(row) => row.runtimeStatus}
  selectable
  bind:selected={() => selectedKeys, selectKeys}
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
