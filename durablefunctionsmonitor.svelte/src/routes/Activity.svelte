<script lang="ts" module>
  /** The empty state of ScreenActivity.dc.html L24, which says both of the things it can mean. */
  export const NO_ACTIVITY_TITLE = 'No activity recorded';

  /** Nothing is being recorded: the table is empty because there is no trail, not because it is quiet. */
  export function auditingOffText(hubName: string): string {
    const table = hubName ? `${hubName}DfmAudit` : 'DfmAudit';

    return (
      'Auditing is off for this hub. Set DFM_AUDIT_ENABLED=true on the backend; every Write and ' +
      `Dangerous call is then written to the ${table} table and shows up here.`
    );
  }

  /** ...and the other one: auditing is on, and this range simply holds nothing. */
  export function nothingInRangeText(rangeLower: string): string {
    return `Nothing was recorded in the ${rangeLower}.`;
  }
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import ActivityTable from '$lib/activity/ActivityTable.svelte';
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
  import { ALL_OPERATIONS, Activity, OPERATIONS } from '$lib/state/activity.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const activity = new Activity({ app });

  /** The five presets of the mockup's select, plus a custom window while one is on. */
  const rangeOptions = $derived<SelectOption[]>([
    ...TIME_RANGE_PRESETS.map((preset) => ({ value: preset, label: TIME_RANGE_LABELS[preset] })),
    ...(isPreset(app.timeRange) ? [] : [{ value: 'custom', label: rangeLabel(app.timeRange) }]),
  ]);

  const rangeValue = $derived(isPreset(app.timeRange) ? app.timeRange.preset : 'custom');

  /** Every name the middleware can write, and the entry that means "do not filter at all". */
  const operationOptions: SelectOption[] = [ALL_OPERATIONS, ...OPERATIONS].map((operation) => ({
    value: operation,
    label: operation,
  }));

  onMount(() => {
    activity.startAutoRefresh();

    const stopRefresh = app.onRefresh(() => void activity.load());

    return () => {
      activity.stopAutoRefresh();
      stopRefresh();
    };
  });

  /**
   * Both filters live in the URL, so a change from anywhere is a new load; and the capabilities arrive
   * after the first render, so a screen that asked nothing while they were unknown has to ask again
   * once they are known (Overview, Failures and Entities watch the same thing).
   */
  let loadedKey = '';

  $effect(() => {
    const key = JSON.stringify([app.timeRange, activity.operation, activity.supported]);

    if (key === loadedKey) {
      return;
    }

    loadedKey = key;

    queueMicrotask(() => void activity.load());
  });

  function pickRange(next: string): void {
    if (next !== 'custom') {
      app.setTimeRange({ preset: next as TimeRangePreset });
    }
  }
</script>

<!--
  ScreenActivity.dc.html L16-L46: the audit trail of this hub - who ran which write or dangerous
  operation, against what, and how it went - narrowed by the shared range and by one operation.
-->
<Page data-screen-label="Activity">
  <PageTitle title="Activity">
    <Select
      options={rangeOptions}
      value={rangeValue}
      ariaLabel="Time range"
      size="sm"
      width="auto"
      onchange={pickRange}
    />

    <Select
      options={operationOptions}
      value={activity.operation}
      ariaLabel="Operation"
      size="sm"
      width="auto"
      onchange={(operation) => activity.setOperation(operation)}
    />

    <span class="meta" style="margin-left:auto">{activity.countLabel}</span>
  </PageTitle>

  {#if activity.auditingOff}
    <EmptyState title={NO_ACTIVITY_TITLE} text={auditingOffText(app.about?.hubName ?? '')} />
  {:else if activity.isEmpty}
    <EmptyState title={NO_ACTIVITY_TITLE} text={nothingInRangeText(activity.rangeLower)} />
  {:else}
    <ActivityTable {activity} />
  {/if}
</Page>
