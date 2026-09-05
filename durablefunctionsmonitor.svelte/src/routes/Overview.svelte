<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import Select, { type SelectOption } from '$lib/components/Select.svelte';
  import {
    TIME_RANGE_LABELS,
    TIME_RANGE_PRESETS,
    isPreset,
    label as rangeLabel,
    type TimeRangePreset,
  } from '$lib/filters/time-range';
  import { fmtInt } from '$lib/format/number';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import NeedsAttention from '$lib/overview/NeedsAttention.svelte';
  import StatTiles from '$lib/overview/StatTiles.svelte';
  import ThroughputPanel from '$lib/overview/ThroughputPanel.svelte';
  import TopOrchestrators from '$lib/overview/TopOrchestrators.svelte';
  import { NO_STATS_TEXT, NO_STATS_TITLE, Overview } from '$lib/state/overview.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const overview = new Overview({ app });

  /** The five presets of the mockup's select; a brushed window is a sixth entry while it is on. */
  const rangeOptions = $derived<SelectOption[]>([
    ...TIME_RANGE_PRESETS.map((preset) => ({ value: preset, label: TIME_RANGE_LABELS[preset] })),
    ...(isPreset(app.timeRange) ? [] : [{ value: 'custom', label: rangeLabel(app.timeRange) }]),
  ]);

  const rangeValue = $derived(isPreset(app.timeRange) ? app.timeRange.preset : 'custom');

  /** "last 24 hours", as the empty state reads it back to the user. */
  const rangeLower = $derived(rangeLabel(app.timeRange).toLowerCase());

  const isDay = $derived(isPreset(app.timeRange) && app.timeRange.preset === '24h');

  /** The banner's own sentence, with the cap the backend actually stopped at. */
  const partialText = $derived(
    `Counted the first ${fmtInt(overview.stats?.cap)} instances of the range; narrow the range for exact numbers.`,
  );

  onMount(() => {
    void overview.load();

    overview.startAutoRefresh();

    // The header counts up, so the clock has to tick - the workspace header drives it the same way
    const clock = setInterval(() => (app.now = Date.now()), 1000);

    const stopRefresh = app.onRefresh(() => void overview.load());

    return () => {
      clearInterval(clock);
      overview.stopAutoRefresh();
      stopRefresh();
    };
  });

  /**
   * The shared range lives in the URL, so a change from anywhere - the top bar, the palette, the
   * throughput brush - is a new load. Queued rather than started inside the effect, which is not
   * the place to be writing state.
   */
  $effect(() => {
    if (JSON.stringify(app.timeRange) === overview.loadedRangeKey) {
      return;
    }

    queueMicrotask(() => void overview.load());
  });

  function pickRange(next: string): void {
    if (next !== 'custom') {
      app.setTimeRange({ preset: next as TimeRangePreset });
    }
  }

  /**
   * The Instances screen owns the Start new instance dialog and registers it while it is on. From
   * here it is not, so this goes there and asks for it - which is what the mockup does too
   * (`nav('instances', { start: true })`).
   */
  function startNewInstance(): void {
    const dialog = app.dialogs.startNewInstance;

    if (dialog) {
      dialog.openWith();
      return;
    }

    app.router.navigate({ name: 'instances', hub: app.hub }, { query: { start: '1' } });
  }
</script>

<!-- The banner's action, which is not there at all once the range already is the one it offers. -->
{#snippet useLastDay()}
  <Button size="sm" onclick={() => app.setTimeRange({ preset: '24h' })}>Use last 24 hours</Button>
{/snippet}

<!--
  ScreenOverview.dc.html L16-L28: the title row with the range and the freshness of the numbers,
  then the three things the screen can be - capped, empty, or the numbers themselves.
-->
<Page data-screen-label="Overview">
  <PageTitle title="Overview">
    <Select
      options={rangeOptions}
      value={rangeValue}
      ariaLabel="Time range"
      size="sm"
      width="auto"
      onchange={pickRange}
    />

    <Button variant="ghost" style="height:32px" onclick={() => app.refresh()}>Refresh</Button>

    {#if overview.loadedAt}
      <span class="fine muted" style="margin-left:auto">
        refreshed {overview.refreshedAgo} · scanned {overview.scannedLabel}
      </span>
    {/if}
  </PageTitle>

  {#if !overview.supported}
    <!-- No /stats, so nothing was asked of it: the other screens work without it, and say where. -->
    <EmptyState title={NO_STATS_TITLE} text={NO_STATS_TEXT}>
      {#snippet actions()}
        <Button variant="primary" onclick={() => app.router.navigate({ name: 'instances', hub: app.hub })}>
          Instances
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    {#if overview.partial && !overview.isEmpty}
      <Banner action={isDay ? undefined : useLastDay}>
        {#snippet chip()}
          <Chip size="sm" class="st-running">Partial results</Chip>
        {/snippet}

        {partialText}
      </Banner>
    {/if}

    {#if overview.isEmpty}
      <EmptyState
        title="No orchestrations"
        text={`Nothing was created in the ${rangeLower}. Widen the time range or start a new instance.`}
      >
        {#snippet actions()}
          <Button onclick={() => app.setTimeRange({ preset: '7d' })}>Widen to 7 days</Button>
          <Button variant="primary" onclick={startNewInstance}>Start new instance</Button>
        {/snippet}
      </EmptyState>
    {:else if overview.stats}
      <StatTiles stats={overview.stats} />

      <div class="panels">
        <ThroughputPanel stats={overview.stats} />
        <NeedsAttention stats={overview.stats} storage={overview.storage} />
      </div>

      <TopOrchestrators rows={overview.stats.byName} subOrchestrators={overview.subOrchestrators} />
    {/if}
  {/if}
</Page>
