// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Overview screen's state (contracts §7). The screen is a handful of independent loads: /stats is
// the screen itself, /storage and /audit are two panels of it, and /function-map is one chip in a
// table. A backend that cannot serve those - or that fails to - must not take the screen with it.

import type { AuditRow, FunctionMapResponse, StatsResponse, StorageResponse } from '$lib/api/types';
import { resolve } from '$lib/filters/time-range';
import { buildFunctionGraph } from '$lib/graph/function-graph-model';
import { fmtInt } from '$lib/format/number';
import { fmtAgo } from '$lib/format/time';
import type { AppState } from './app.svelte';

/** How many columns the throughput chart cuts the range into (ScreenOverview.dc.html L40). */
export const OVERVIEW_BINS = 48;

/** How many audit rows the Recent activity panel asks for (ScreenOverview.dc.html L103). */
export const RECENT_ACTIVITY_ROWS = 4;

/** What the screen says instead of itself on a backend without /stats. */
export const NO_STATS_TITLE = 'Overview needs the stats endpoint';
export const NO_STATS_TEXT =
  'This backend does not report hub statistics. Instances, Entities and Settings work without it.';

/** What the screen says when /stats answered with an error, in place of the numbers it has not got. */
export const STATS_FAILED_TITLE = 'Statistics could not be loaded';

export interface OverviewOptions {
  app: AppState;
  /** The clock the range is resolved against, so a test can pin its window. */
  now?: () => number;
}

/** The loads that report a failure, named for the toast that does it. */
type Part = 'stats' | 'storage' | 'audit';

const PART_TITLES: Readonly<Record<Part, string>> = {
  stats: 'Statistics failed',
  storage: 'Storage health failed',
  audit: 'Recent activity failed',
};

export class Overview {
  /** What /stats answered, or null until it has. */
  stats = $state<StatsResponse | null>(null);

  /** The Backlog panel's data; null without the capability, or when the call failed. */
  storage = $state<StorageResponse | null>(null);

  /** The Recent activity panel's rows, newest first as the backend orders them. */
  activity = $state<AuditRow[]>([]);

  /**
   * The hub's function map, when the host publishes one. Nothing on this screen is drawn from the
   * graph, but the map is the only thing that can say which orchestrators run inside another one,
   * which is the chip the Top orchestrators table carries.
   */
  functionMap = $state<FunctionMapResponse | null>(null);

  /** True while any of them is in flight. */
  loading = $state(false);

  /** The /stats error. The two panels report their own by simply not being on screen. */
  error = $state<string | null>(null);

  /** When the last load finished, which is what "refreshed 4 s ago" counts from. */
  loadedAt = $state<string | null>(null);

  /**
   * The shared time range the numbers on screen were loaded for, as a comparable string. The range
   * lives outside this state (it is the app's), so a change from the top bar has to be noticed
   * rather than announced - the same watch the Instances screen keeps.
   */
  loadedRangeKey = $state('');

  readonly #app: AppState;
  readonly #now: () => number;

  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Which parts have already reported a failure. An endpoint that is down stays down, and an
   * auto-refresh every five seconds must not say so every five seconds; the flag is cleared as soon
   * as the part answers again.
   */
  #reported: Record<string, boolean> = {};

