<script lang="ts">
  import { getContext } from 'svelte';
  import Select, { type SelectOption } from '$lib/components/Select.svelte';
  import { TIME_RANGE_LABELS, TIME_RANGE_PRESETS, isPreset, label } from '$lib/filters/time-range';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const custom = $derived(!isPreset(app.timeRange));

  /**
   * The five presets, plus the custom window as a sixth entry while one is in force - a brushed
   * histogram sets one, and the chip has to be able to say so rather than silently showing a preset.
   */
  const options = $derived<SelectOption[]>([
    ...TIME_RANGE_PRESETS.map((preset) => ({ value: preset, label: TIME_RANGE_LABELS[preset] })),
    ...(custom ? [{ value: 'custom', label: label(app.timeRange) }] : []),
  ]);

  const value = $derived(isPreset(app.timeRange) ? app.timeRange.preset : 'custom');

  function pick(next: string): void {
    if (next !== 'custom') {
      app.setTimeRange({ preset: next as (typeof TIME_RANGE_PRESETS)[number] });
    }
  }
</script>

<!-- ScreenInstances.dc.html L48: the shared time range, as a filter chip. -->
<Select {options} {value} ariaLabel="Time range" chip size="sm" width="auto" onchange={pick} />
