<script lang="ts" module>
  /** What to say while one end has been picked and the other has not. */
  export const PICK_END = 'Pick the other end of the window.';
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import {
    CalendarDateTime,
    fromDate,
    getLocalTimeZone,
    toCalendarDate,
    toZoned,
    type CalendarDate,
    type DateValue,
  } from '@internationalized/date';
  import * as RangeCalendarPrimitive from '$lib/components/ui/range-calendar/index.js';
  import type { DateRange } from '$lib/components/ui/range-calendar/index.js';
  import { MAX_RANGE_DAYS } from '$lib/filters/time-range';

  interface Props {
    /** The window's start, ISO 8601 UTC. Bindable; only its date part is written here. */
    from?: string | null;
    /** The window's end, ISO 8601 UTC. Bindable; only its date part is written here. */
    to?: string | null;
    /** Which clock the days are read in, so "the 4th" is the user's 4th (contracts §8). */
    showTimeAs?: 'UTC' | 'Local';
    /** True while one end has been picked and the other has not. Bindable; written here only. */
    picking?: boolean;
    /** Nothing later than this can be picked; the default is today, since there is no future data. */
    maxValue?: DateValue;
    /** Names the calendar for a screen reader; bits-ui appends the months in view. */
    calendarLabel?: string;
  }

  let {
    from = $bindable(null),
    to = $bindable(null),
    showTimeAs = 'UTC',
    picking = $bindable(false),
    maxValue = undefined,
    calendarLabel = 'Date range',
  }: Props = $props();

  const timeZone = $derived(showTimeAs === 'Local' ? getLocalTimeZone() : 'UTC');

  /** The same instant in the zone the days are being read in, or undefined when it does not parse. */
  function zonedOf(value: string | null): ReturnType<typeof fromDate> | undefined {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? undefined : fromDate(date, timeZone);
  }

  function dayOf(value: string | null): CalendarDate | undefined {
    const zoned = zonedOf(value);

    return zoned ? toCalendarDate(zoned) : undefined;
  }

  function sameDay(a: DateValue | undefined, b: DateValue | undefined): boolean {
    return String(a ?? '') === String(b ?? '');
  }

  /**
   * The two days the calendar itself holds.
   *
   * This is the calendar's own state rather than a value derived from `from` and `to`, because
   * picking a range is two clicks and the first of them leaves it half-set: a complete value fed
   * back in on every change makes bits-ui read the second click as the start of a third range, and
   * the end can then never be picked at all.
   */
  let selection = $state<DateRange>({ start: dayOf(from), end: dayOf(to) });

  /** Both ends picked: the gesture is over, and the window is the one on the calendar. */
  const complete = $derived(!!selection.start && !!selection.end);

  $effect(() => {
    picking = !complete;
  });

  /**
   * The window changed somewhere else - the two time fields beside the calendar, or the dialog being
   * opened on a different range. Half-way through a gesture nothing is taken back: the calendar is
   * what the user is clicking on, and `from`/`to` still hold the window it started from.
   */
  $effect(() => {
    const start = dayOf(from);
    const end = dayOf(to);

    untrack(() => {
      if (complete && !(sameDay(start, selection.start) && sameDay(end, selection.end))) {
        selection = { start, end };
      }
    });
  });

  /** Today in the reading zone: there is no orchestration history in the future. */
  const ceiling = $derived(maxValue ?? toCalendarDate(fromDate(new Date(), timeZone)));

  /**
   * Writes a picked day onto one end of the window, keeping the time of day that end already has:
   * the calendar picks days and the two time fields beside it pick the hour, so a day picked here
   * must not throw away a time typed there.
   */
  function applyDay(current: string | null, day: DateValue, fallbackHour: number): string {
    const zoned = zonedOf(current);

    const next = zoned
      ? zoned.set({ year: day.year, month: day.month, day: day.day })
      : toZoned(new CalendarDateTime(day.year, day.month, day.day, fallbackHour), timeZone);

    return next.toDate().toISOString();
  }

  function onValueChange(next: DateRange): void {
    selection = { start: next.start, end: next.end };

    // Written back only once both ends are known, so a half-picked range is never the window
    if (next.start && next.end) {
      // Midnight opens the window and the last hour closes it, for an end that has no time yet
      from = applyDay(from, next.start, 0);
      to = applyDay(to, next.end, 23);
    }
  }
</script>

<!--
  The calendar of the custom time range. Two months side by side, because a window that spans a month
  boundary is the common one, and `maxDays` is the backend's own cap: a second click that would close
  an over-long window opens a new one instead, so `from` and `to` are never handed a pair /stats,
  /failures and /audit would answer 400 for.
-->
<RangeCalendarPrimitive.Root
  value={selection}
  {onValueChange}
  maxValue={ceiling}
  maxDays={MAX_RANGE_DAYS}
  numberOfMonths={2}
  weekdayFormat="short"
  weekStartsOn={1}
  locale="en-GB"
  class="cal"
  {calendarLabel}
>
  {#snippet children({ months, weekdays })}
    <RangeCalendarPrimitive.Header class="cal-h">
      <RangeCalendarPrimitive.PrevButton class="btn ghost sm cal-nav" aria-label="Previous month">
        ‹
      </RangeCalendarPrimitive.PrevButton>

      <RangeCalendarPrimitive.Heading class="cal-title" />

      <RangeCalendarPrimitive.NextButton class="btn ghost sm cal-nav" aria-label="Next month">
        ›
      </RangeCalendarPrimitive.NextButton>
    </RangeCalendarPrimitive.Header>

    <div class="cal-months">
      {#each months as month (month.value.toString())}
        <RangeCalendarPrimitive.Grid class="cal-grid">
          <RangeCalendarPrimitive.GridHead>
            <RangeCalendarPrimitive.GridRow class="cal-row">
              {#each weekdays as weekday (weekday)}
                <RangeCalendarPrimitive.HeadCell class="cal-wd">{weekday.slice(0, 2)}</RangeCalendarPrimitive.HeadCell>
              {/each}
            </RangeCalendarPrimitive.GridRow>
          </RangeCalendarPrimitive.GridHead>

          <RangeCalendarPrimitive.GridBody>
            {#each month.weeks as week, index (index)}
              <RangeCalendarPrimitive.GridRow class="cal-row">
                {#each week as date (date.toString())}
                  <RangeCalendarPrimitive.Cell {date} month={month.value} class="cal-cell">
                    <RangeCalendarPrimitive.Day class="cal-day" />
                  </RangeCalendarPrimitive.Cell>
                {/each}
              </RangeCalendarPrimitive.GridRow>
            {/each}
          </RangeCalendarPrimitive.GridBody>
        </RangeCalendarPrimitive.Grid>
      {/each}
    </div>
  {/snippet}
</RangeCalendarPrimitive.Root>
