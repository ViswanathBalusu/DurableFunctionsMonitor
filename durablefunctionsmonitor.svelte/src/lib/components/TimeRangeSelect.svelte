<script lang="ts">
  import { getContext } from 'svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import DateRangeCalendar, { PICK_END } from './DateRangeCalendar.svelte';
  import DateTimeField from './DateTimeField.svelte';
  import Field from './Field.svelte';
  import Select, { type SelectOption } from './Select.svelte';
  import {
    MAX_RANGE_DAYS,
    MAX_RANGE_MS,
    TIME_RANGE_LABELS,
    TIME_RANGE_PRESETS,
    isPreset,
    label as rangeLabel,
    resolve,
    type TimeRangePreset,
  } from '$lib/filters/time-range';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** Renders as a filter chip instead of an input (the Instances rail, ScreenInstances.dc.html L48). */
    chip?: boolean;
    size?: 'md' | 'sm';
    width?: string;
    class?: string;
  }

  let { chip = false, size = 'sm', width = 'auto', class: className }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /** The entry that opens the picker. An action, not a range - it is never the trigger's value. */
  const PICK = 'pick';

  /** The window in force, when it is not one of the presets: a brush, or one set here. */
  const custom = $derived(!isPreset(app.timeRange));

  /**
   * The five presets of the mockups' select, the custom window as a sixth entry while one is in
   * force (a brushed histogram sets one, and the control has to be able to say so), and the entry
   * that opens the picker.
   */
  const options = $derived<SelectOption[]>([
    ...TIME_RANGE_PRESETS.map((preset) => ({ value: preset as string, label: TIME_RANGE_LABELS[preset] })),
    ...(custom ? [{ value: 'custom', label: rangeLabel(app.timeRange) }] : []),
    { value: PICK, label: 'Custom range…' },
  ]);

  const current = $derived<string>(isPreset(app.timeRange) ? app.timeRange.preset : 'custom');

  /**
   * The trigger's own value. It follows the range - which any screen, the brush or the palette can
   * change - except for the instant "Custom range…" is picked: that entry is put back at once, so a
   * cancelled dialog leaves the trigger naming the window that is actually in force.
   */
  let selected = $derived<string>(current);

  let open = $state(false);
  let from = $state<string | null>(null);
  let to = $state<string | null>(null);

  /** One end clicked on the calendar and the other not yet: the window is still the old one. */
  let picking = $state(false);

  const fromMs = $derived(from ? new Date(from).getTime() : Number.NaN);
  const toMs = $derived(to ? new Date(to).getTime() : Number.NaN);
  const ordered = $derived(Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs);

  /** The window the backend refuses to aggregate, caught here rather than as a 400 on every screen. */
  const tooLong = $derived(ordered && toMs - fromMs > MAX_RANGE_MS);

  /** Mid-gesture the window is still the old one; Apply would not apply what is on the calendar. */
  const valid = $derived(ordered && !tooLong && !picking);

  const hint = $derived.by(() => {
    if (picking) {
      return PICK_END;
    }

    if (!from || !to) {
      return 'Set both ends of the window.';
    }

    if (!ordered) {
      return 'The start has to be earlier than the end.';
    }

    if (tooLong) {
      return `The window is ${Math.ceil((toMs - fromMs) / 86_400_000)} days. The backend aggregates at most ${MAX_RANGE_DAYS} days at a time.`;
    }

    return app.prefs.showTimeAs === 'UTC' ? 'Times are UTC.' : 'Times are your local time.';
  });

  function pick(next: string): void {
    if (next === PICK) {
      openPicker();
      selected = current;
      return;
    }

    if (next !== 'custom') {
      app.setTimeRange({ preset: next as TimeRangePreset });
    }
  }

  /** Opens on the window that is on screen, so a preset can be nudged rather than typed from scratch. */
  function openPicker(): void {
    const resolved = resolve(app.timeRange, new Date());

    from = resolved.from.toISOString();
    to = resolved.to.toISOString();
    open = true;
  }

  function apply(): void {
    if (!valid || !from || !to) {
      return;
    }

    app.setTimeRange({ from, to });
    open = false;
  }
</script>

<!--
  The shared time range (contracts §4). Every screen that has one renders this: Overview, Instances,
  Failures, Functions and Activity, so a range picked on one of them holds on all of them.
-->
<Select
  {options}
  bind:value={selected}
  ariaLabel="Time range"
  {chip}
  {size}
  {width}
  class={className}
  onchange={pick}
/>

<ConfirmDialog
  bind:open
  title="Custom time range"
  body="Applies to every screen that shares the time range, and stays in the URL of the link you copy."
  confirmLabel="Apply"
  confirmDisabled={!valid}
  {hint}
  width={560}
  onConfirm={apply}
>
  <!-- The calendar picks the two days; the fields below it pick the time of day on each of them. -->
  <DateRangeCalendar bind:from bind:to bind:picking showTimeAs={app.prefs.showTimeAs} calendarLabel="Time range days" />

  <div class="row" style="margin-top:12px">
    <Field label="From">
      <DateTimeField bind:value={from} showTimeAs={app.prefs.showTimeAs} ariaLabel="From" />
    </Field>
    <Field label="To">
      <DateTimeField bind:value={to} showTimeAs={app.prefs.showTimeAs} ariaLabel="To" />
    </Field>
  </div>
</ConfirmDialog>
