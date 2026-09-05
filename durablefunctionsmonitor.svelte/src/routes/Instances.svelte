<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import FilterChips from '$lib/instances/FilterChips.svelte';
  import FilterRail from '$lib/instances/FilterRail.svelte';
  import InstancesTable from '$lib/instances/InstancesTable.svelte';
  import HistogramView from '$lib/instances/HistogramView.svelte';
  import SavedViewsMenu from '$lib/instances/SavedViewsMenu.svelte';
  import TimelineView from '$lib/instances/TimelineView.svelte';
  import ViewStrip from '$lib/instances/ViewStrip.svelte';
  import { label as rangeLabel } from '$lib/filters/time-range';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Instances } from '$lib/state/instances.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const instances = new Instances({ app });

  /** The Start new instance dialog (E4-S7), which `?start=1` and the palette both ask for. */
  let startOpen = $state(false);

  /** `?selectAll=1` from VS Code: the rows are not there yet when the flag is read. */
  let selectAllPending = $state(false);

  onMount(() => {
    startOpen = instances.takeFlag('start');
    selectAllPending = instances.takeFlag('selectAll');

    void instances.reload();

    instances.startAutoRefresh();

    // The screen's Refresh, the palette's Refresh and VS Code all come through here (E2-S6-T2)
    const stopRefresh = app.onRefresh(() => void instances.reload());

    return () => {
      instances.stopAutoRefresh();
      stopRefresh();
    };
  });

  /**
   * The shared time range lives in the URL, so a change from anywhere is a new first page. Keyed on
   * the range itself and not on the query: writing a filter to the URL is already a reload of its
   * own, and this must not make it two - and the key belongs to the state, which sets it as it
   * loads, so a reload started elsewhere (a saved view carrying its own range) counts as this one.
   * The load is queued rather than started inside the effect, which is not the place to be writing
   * state (the progress counter, the rows).
   */
  $effect(() => {
    if (JSON.stringify(app.timeRange) === instances.loadedRangeKey) {
      return;
    }

    queueMicrotask(() => void instances.reload());
  });

  /** The empty state replaces the whole view, so it must not flash while the first page loads. */
  const isEmpty = $derived(!instances.loading && instances.rows.length === 0 && !instances.error);

  const rangeLower = $derived(rangeLabel(app.timeRange).toLowerCase());

  $effect(() => {
    if (selectAllPending && !instances.loading && instances.rows.length > 0) {
      instances.selectAllLoaded();
      selectAllPending = false;
    }
  });
</script>

<!--
  ScreenInstances.dc.html L16-L62. The views and the dialogs are added by the tasks that own them
  (E4-S3 onwards); this is the frame they hang in.
-->
<Page data-screen-label="Instances">
  <PageTitle title="Instances">
    <span class="meta">{instances.matchLabel}</span>

    <div class="row" style="margin-left:auto;gap:10px">
      <SavedViewsMenu {instances} />

      <!-- The dialog itself is E4-S7; the flag it opens from is the one ?start=1 already sets -->
      <Button
        variant="primary"
        disabled={app.readOnly}
        aria-haspopup="dialog"
        aria-expanded={startOpen}
        onclick={() => (startOpen = true)}
      >
        Start new instance
      </Button>
    </div>
  </PageTitle>

  <FilterChips {instances} />

  <FilterRail {instances} />

  {#if isEmpty}
    <!-- L65: nothing matched, so the strip and the table are not drawn at all -->
    <EmptyState
      title="No orchestrations"
      text={`Nothing matches these filters in the ${rangeLower}. Remove a chip, widen the time range or start a new instance.`}
    >
      {#snippet actions()}
        <Button onclick={() => instances.clearAll()}>Clear filters</Button>
        <Button variant="primary" disabled={app.readOnly} onclick={() => (startOpen = true)}>Start new instance</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div>
      <ViewStrip {instances} />

      {#if instances.view === 'table'}
        <InstancesTable {instances} />
      {:else if instances.view === 'timeline'}
        <TimelineView {instances} />
      {:else}
        <HistogramView {instances} />
      {/if}
    </div>
  {/if}
</Page>