  constructor(options: OverviewOptions) {
    this.#app = options.app;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Without this capability there is no Overview to draw, only the empty state that says so. */
  get supported(): boolean {
    return this.#app.capabilities.stats;
  }

  /** Stats answered, and the hub has nothing in the range - neither orchestrations nor entities. */
  get isEmpty(): boolean {
    const totals = this.stats?.totals;

    return !!totals && totals.all === 0 && totals.entities === 0;
  }

  /** The backend stopped counting at its cap, so every number on screen is a lower bound. */
  get partial(): boolean {
    return this.stats?.partial ?? false;
  }

  /** The orchestrators another orchestrator calls (E5-S6-T1's classification, not a rule of its own). */
  get subOrchestrators(): string[] {
    return buildFunctionGraph(this.functionMap)
      .nodes.filter((node) => node.kind === 'suborchestrator')
      .map((node) => node.name);
  }

  /** `12,408 (full)` / `50,000 (partial)` - the right half of the title meta. */
  get scannedLabel(): string {
    if (!this.stats) {
      return '—';
    }

    return `${fmtInt(this.stats.scanned)} (${this.stats.partial ? 'partial' : 'full'})`;
  }

  /**
   * `refreshed 4 s ago`, ticking: it reads `app.now`, which the screen ticks every second while it
   * is mounted (the workspace header does the same).
   */
  get refreshedAgo(): string {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    return fmtAgo(this.loadedAt, new Date(this.#app.now));
  }

  /**
   * The calls, started together and finished apart. Nothing here rethrows: each part reports its own
   * failure and leaves the others alone, which is what makes a 500 from /storage a missing panel
   * rather than a missing screen.
   */
  async load(): Promise<void> {
    if (!this.supported) {
      // Not calling an endpoint the backend does not have is the whole point of the capability
      this.stats = null;
      return;
    }

    const requestId = ++this.#requestId;

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));

    this.loadedRangeKey = JSON.stringify(this.#app.timeRange);
    this.loading = true;

    await Promise.all([
      this.#loadStats(requestId, from.toISOString(), to.toISOString()),
      this.#loadStorage(requestId),
      this.#loadAudit(requestId, from.toISOString(), to.toISOString()),
      this.#loadFunctionMap(),
    ]);

    if (requestId !== this.#requestId) {
      return;
    }

    this.loading = false;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- an ISO string, not reactive state
    this.loadedAt = new Date(this.#now()).toISOString();
  }

  /** Starts (or restarts) the timer for the interval in the preferences; 0 turns it off. */
  startAutoRefresh(): void {
    this.stopAutoRefresh();

    const seconds = this.#app.autoRefreshSeconds('instances');

    if (seconds > 0) {
      this.#timer = setInterval(() => void this.load(), seconds * 1000);
    }
  }

  stopAutoRefresh(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #loadStats(requestId: number, from: string, to: string): Promise<void> {
    const thresholds = this.#app.prefs.thresholds;

    try {
      const stats = await this.#app.track(() =>
        this.#app.endpoints.stats({
          from,
          to,
          bins: OVERVIEW_BINS,
          stuckAfterMinutes: thresholds.stuckMinutes,
          pendingAfterMinutes: thresholds.pendingMinutes,
        }),
      );

      if (requestId !== this.#requestId) {
        return;
      }

      this.stats = stats;
      this.error = null;
      this.#reported.stats = false;
    } catch (error) {
      if (requestId === this.#requestId) {
        this.error = error instanceof Error ? error.message : String(error);
        // The numbers on screen were counted over a range that is no longer the one in the title;
        // keeping them would put the last range's totals under this range's label
        this.stats = null;
      }

      this.#fail(requestId, 'stats', error, () => void this.load());
    }
  }

  async #loadStorage(requestId: number): Promise<void> {
    if (!this.#app.capabilities.storageHealth) {
      this.storage = null;
      return;
    }

    try {
      const storage = await this.#app.track(() => this.#app.endpoints.storage());

      if (requestId !== this.#requestId) {
        return;
      }

      this.storage = storage;
      this.#reported.storage = false;
    } catch (error) {
      // The panel goes; the screen stays. Keeping the numbers of a call that failed would be worse
      if (requestId === this.#requestId) {
        this.storage = null;
      }

      this.#fail(requestId, 'storage', error);
    }
  }

  async #loadAudit(requestId: number, from: string, to: string): Promise<void> {
    if (!this.#app.capabilities.audit) {
      this.activity = [];
      return;
    }

    try {
      const audit = await this.#app.track(() => this.#app.endpoints.audit({ from, to, top: RECENT_ACTIVITY_ROWS }));

      if (requestId !== this.#requestId) {
        return;
      }

      this.activity = audit.rows;
      this.#reported.audit = false;
    } catch (error) {
      if (requestId === this.#requestId) {
        this.activity = [];
      }

      this.#fail(requestId, 'audit', error);
    }
  }

  /**
   * The map, once. It does not depend on the range and does not change while the app is open, and a
   * map that cannot be fetched costs one chip - which is not worth a toast, let alone one per reload.
   */
  async #loadFunctionMap(): Promise<void> {
    if (!this.#app.host.functionGraphAvailable || this.functionMap) {
      return;
    }

    try {
      this.functionMap = await this.#app.track(() => this.#app.endpoints.functionMap());
    } catch {
      this.functionMap = null;
    }
  }

  /** One toast per part per outage, and none at all for an answer nobody is waiting for. */
  #fail(requestId: number, part: Part, error: unknown, retry?: () => void): void {
    if (requestId !== this.#requestId || this.#reported[part]) {
      return;
    }

    this.#reported[part] = true;
    this.#app.toast.fromError(PART_TITLES[part], error, retry);
  }
}
