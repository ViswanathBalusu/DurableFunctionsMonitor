// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Failures screen's state (contracts §7). One call - `/failures` (B3) - which the backend has
// already grouped and capped, so nothing here re-groups anything: the signature, the counts and the
// order are the provider's, and the screen shows what it was told.

import type { FailureGroup, FailuresResponse } from '$lib/api/types';
import { resolve } from '$lib/filters/time-range';
import { fmtInt } from '$lib/format/number';
import { SvelteSet } from 'svelte/reactivity';
import type { AppState } from './app.svelte';

/** What the toast says when the one call this screen makes fails. */
export const FAILURES_FAILED = 'Failures failed';

export interface FailuresOptions {
  app: AppState;
  /** The clock the range is resolved against, so a test can pin its window. */
  now?: () => number;
}

export class Failures {
  /** What `/failures` answered, or null until it has. */
  response = $state<FailuresResponse | null>(null);

  loading = $state(false);

  error = $state<string | null>(null);

  /** The keys of the groups that are expanded; the screen renders rows only for these. */
  readonly open = new SvelteSet<string>();

  readonly #app: AppState;
  readonly #now: () => number;

  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Set as soon as the call fails, cleared when it answers: one toast per outage, not per reload. */
  #reported = false;

  /**
   * Whether the user has opened or closed a group themselves. Until they have, a load opens the
   * first group (ScreenFailures.dc.html L96); afterwards what is open is theirs, and an auto-refresh
   * every few seconds must not keep re-opening something they closed.
   */
  #toggled = false;

  constructor(options: FailuresOptions) {
    this.#app = options.app;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Without this capability there is no screen: the nav item is not there either (E2). */
  get supported(): boolean {
    return this.#app.capabilities.failures;
  }

  get groups(): FailureGroup[] {
    return this.response?.groups ?? [];
  }

  get totalFailed(): number {
    return this.response?.totalFailed ?? 0;
  }

  /** Answered, and nothing failed in the range. */
  get isEmpty(): boolean {
    return !!this.response && this.groups.length === 0;
  }

  /** The backend stopped scanning at its cap, so every count on screen is a lower bound. */
  get partial(): boolean {
    return this.response?.partial ?? false;
  }

  /** `scanned 12,408 · full` - the right half of the title row (L21). */
  get scannedLabel(): string {
    if (!this.response) {
      return '—';
    }

    return `scanned ${fmtInt(this.response.scanned)} · ${this.response.partial ? 'partial' : 'full'}`;
  }

  /** `9 failed in 3 groups` (L20), which is also what the title row reads out as one sentence. */
  get summary(): string {
    const groups = this.groups.length;

    return `${fmtInt(this.totalFailed)} failed in ${groups} group${groups === 1 ? '' : 's'}`;
  }

  isOpen(key: string): boolean {
    return this.open.has(key);
  }

  /** The group header's toggle. From here on, what is open is the user's business, not a default. */
  toggle(key: string): void {
    this.#toggled = true;

    if (!this.open.delete(key)) {
      this.open.add(key);
    }
  }

  /**
   * The one call. Never throws: the screen keeps whatever it had and says why it could not refresh,
   * which is the same thing the other screens do with a part that is down.
   */
  async load(): Promise<void> {
    if (!this.supported) {
      // Not calling an endpoint the backend does not have is the whole point of the capability
      this.response = null;
      return;
    }

    const requestId = ++this.#requestId;

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));

    this.loading = true;

    try {
      const response = await this.#app.track(() =>
        this.#app.endpoints.failures({ from: from.toISOString(), to: to.toISOString() }),
      );

      if (requestId !== this.#requestId) {
        return;
      }

      this.response = response;
      this.error = null;
      this.#reported = false;
      this.#applyOpen(response.groups);

      // The nav badge counts what this screen counted, whichever of the two asked first (E9-S1-T1.2)
      this.#app.failuresCount = response.totalFailed;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);

      if (!this.#reported) {
        this.#reported = true;
        this.#app.toast.fromError(FAILURES_FAILED, error, () => void this.load());
      }
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
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

  /**
   * Keeps what is open open, drops groups that are no longer there, and - only while the user has
   * not touched a group themselves - opens the first one, which is the biggest.
   */
  #applyOpen(groups: FailureGroup[]): void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a lookup for this call, not state
    const keys = new Set(groups.map((group) => group.key));

    for (const key of [...this.open]) {
      if (!keys.has(key)) {
        this.open.delete(key);
      }
    }

    if (!this.#toggled && this.open.size === 0 && groups.length > 0) {
      this.open.add(groups[0].key);
    }
  }
}
