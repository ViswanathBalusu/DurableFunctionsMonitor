<script lang="ts" module>
  import type { RuntimeStatus, StatsResponse } from '$lib/api/types';
  import type { ChartSeries } from '$lib/charts/stacked-columns';
  import { fmtDateTime, type ShowTimeAs } from '$lib/format/time';
  import { statusClass } from '$lib/format/status';

  /** How many ticks the axis carries (ScreenOverview.dc.html L57). */
  export const AXIS_TICKS = 5;

  /** The four statuses the chart always stacks, bottom-up in this order. */
  export const ALWAYS_STACKED: readonly RuntimeStatus[] = ['Completed', 'Failed', 'Running', 'Pending'];

  /** The four it stacks only when the range actually holds some. */
  export const WHEN_PRESENT: readonly RuntimeStatus[] = ['Suspended', 'Terminated', 'Canceled', 'ContinuedAsNew'];

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** The colour token behind a status chip, which is what the columns are painted with. */
  export function statusToken(status: RuntimeStatus): string {
    return statusClass(status).replace(/^st-/, 'status-');
  }

  /** Sums one status over the whole range. */
  export function totalOf(stats: StatsResponse, status: RuntimeStatus): number {
    return stats.bins.reduce((sum, bin) => sum + (bin.counts[status] ?? 0), 0);
  }

  /** The stack: the four that are always there, then whatever else the range holds. */
  export function throughputSeries(stats: StatsResponse): ChartSeries[] {
    return [...ALWAYS_STACKED, ...WHEN_PRESENT.filter((status) => totalOf(stats, status) > 0)].map((status) => ({
      key: status,
      label: status,
      color: statusToken(status),
    }));
  }

  /**
   * The axis labels of the mockup (L57): `Sep 3, 14:00`, then `20:00`, then `Sep 4, 02:00` - the day
   * is written on the first tick and again whenever it turns over, and nowhere else, because an axis
   * that repeats the date five times says nothing four of those times.
   */
  export function axisLabels(isoTicks: string[], showTimeAs: ShowTimeAs = 'UTC'): string[] {
    let lastDay = '';

    return isoTicks.map((iso) => {
      const text = fmtDateTime(iso, showTimeAs);

      if (text === '—') {
        return text;
      }

      const day = text.slice(0, 10);
      const time = text.slice(11, 16);
      const label =
        day === lastDay ? time : `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${time}`;

      lastDay = day;

      return label;
    });
  }

  /** `Brushed Sep 4, 08:30 to 14:02` - the same rule, over the two ends of the window. */
  export function brushedLabel(from: string, to: string, showTimeAs: ShowTimeAs = 'UTC'): string {
    const [start, end] = axisLabels([from, to], showTimeAs);

    return `Brushed ${start} to ${end}`;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import StackedColumns from '$lib/charts/StackedColumns.svelte';
  import { ticksFor, type ChartBin, type Range } from '$lib/charts/stacked-columns';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { DEFAULT_TIME_RANGE, isPreset, type TimeRange } from '$lib/filters/time-range';
  import { fmtDuration } from '$lib/format/duration';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    stats: StatsResponse;
  }

  let { stats }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  const bins = $derived<ChartBin[]>(
    stats.bins.map((bin) => ({
      start: new Date(bin.start),
      end: new Date(bin.end),
      values: bin.counts as Record<string, number>,
    })),
  );

  const series = $derived(throughputSeries(stats));

  /** How long one column is, which is what the chart's label says it counts per. */
  const binMs = $derived(bins.length > 0 ? bins[0].end.getTime() - bins[0].start.getTime() : 0);

  const ariaLabel = $derived(`Instances per ${fmtDuration(binMs)} by status`);

  /**
   * The tick labels, worked out before the chart asks for them: whether a tick writes its date
   * depends on the tick before it, and the chart formats each one on its own. Asking `ticksFor` for
   * the instants first - it is the same function the chart lays the axis out with - is what makes
   * "the day turned over here" a thing this can know.
   */
  const tickLabels = $derived.by<Record<string, string>>(() => {
    const instants = ticksFor(bins, 1, AXIS_TICKS, (date) => date.toISOString()).map((tick) => tick.label);
    const labels = axisLabels(instants, showTimeAs);

    return Object.fromEntries(instants.map((iso, index) => [iso, labels[index]]));
  });

  /** The selection, which lives only as long as the drag: the brush becomes the range itself. */
  let brush = $state<Range | null>(null);

  /** Where `clear` goes back to: the preset that was in force before the first brush. */
  let previous = $state<TimeRange | null>(null);

  const custom = $derived(!isPreset(app.timeRange));

  const brushed = $derived(
    custom && 'from' in app.timeRange ? brushedLabel(app.timeRange.from, app.timeRange.to, showTimeAs) : '',
  );

  function formatTick(date: Date): string {
    return tickLabels[date.toISOString()] ?? '';
  }

  /**
   * A brushed window becomes the shared range, so every screen follows it - and the chart is then
   * drawn over that window, which is why the selection itself is dropped rather than kept: a
   * selection covering the whole chart says nothing.
   */
  function onBrush(range: Range | null): void {
    if (!range) {
      return;
    }

    previous ??= isPreset(app.timeRange) ? app.timeRange : null;
    brush = null;

    app.setTimeRange({ from: range.from.toISOString(), to: range.to.toISOString() });
  }

  function clear(): void {
    const back = previous ?? DEFAULT_TIME_RANGE;

    previous = null;
    app.setTimeRange(back);
  }
</script>

<!-- ScreenOverview.dc.html L39-L63: the range as columns, and the brush that narrows it. -->
<Panel title="Throughput">
  {#snippet meta()}
    <span class="fine muted">{stats.binCount} bins · brush sets the global range</span>
  {/snippet}

  <StackedColumns {bins} {series} bind:brush {onBrush} {ariaLabel} xTicks={AXIS_TICKS} {formatTick} />

  {#if custom}
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      <span class="meta">
        {brushed} ·
        <LinkButton onclick={clear}>clear</LinkButton>
      </span>
    </div>
  {/if}
</Panel>
