// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What the Purge instance history dialog holds (E6-S2-T2), ported from React's
// PurgeHistoryDialogState: a created-time range, the runtime statuses to match, and whether the
// purge is about orchestrations or durable entities. The count the backend answers with is kept so
// the dialog can say what it did, which is the only report of a purge there is.

import type { EntityType, RuntimeStatus } from '$lib/api/types';
import { resolve, type TimeRange } from '$lib/filters/time-range';
import type { AppState } from './app.svelte';

/** The four statuses a purge can match, in the order the dialog shows them (mockup L102). */
export const PURGE_STATUSES: readonly RuntimeStatus[] = ['Completed', 'Terminated', 'Failed', 'Canceled'];

/** Checked when the dialog opens (mockup L130). Failed is deliberately not: it is the one a purge is most likely to want to keep. */
export const DEFAULT_PURGE_STATUSES: readonly RuntimeStatus[] = ['Completed', 'Terminated', 'Canceled'];

/** How far back the range starts: React's `moment().subtract(1, 'days')`. */
export const PURGE_DEFAULT_RANGE: TimeRange = { preset: '24h' };

export interface PurgeHistoryOptions {
  app: AppState;
}

/** Whether a value from a date field is an instant the backend can be sent. */
function isValidInstant(value: string | null): boolean {
  return !!value && !Number.isNaN(new Date(value).getTime());
}

export class PurgeHistory {
  /** ISO 8601 UTC, as the date fields report them. */
  timeFrom = $state<string | null>(null);

  timeTill = $state<string | null>(null);

  statuses = $state<RuntimeStatus[]>([...DEFAULT_PURGE_STATUSES]);

  /** Purges durable entities instead of orchestrations - the backend takes one or the other. */
  includeEntities = $state(false);

  busy = $state(false);

  /** How many instances the last run removed; null until one has. */
  result = $state<number | null>(null);

  readonly #app: AppState;

  constructor(options: PurgeHistoryOptions) {
    this.#app = options.app;
    this.reset();
  }

  /** The last 24 hours, the default statuses, no result: what every opening of the dialog starts from. */
  reset(now?: Date): void {
    const { from, to } = resolve(PURGE_DEFAULT_RANGE, now);

    this.timeFrom = from.toISOString();
    this.timeTill = to.toISOString();
    this.statuses = [...DEFAULT_PURGE_STATUSES];
    this.includeEntities = false;
    this.busy = false;
    this.result = null;
  }

  get entityType(): EntityType {
    return this.includeEntities ? 'DurableEntity' : 'Orchestration';
  }

  has(status: RuntimeStatus): boolean {
    return this.statuses.includes(status);
  }

  /** Kept in the order of PURGE_STATUSES, so what is sent does not depend on the order of clicks. */
  toggle(status: RuntimeStatus, included: boolean): void {
    const next = included ? [...this.statuses, status] : this.statuses.filter((candidate) => candidate !== status);

    this.statuses = PURGE_STATUSES.filter((candidate) => next.includes(candidate));
  }

  /** A purge with no status matches nothing, and a range the backend cannot read is not a range. */
  get valid(): boolean {
    return this.statuses.length > 0 && isValidInstant(this.timeFrom) && isValidInstant(this.timeTill);
  }

  /**
   * `POST /purge-history`. The dialog stays open afterwards holding the count: a purge cannot be
   * undone and cannot be counted beforehand, so how many instances went is the whole report.
   */
  async run(): Promise<number | null> {
    if (!this.valid || this.busy) {
      return null;
    }

    this.busy = true;

    try {
      const { instancesDeleted } = await this.#app.track(() =>
        this.#app.endpoints.purgeHistory({
          timeFrom: this.timeFrom as string,
          timeTill: this.timeTill as string,
          statuses: [...this.statuses],
          entityType: this.entityType,
        }),
      );

      this.result = instancesDeleted;
      this.#app.toast.ok(`Purged ${instancesDeleted} instances`);

      // Whatever list is on screen counted instances that are no longer there
      this.#app.refresh();

      return instancesDeleted;
    } catch (error) {
      // The dialog stays open with the filter still in it, so it can be corrected and sent again
      this.#app.toast.fromError('Failed to purge history', error);

      return null;
    } finally {
      this.busy = false;
    }
  }
}
