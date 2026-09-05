<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import type { HistoryEvent } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import DateTimeField from '$lib/components/DateTimeField.svelte';
  import Field from '$lib/components/Field.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import JsonCell from '$lib/components/table/cells/JsonCell.svelte';
  import JsonDialog from '$lib/components/json/JsonDialog.svelte';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtTimeMs } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import type { ColumnDef } from '$lib/components/table/columns';
  import { historyColumns, historyKey, jsonSubtitle, jsonTitle, resultOf } from './history-columns';
  import { isInputEvent, spineOf } from './history-spine';

  interface Props {
    instance: InstanceState;
    /**
     * Linked mode (E8): the same rows under the Timeline tab's swimlane. There is no rail - the
     * timeline is drawn over the whole execution, and a filtered history would not match it - and
     * no ScheduledTime column, because the timer bars above say when a timer was due.
     */
    linked?: boolean;
    /** The rows of the hovered span, marked `.hl` (E8-S2-T2). */
    highlightKey?: string | readonly string[] | null;
    onRowEnter?: (row: HistoryEvent) => void;
    onRowLeave?: () => void;
    onRowClick?: (row: HistoryEvent) => void;
    /** Replaces the footer, which in linked mode says how much of the history is on screen. */
    tableFooter?: Snippet;
  }

  let {
    instance,
    linked = false,
    highlightKey = null,
    onRowEnter,
    onRowLeave,
    onRowClick,
    tableFooter,
  }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const history = $derived(instance.history);
  const showTimeAs = $derived(app.prefs.showTimeAs);

  /** The row whose Result / Details is open in the viewer. */
  let openRow = $state<HistoryEvent | null>(null);

  // The filter starts wherever the URL left it, which is what makes a filtered history a link
  // svelte-ignore state_referenced_locally
  let enabled = $state(instance.history.timeFrom !== null);
  // svelte-ignore state_referenced_locally
  let from = $state<string | null>(instance.history.timeFrom);

  /** The base definitions with this component's snippets attached (as InstancesTable does). */
  const columns = $derived<ColumnDef<HistoryEvent>[]>(
    historyColumns()
      .filter((column) => !linked || column.id !== 'ScheduledTime')
      .map((column) => ({ ...column, cell: cellFor(column.id) })),
  );

  function cellFor(id: string): Snippet<[HistoryEvent]> | undefined {
    switch (id) {
      case '#':
        return sequenceCell;
      case 'Timestamp':
        return timestampCell;
      case 'EventType':
        return eventTypeCell;
      case 'Name':
        return nameCell;
      case 'ScheduledTime':
        return scheduledCell;
      case 'Duration':
        return durationCell;
      default:
        return resultCell;
    }
  }

  /**
   * React `timeFromEnabled`: turning the filter on seeds it with the first row on screen, so the
   * field opens on something real rather than on an empty set of segments.
   */
  function toggle(next: boolean): void {
    enabled = next;

    if (next && !from) {
      from = history.rows[0]?.Timestamp ?? new Date().toISOString();
    }
  }

  function apply(): void {
    history.setTimeFrom(enabled ? from : null);
    void history.load(true);
  }

  /** The `input` tag: the Inputs tab, scrolled to the event this row is (contracts §4). */
  function goToInput(event: HistoryEvent): void {
    app.router.setQuery({ tab: 'inputs', seq: event.SequenceNumber ?? null });
  }
</script>

{#snippet sequenceCell(row: HistoryEvent)}
  {row.SequenceNumber ?? ''}
{/snippet}

{#snippet timestampCell(row: HistoryEvent)}
  {fmtTimeMs(row.Timestamp, showTimeAs)}
{/snippet}

{#snippet eventTypeCell(row: HistoryEvent)}
  {row.EventType}
  {#if isInputEvent(row)}
    <!-- L136: the two event types the Inputs tab can act on link straight to it -->
    <Tag style="margin-left:6px" onclick={() => goToInput(row)}>input</Tag>
  {/if}
{/snippet}

{#snippet nameCell(row: HistoryEvent)}
  {row.Name ?? ''}
{/snippet}

{#snippet scheduledCell(row: HistoryEvent)}
  {row.ScheduledTime ? fmtTimeMs(row.ScheduledTime, showTimeAs) : ''}
{/snippet}

{#snippet durationCell(row: HistoryEvent)}
  {row.DurationInMs === null ? '' : fmtDuration(row.DurationInMs)}
{/snippet}

{#snippet resultCell(row: HistoryEvent)}
  <JsonCell value={resultOf(row)} title={jsonTitle(row)} onOpenJson={() => (openRow = row)} />
{/snippet}

<!--
  ScreenInstance.dc.html L121-L145: the From/Till rail, the table with its spine, and the footer that
  explains the rewound rows. The backend filters history from a start time only, which is why Till is
  there but dead - leaving it out would read as a filter the UI forgot.
-->
{#if !linked}
  <div class="row" style="align-items:flex-end">
    <Field label="From">
      <DateTimeField
        bind:value={from}
        {showTimeAs}
        granularity="second"
        ariaLabel="From"
        {enabled}
        enabledLabel="Set"
        onEnabledChange={toggle}
      />
    </Field>

    <Field label="Till" for="dfm-history-till">
      <TextInput
        id="dfm-history-till"
        mono
        disabled
        value=""
        placeholder="now"
        style="width:190px"
        title="The backend filters history from a start time only"
      />
    </Field>

    <Button onclick={apply}>Apply</Button>

    <span class="meta" style="margin-left:auto">
      {history.rows.length} events shown{history.hasMore ? ' so far' : ''}
    </span>
  </div>
{/if}

<DataTable
  {columns}
  rows={history.rows}
  rowKey={historyKey}
  rowStatus={(row) => spineOf(row, instance.status)}
  {highlightKey}
  {onRowEnter}
  onRowLeave={() => onRowLeave?.()}
  {onRowClick}
  keep
  ariaLabel="History"
>
  {#snippet footer()}
    {#if tableFooter}
      {@render tableFooter()}
    {:else}
      <span class="meta"> Rewound rows arrive as GenericEvent with a “Rewound:” reason and the continued spine. </span>
      {#if history.hasMore}
        <Button onclick={() => void history.loadMore()} disabled={history.loading}>Load more</Button>
      {/if}
    {/if}
  {/snippet}
</DataTable>

{#if openRow}
  <JsonDialog
    bind:open={
      () => openRow !== null,
      (next) => {
        if (!next) {
          openRow = null;
        }
      }
    }
    title={jsonTitle(openRow)}
    subtitle={jsonSubtitle(openRow, showTimeAs)}
    value={resultOf(openRow)}
    onCopied={() => app.toast.ok(`Copied ${jsonTitle(openRow as HistoryEvent)} to the clipboard`)}
  />
{/if}
