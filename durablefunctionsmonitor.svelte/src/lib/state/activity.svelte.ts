// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Activity screen's state (contracts §7). One call - `/audit` (B5) - which the backend has
// already ordered (newest first), filtered and paged, so nothing here re-orders anything. The two
// filters are the global time range and one operation name, both in the URL; `enabled` is the
// backend saying whether it is recording at all, which is a different thing from an empty range.

import type { AuditRow } from '$lib/api/types';
import { label, resolve } from '$lib/filters/time-range';
import { fmtInt } from '$lib/format/number';
import type { AppState } from './app.svelte';

/** What the toast says when the one call this screen makes fails. */
export const ACTIVITY_FAILED = 'Activity failed';

/** The first entry of the operation select, and the only one that is not an operation name. */
export const ALL_OPERATIONS = 'All operations';

/** Rows per page, as contracts §6 asks `/audit` for (its own default, and its cap is 500). */
export const PAGE_SIZE = 100;

/**
 * The eight actions the batch endpoint runs (`OrchestrationActionNames.All`). Each one is audited
 * under its own name - `Batch terminate`, not `Batch` - because the batch function refines the
 * operation of its record (`Functions/Batch.cs`), and `/audit` matches the name exactly.
 */
export const BATCH_ACTIONS: readonly string[] = [
  'suspend',
  'resume',
  'purge',
  'rewind',
  'terminate',
  'raise-event',
  'set-custom-status',
  'restart',
];

/**
 * Every operation name the middleware can write (`Common/AuditOperations.cs`), in the order the
 * screen offers them: the instance operations first, then the hub-wide ones. The filter is an exact
 * match on the stored name, so this list is the backend's, not a prettier version of it.
 */
export const OPERATIONS: readonly string[] = [
  'Terminate',
  'Rewind',
  'Replay',
  'Update input and rewind',
  'Restart in place',
  'Raise event',
  'Purge',
  'Suspend',
  'Resume',
  'Restart',
  'Set customStatus',
  'Start new instance',
  ...BATCH_ACTIONS.map((action) => `Batch ${action}`),
  'Purge history',
  'Clean entity storage',
  'Delete task hub',
];

export interface ActivityOptions {
  app: AppState;
  /** The clock the range is resolved against, so a test can pin its window. */
  now?: () => number;
}

export class Activity {
  rows = $state<AuditRow[]>([]);

  hasMore = $state(false);

  loading = $state(false);

  /** Whether a load has ever answered; until one has, an empty table is unasked, not empty. */
  loaded = $state(false);

  /**
   * What the backend said about auditing itself: null until it has said anything. False is not an
   * error - it is an installation that never turned auditing on, and gets its own empty state.
   */
  enabled = $state<boolean | null>(null);

  error = $state<string | null>(null);

  readonly #app: AppState;
  readonly #now: () => number;

  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Set as soon as a load fails, cleared when one answers: one toast per outage, not per reload. */
  #reported = false;

  constructor(options: ActivityOptions) {
    this.#app = options.app;
    this.#now = options.now ?? (() => Date.now());
  }

  // ---------------------------------------------------------------- the filters (contracts §4)

  /** The operation to filter by, or `All operations` - which is no filter, not an operation. */
  get operation(): string {
    const asked = this.#app.router.current.query.get('operation');

    return asked && OPERATIONS.includes(asked) ? asked : ALL_OPERATIONS;
  }

  setOperation(operation: string): void {
    this.#app.router.setQuery({ operation: operation === ALL_OPERATIONS ? null : operation });
  }

  /** `last 24 hours` - the range as the empty state names it in the middle of a sentence. */
  get rangeLower(): string {
    return label(this.#app.timeRange).toLowerCase();
  }

  // ---------------------------------------------------------------- what the screen reads

  /** Without this capability there is nothing to read: the nav item is not there either (E2). */
  get supported(): boolean {
    return this.#app.capabilities.audit;
  }

  /**
   * Whether nothing is being recorded at all - the capability is off, or the backend answered that
   * auditing is. Either way the table is empty because there is no audit trail, which is what the
   * empty state has to say instead of "nothing happened".
   */
  get auditingOff(): boolean {
    return !this.supported || this.enabled === false;
  }

  /**
   * Answered, and the range holds nothing. A reload does not take it back: the rows on screen stay
   * while the next answer is on its way.
   */
  get isEmpty(): boolean {
    return this.loaded && this.rows.length === 0;
  }

  /** `24 entries` - the right half of the title row (ScreenActivity.dc.html L21). */
  get countLabel(): string {
    return `${fmtInt(this.rows.length)}${this.hasMore ? '+' : ''} entries`;
  }

  // ---------------------------------------------------------------- loading

  /** Page one, replacing what is on screen. */
  async load(): Promise<void> {
    await this.#load({ append: false });
  }

  /** The next page, appended. */
  async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) {
      return;
    }

    await this.#load({ append: true });
  }

  /** Starts (or restarts) the timer for the interval in the preferences; 0 turns it off. */
  startAutoRefresh(): void {
    this.stopAutoRefresh();

    const seconds = this.#app.autoRefreshSeconds('instances');

    if (seconds > 0) {
      // The first page, which is where what just happened shows up - not the pages below it
      this.#timer = setInterval(() => void this.load(), seconds * 1000);
    }
  }

  stopAutoRefresh(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #load(options: { append: boolean }): Promise<void> {
    if (!this.supported) {
      // Not calling an endpoint the backend does not have is the whole point of the capability
      this.rows = [];
      this.hasMore = false;
      this.loaded = true;
      return;
    }

    const requestId = ++this.#requestId;
    const skip = options.append ? this.rows.length : 0;

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));
    const operation = this.operation;

    this.loading = true;

    try {
      const response = await this.#app.track(() =>
        this.#app.endpoints.audit({
          from: from.toISOString(),
          to: to.toISOString(),
          operation: operation === ALL_OPERATIONS ? undefined : operation,
          top: PAGE_SIZE,
          skip,
        }),
      );

      if (requestId !== this.#requestId) {
        // A newer request is already on its way; this answer is about filters nobody is looking at
        return;
      }

      this.rows = options.append ? [...this.rows, ...response.rows] : response.rows;
      this.hasMore = response.hasMore;
      this.enabled = response.enabled;
      this.loaded = true;
      this.error = null;
      this.#reported = false;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);

      if (!this.#reported) {
        this.#reported = true;
        this.#app.toast.fromError(ACTIVITY_FAILED, error, () => void this.load());
      }
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }
}
