// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Storage screen's state (contracts §7). One call - `GET /storage` (B4) - which reports the task
// hub's own storage: its taskhub.json, its queues, the partitions their leases belong to, and (only
// when asked) how many rows the two big tables hold. Counting those rows is a scan, so nothing here
// asks for it on a timer: the user does, once, and the answer is kept until they ask again.

import type { StorageResponse } from '$lib/api/types';
import { fmtAgo } from '$lib/format/time';
import type { AppState } from './app.svelte';

/** What the toast says when the one call this screen makes fails - as the Overview's panel says it. */
export const STORAGE_FAILED = 'Storage health failed';

/** How many rows the two big tables hold, once anything has counted them. */
export interface StorageCounts {
  instancesRows: number | null;
  historyRows: number | null;
  /** The count stopped at the backend's cap, so both numbers are lower bounds. */
  partial: boolean;
}

export interface StorageOptions {
  app: AppState;
}

export class Storage {
  /** What `/storage` answered, or null until it has. */
  response = $state<StorageResponse | null>(null);

  /**
   * The last row counts anyone asked for. They live outside the response because a plain refresh
   * does not ask for them - and a number that was true a minute ago beats an em dash that replaces
   * it every five seconds.
   */
  counts = $state<StorageCounts | null>(null);

  loading = $state(false);

  /** True only while the explicit, expensive count is running. */
  counting = $state(false);

  error = $state<string | null>(null);

  /** When the last load finished, which is what "refreshed 4 s ago" counts from. */
  loadedAt = $state<string | null>(null);

  readonly #app: AppState;

  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Set as soon as the call fails, cleared when it answers: one toast per outage, not per reload. */
  #reported = false;

  constructor(options: StorageOptions) {
    this.#app = options.app;
  }

  /** Without this capability there is no screen: the nav item is not there either (E2). */
  get supported(): boolean {
    return this.#app.capabilities.storageHealth;
  }

  /** The account the hub lives in. Azurite reports none, and then the hub names itself. */
  get accountName(): string {
    return this.response?.accountName || this.#app.about?.accountName || '';
  }

  get taskHub(): StorageResponse['taskHub'] | null {
    return this.response?.taskHub ?? null;
  }

  get tables(): StorageResponse['tables'] | null {
    return this.response?.tables ?? null;
  }

  get largeMessages(): StorageResponse['largeMessages'] | null {
    return this.response?.largeMessages ?? null;
  }

  /** The one queue activities wait in; null until the response is in. */
  get workitems(): StorageResponse['queues'][number] | null {
    return this.response?.queues.find((queue) => queue.kind === 'workitems') ?? null;
  }

  /** The control queues, in partition order rather than in whatever order they were listed. */
  get controlQueues(): StorageResponse['queues'] {
    return (this.response?.queues ?? [])
      .filter((queue) => queue.kind === 'control')
      .sort((left, right) => (left.partition ?? 0) - (right.partition ?? 0));
  }

  get partitions(): StorageResponse['partitions'] {
    return this.response?.partitions ?? [];
  }

  /** How many partitions a worker holds the lease of; the rest are unowned, not idle. */
  get ownedCount(): number {
    return this.partitions.filter((partition) => !!partition.owner).length;
  }

  /** Where the ownership above was read from; the partitions table says so in its footer. */
  get partitionSource(): 'table' | 'lease-blob' | 'none' {
    return this.partitions[0]?.source ?? 'none';
  }

  /**
   * `4 s ago`, ticking: it reads `app.now`, which the screen ticks every second while it is mounted
   * (the Overview and the workspace header do the same).
   */
  get refreshedAgo(): string {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    return fmtAgo(this.loadedAt, new Date(this.#app.now));
  }

  /**
   * The one call. `counts` is the expensive half - the backend scans both tables for it - so it is
   * sent only when something explicitly asks. Never throws: the screen keeps what it had and says
   * why it could not refresh.
   */
  async load(options: { counts?: boolean } = {}): Promise<void> {
    if (!this.supported) {
      // Not calling an endpoint the backend does not have is the whole point of the capability
      this.response = null;
      return;
    }

    const asked = options.counts ?? false;
    const requestId = ++this.#requestId;

    this.loading = true;
    this.counting = asked;

    try {
      const response = await this.#app.track(() => this.#app.endpoints.storage(asked ? { counts: true } : {}));

      if (requestId !== this.#requestId) {
        return;
      }

      this.response = response;
      this.loadedAt = response.generatedAt;
      this.error = null;
      this.#reported = false;

      // A refresh that did not ask for the counts brings none back; the last ones stand
      if (asked || response.counts.instancesRows !== null || response.counts.historyRows !== null) {
        this.counts = response.counts;
      }
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);

      if (!this.#reported) {
        this.#reported = true;
        this.#app.toast.fromError(STORAGE_FAILED, error, () => void this.load());
      }
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
        this.counting = false;
      }
    }
  }

  /** The Count rows button: the same call, with the scan the user just asked for. */
  async countRows(): Promise<void> {
    await this.load({ counts: true });
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
}
