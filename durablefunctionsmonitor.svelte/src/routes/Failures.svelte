<script lang="ts" module>
  /** How the backend gets from a hundred distinct messages to a handful of groups (L21). */
  export const SIGNATURE_NOTE = 'signatures normalise numbers, GUIDs and quoted values to *';

  /** What the screen is instead of itself on a backend that cannot group failures. */
  export const NO_FAILURES_TITLE = 'Failures needs the failures endpoint';
  export const NO_FAILURES_TEXT =
    'This backend does not group failures by their error. The Instances screen lists the failed ' +
    'instances of the same range one by one.';
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import Select, { type SelectOption } from '$lib/components/Select.svelte';
  import FailureActionDialog, { type FailureActionKind } from '$lib/failures/FailureActionDialog.svelte';
  import FailureGroup from '$lib/failures/FailureGroup.svelte';
  import {
    TIME_RANGE_LABELS,
    TIME_RANGE_PRESETS,
    isPreset,
    label as rangeLabel,
    toQuery,
    type TimeRangePreset,
  } from '$lib/filters/time-range';
  import { fmtInt } from '$lib/format/number';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Failures } from '$lib/state/failures.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const failures = new Failures({ app });

  /** What a row or a group button asked for; the dialog runs it and reloads the screen. */
  let pending = $state<{ kind: FailureActionKind; ids: string[] } | null>(null);

  /** The five presets of the mockup's select, plus a custom window while one is on. */
  const rangeOptions = $derived<SelectOption[]>([
    ...TIME_RANGE_PRESETS.map((preset) => ({ value: preset, label: TIME_RANGE_LABELS[preset] })),
    ...(isPreset(app.timeRange) ? [] : [{ value: 'custom', label: rangeLabel(app.timeRange) }]),
  ]);

  const rangeValue = $derived(isPreset(app.timeRange) ? app.timeRange.preset : 'custom');

  /** "last 24 hours", as the empty state reads it back to the user. */
  const rangeLower = $derived(rangeLabel(app.timeRange).toLowerCase());

  const groupCount = $derived(failures.groups.length);

  const rangeQuery = $derived(
    Object.fromEntries(Object.entries(toQuery(app.timeRange)).filter(([, value]) => value !== null)),
  );

  onMount(() => {
    failures.startAutoRefresh();

    const stopRefresh = app.onRefresh(() => void failures.load());

    return () => {
      failures.stopAutoRefresh();
      stopRefresh();
    };
  });

  /**
   * The range lives in the URL, so a change from anywhere is a new load; and the capabilities arrive
   * after the first render, so a screen that asked for nothing while they were unknown has to ask
   * again once they are known (the Overview and the workspace watch the same two things).
   */
  let loadedKey = '';

  $effect(() => {
    const key = JSON.stringify([app.timeRange, failures.supported]);

    if (key === loadedKey) {
      return;
    }

    loadedKey = key;

    queueMicrotask(() => void failures.load());
  });

  function pickRange(next: string): void {
    if (next !== 'custom') {
      app.setTimeRange({ preset: next as TimeRangePreset });
    }
  }

  function confirm(kind: FailureActionKind, ids: string[]): void {
    pending = { kind, ids };
  }
</script>

<!--
  ScreenFailures.dc.html L16-L60: the title row with the range and how far the backend looked, then
  one collapsible group per orchestrator and error signature.
-->
<Page data-screen-label="Failures">
  <PageTitle title="Failures">
    <Select
      options={rangeOptions}
      value={rangeValue}
      ariaLabel="Time range"
      size="sm"
      width="auto"
      onchange={pickRange}
    />

    <!-- The chip carries the number; `summary` is the same sentence in one piece, for a reader -->
    <span class="meta" aria-label={failures.summary}>
      <Chip size="sm" class="st-failed">{fmtInt(failures.totalFailed)}</Chip>
      failed in {groupCount} group{groupCount === 1 ? '' : 's'}
    </span>

    {#if failures.response}
      <span class="fine muted" style="margin-left:auto">{failures.scannedLabel} · {SIGNATURE_NOTE}</span>
    {/if}
  </PageTitle>

  {#if !failures.supported}
    <EmptyState title={NO_FAILURES_TITLE} text={NO_FAILURES_TEXT}>
      {#snippet actions()}
        <Button
          variant="primary"
          onclick={() =>
            app.router.navigate({ name: 'instances', hub: app.hub }, { query: { ...rangeQuery, status: 'Failed' } })}
        >
          Failed instances
        </Button>
      {/snippet}
    </EmptyState>
  {:else if failures.isEmpty}
    <EmptyState
      title="No failures"
      text={`Nothing failed in the ${rangeLower}. Widen the range to look further back.`}
    />
  {:else}
    <!-- Straight into the page grid, which is what spaces them (dfm-ui.css `.page`) -->
    {#each failures.groups as group (group.key)}
      <FailureGroup
        {group}
        open={failures.isOpen(group.key)}
        onToggle={() => failures.toggle(group.key)}
        onRewindAll={(ids) => confirm('rewind', ids)}
        onPurgeAll={(ids) => confirm('purge', ids)}
        onRewind={(instanceId) => confirm('rewind', [instanceId])}
        onPurge={(instanceId) => confirm('purge', [instanceId])}
      />
    {/each}
  {/if}

  {#if pending}
    <FailureActionDialog
      bind:open={
        () => pending !== null,
        (next) => {
          if (!next) {
            pending = null;
          }
        }
      }
      kind={pending.kind}
      ids={pending.ids}
      onDone={() => failures.load()}
    />
  {/if}
</Page>
