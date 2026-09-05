// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The History tab's paging (E5-S1-T1). The backend answers one page at a time and reports no total,
// so a short page is the last page; the only filter it takes is a start time, which lives on the URL
// (contracts §4) and is pushed rather than replaced, so Back takes it off again.

import type { HistoryEvent } from '$lib/api/types';
import { buildHistoryFilter } from '$lib/filters/odata';
import type { AppState } from './app.svelte';

/** Rows per page, as React asked for them. */
export const HISTORY_PAGE_SIZE = 200;

export interface InstanceHistoryOptions {
  app: AppState;
  instanceId: string;
}

export class InstanceHistoryState {
  rows = $state<HistoryEvent[]>([]);
  hasMore = $state(false);
  loading = $state(false);

  /** The last error, so the tab can say why it is empty instead of showing nothing. */
  error = $state<string | null>(null);

  readonly instanceId: string;

  readonly #app: AppState;

  /** React's CancelToken: an answer is applied only while its request is still the current one. */
  #requestId = 0;

  constructor(options: InstanceHistoryOptions) {
    this.#app = options.app;
    this.instanceId = options.instanceId;
  }

  /** What the next page skips: everything already on screen. */
  get skip(): number {
    return this.rows.length;
  }

  /**
   * The moment the history is listed from, or null for all of it. Read from the route rather than
   * held here, so Back really does undo an Apply - the router's popstate handler is all it takes.
   */
  get timeFrom(): string | null {
    return this.#app.router.current.query.get('timeFrom') || null;
  }

  /** What the backend is asked to filter by (contracts §6). */
  get filter(): string {
    return buildHistoryFilter({ timeFrom: this.timeFrom });
  }

  /**
   * The rail's Apply. Pushed, not replaced (React `writeFilterToQueryString`): a start time is a step
   * the user took and expects Back to undo, unlike the list screens' filters.
   */
  setTimeFrom(iso: string | null): void {
    this.#app.router.setQuery({ timeFrom: iso }, { replace: false });
  }

  /** Page one, replacing what is on screen; `load(false)` appends the next page. */
  async load(reset = true): Promise<void> {
    const requestId = ++this.#requestId;
    const skip = reset ? 0 : this.rows.length;

    this.loading = true;
    this.error = null;

    try {
      const response = await this.#app.track(() =>
        this.#app.endpoints.getHistory(this.instanceId, { top: HISTORY_PAGE_SIZE, skip, filter: this.filter }),
      );

      if (requestId !== this.#requestId) {
        // A newer request is already on its way; this answer is about a filter nobody is looking at
        return;
      }

      const rows = response.history ?? [];

      this.rows = reset ? rows : [...this.rows, ...rows];

      // A short page is the last page: the backend reports no total (contracts §6)
      this.hasMore = rows.length === HISTORY_PAGE_SIZE;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);
      this.#app.toast.fromError('Failed to load history', error, () => void this.load(reset));
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }

  /** The next page, appended. */
  async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) {
      return;
    }

    await this.load(false);
  }
}
