// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Instances screen's Histogram view (React `ResultsHistogramTabState`): how many instances
// started when, stacked by orchestrator. It counts rather than lists - the backend has no aggregate
// for this - so it walks the filtered list a thousand rows at a time and bins what comes back,
// saying how far it has got while it does. Brushing the chart narrows the shared time range, which
// is React's `applyZoom`, and `Reset zoom` puts back the range that was in force before.

import type { OrchestrationStatus } from '$lib/api/types';
import type { ChartBin, ChartSeries, Range } from '$lib/charts/stacked-columns';
import { resolve, type TimeRange } from '$lib/filters/time-range';
import { fmtDuration } from '$lib/format/duration';
import { displayName } from '$lib/instances/columns';
import type { AppState } from './app.svelte';
import type { Instances } from './instances.svelte';

/** One page of the walk, as React sized it. */
export const HISTOGRAM_PAGE_SIZE = 1000;

/** How many columns the range is cut into. */
export const HISTOGRAM_BINS = 48;

/** Orchestrators that get a colour of their own; everything else is added up as `other`. */
export const HISTOGRAM_TOP_SERIES = 5;

/** The series key the tail of the list is merged into. */
export const OTHER_SERIES = 'other';

/** Counting needs the name and the creation time, and nothing else the row carries. */
const HISTOGRAM_HIDDEN_COLUMNS = ['input', 'output', 'customStatus'];

export interface InstancesHistogramOptions {
  app: AppState;
  instances: Instances;
  now?: () => number;
}

export class InstancesHistogram {
  /** Per orchestrator name, one count per bin. */
  counts = $state<Record<string, number[]>>({});

  /** How many rows have been counted so far; the meta line reads it while the walk runs. */
  scanned = $state(0);

  loading = $state(false);
  error = $state<string | null>(null);

  /** The window the bins were cut from, fixed at load. */
  windowFrom = $state(0);
  binMs = $state(1);

  /** What `Reset zoom` goes back to: the range that was in force before the brush narrowed it. */
  rangeBeforeZoom = $state<TimeRange | null>(null);

  readonly #app: AppState;
  readonly #instances: Instances;
  readonly #now: () => number;

  #requestId = 0;

  constructor(options: InstancesHistogramOptions) {
    this.#app = options.app;
    this.#instances = options.instances;
    this.#now = options.now ?? (() => Date.now());
  }

  get zoomedIn(): boolean {
    return this.rangeBeforeZoom !== null;
  }

  /** The series, biggest first, five of them plus `other` (contracts §10 colours). */
  get series(): ChartSeries[] {
    const ranked = Object.entries(this.counts)
      .map(([name, bins]) => ({ name, total: bins.reduce((sum, count) => sum + count, 0) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const series: ChartSeries[] = ranked
      .slice(0, HISTOGRAM_TOP_SERIES)
      .map((item, index) => ({ key: item.name, label: item.name, color: `chart-${index + 1}` }));

    if (ranked.length > HISTOGRAM_TOP_SERIES) {
      series.push({ key: OTHER_SERIES, label: OTHER_SERIES, color: 'muted' });
    }

    return series;
  }

  get bins(): ChartBin[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup, recomputed each read
    const named = new Set(this.series.map((item) => item.key));

    return Array.from({ length: HISTOGRAM_BINS }, (_, index) => {
      const values: Record<string, number> = {};

      for (const [name, counts] of Object.entries(this.counts)) {
        const count = counts[index] ?? 0;

        if (count === 0) {
          continue;
        }

        const key = named.has(name) ? name : OTHER_SERIES;
        values[key] = (values[key] ?? 0) + count;
      }

      return {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bin edges are values, not state
        start: new Date(this.windowFrom + index * this.binMs),
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- as above
        end: new Date(this.windowFrom + (index + 1) * this.binMs),
        values,
      };
    });
  }

  /** `Instances per 30 min by orchestrator` - the aria label, and what the columns mean. */
  get ariaLabel(): string {
    return `Instances per ${fmtDuration(this.binMs)} by orchestrator`;
  }

  /**
   * Walks the filtered list, page by page, until a short page says there is no more. A newer load
   * (a filter change, a zoom) makes this one stop where it is: its rows would be counted into a
   * window nobody is looking at.
   */
  async load(): Promise<void> {
    const requestId = ++this.#requestId;

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));

    // The filter is resolved once: a preset range ends at "now", and a second page asking for a
    // slightly later "now" would page through a list that had moved under it
    const filter = this.#instances.filter;

    this.windowFrom = from.getTime();
    this.binMs = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / HISTOGRAM_BINS));
    this.counts = {};
    this.scanned = 0;
    this.loading = true;
    this.error = null;

    try {
      for (;;) {
        const rows = await this.#app.track(() =>
          this.#app.endpoints.listOrchestrations({
            filter,
            top: HISTOGRAM_PAGE_SIZE,
            skip: this.scanned,
            hiddenColumns: HISTOGRAM_HIDDEN_COLUMNS,
          }),
        );

        if (requestId !== this.#requestId) {
          return;
        }

        this.#count(rows);
        this.scanned += rows.length;

        if (rows.length < HISTOGRAM_PAGE_SIZE) {
          return;
        }
      }
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);
      this.#app.toast.fromError('Load failed', error, () => void this.load());
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }

  /**
   * The brush: the shared time range becomes the window that was brushed, rounded outwards to whole
   * seconds (React `applyZoom`), which reloads every screen that reads the range.
   */
  zoom(range: Range): void {
    const from = Math.floor(range.from.getTime() / 1000) * 1000;
    const to = Math.ceil(range.to.getTime() / 1000) * 1000;

    // Only the first zoom is remembered: two brushes in a row still go back to where the user was
    this.rangeBeforeZoom ??= this.#app.timeRange;

    /* eslint-disable svelte/prefer-svelte-reactivity -- formatting two numbers as ISO strings */
    this.#app.setTimeRange({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    /* eslint-enable svelte/prefer-svelte-reactivity */
  }

  resetZoom(): void {
    const previous = this.rangeBeforeZoom;

    if (!previous) {
      return;
    }

    this.rangeBeforeZoom = null;
    this.#app.setTimeRange(previous);
  }

  #count(rows: OrchestrationStatus[]): void {
    for (const row of rows) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- parsing the row's ISO string
      const index = Math.floor((new Date(row.createdTime).getTime() - this.windowFrom) / this.binMs);

      if (index < 0 || index >= HISTOGRAM_BINS) {
        // Outside the window the bins were cut from: the backend filters by time, but a provider
        // that rounds, or a clock that skews, can still hand back an edge case
        continue;
      }

      const name = displayName(row);

      this.counts[name] ??= Array.from({ length: HISTOGRAM_BINS }, () => 0);
      this.counts[name][index] += 1;
    }
  }
}
