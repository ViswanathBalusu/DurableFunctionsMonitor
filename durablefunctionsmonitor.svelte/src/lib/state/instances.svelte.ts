// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Instances screen's state (contracts §7): what is being filtered, what has been loaded, and
// what is selected. Every filter is mirrored to the URL (contracts §4), so a link carries the whole
// view; the loader is React's CancelToken pattern - a response is applied only while its request is
// still the current one.

import type { Endpoints } from '$lib/api/endpoints';
import type { OrchestrationStatus, RuntimeStatus, StatsByName } from '$lib/api/types';
import { buildInstancesFilter, columnPredicate, type FilterOperator } from '$lib/filters/odata';
import { label as rangeLabel, resolve } from '$lib/filters/time-range';
import { fmtInt } from '$lib/format/number';
import { ViewStateStorage } from '$lib/storage/view-state-storage';
import type { ITypedLocalStorage } from '$lib/storage/typed-local-storage';
import type { AppState } from './app.svelte';
import { Selection } from './selection.svelte';

export type InstancesView = 'table' | 'timeline' | 'histogram';

export type SortDirection = 'asc' | 'desc';

/** Rows per page, as React asked for them. */
export const PAGE_SIZE = 50;

/** How long the orchestrator names of the facet stay fresh (decision D10's window). */
export const NAME_CACHE_MS = 30_000;

/**
 * Hidden by default (React `filteredOutColumns`). Only the first three mean anything to the
 * backend - `hidden-columns` makes it leave those payloads out of the response - the other two are
 * hidden in the table alone.
 */
export const DEFAULT_HIDDEN_COLUMNS = ['input', 'output', 'parentInstanceId', 'lastEvent'];

/** The columns `hidden-columns` can actually drop from the wire (contracts §6). */
const OMITTABLE_COLUMNS = ['input', 'output', 'customStatus'];

/** The columns a free filter can be written against, in the order the rail lists them. */
export const FILTER_COLUMNS = [
  'instanceId',
  'name',
  'runtimeStatus',
  'input',
  'output',
  'customStatus',
  'lastEvent',
  'parentInstanceId',
];

/** The fields this screen keeps in the URL and in `dfm.view.instances::*`. */
export interface InstancesViewState {
  status: string;
  name: string;
  col: string;
  op: string;
  val: string;
  entities: string;
  view: string;
  orderby: string;
  dir: string;
  hidden: string;
}

export interface InstancesOptions {
  app: AppState;
  /** Defaults to `ViewStateStorage('instances')`; a test passes its own. */
  storage?: ITypedLocalStorage<InstancesViewState>;
  /** The clock the time range is resolved against, so a test can pin its window. */
  now?: () => number;
}

export class Instances {
  // Filters (mirrored to the URL)
  statuses = $state<RuntimeStatus[]>([]);
  names = $state<string[]>([]);
  column = $state('instanceId');
  op = $state<FilterOperator>('StartsWith');
  /** What is in the field. */
  value = $state('');
  /** What is in force; the two differ while the user is typing. */
  applied = $state('');
  includeEntities = $state(false);
  view = $state<InstancesView>('table');
  orderBy = $state('createdTime');
  dir = $state<SortDirection>('desc');
  hiddenColumns = $state<string[]>([...DEFAULT_HIDDEN_COLUMNS]);

  // The page
  rows = $state<OrchestrationStatus[]>([]);
  skip = $state(0);
  hasMore = $state(false);
  loading = $state(false);
  /** The last error, so the screen can show it instead of an empty table. */
  error = $state<string | null>(null);

  /** The orchestrator names the facet offers, from /stats; empty without the capability. */
  nameOptions = $state<StatsByName[]>([]);

  readonly selection = new Selection();

  readonly #app: AppState;
  readonly #storage: ITypedLocalStorage<InstancesViewState>;
  readonly #now: () => number;

  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #namesLoadedAt = 0;

  constructor(options: InstancesOptions) {
    this.#app = options.app;
    this.#storage = options.storage ?? new ViewStateStorage<InstancesViewState>('instances', options.app.host);
    this.#now = options.now ?? (() => Date.now());

    this.#readViewState();
  }

  get endpoints(): Endpoints {
    return this.#app.endpoints;
  }

  /** `1,204 loaded · Last 24 hours` while there is more, `… match · …` once the list is complete. */
  get matchLabel(): string {
    const range = rangeLabel(this.#app.timeRange);

    return `${fmtInt(this.rows.length)} ${this.hasMore ? 'loaded' : 'match'} · ${range}`;
  }

  /** True when anything at all is filtering the list, which is what "Clear all" is offered for. */
  get hasFilters(): boolean {
    return this.statuses.length > 0 || this.names.length > 0 || !!this.applied || this.includeEntities;
  }

  /**
   * The columns the table actually hides. A column being filtered on is shown even when it is in
   * the hidden list (React `filteredOutColumns`): filtering on something invisible reads as a
   * broken filter.
   */
  get effectiveHiddenColumns(): string[] {
    return this.hiddenColumns.filter((column) => !(this.applied && column === this.column));
  }

  /** What the current filters ask the backend for (contracts §6). */
  get filter(): string {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function, not state
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));

    const clause = buildInstancesFilter({
      from: from.toISOString(),
      to: to.toISOString(),
      statuses: this.statuses,
      includeEntities: this.includeEntities,
      column: this.column,
      op: this.op,
      value: this.applied,
    });

    // The orchestrator facet is a second predicate, written as the same `in` list the rail writes
    const byName = this.names.length > 0 ? columnPredicate('name', 'In', this.names.join(',')) : '';

    return byName ? `${clause} and ${byName}` : clause;
  }

  get orderByClause(): string {
    return this.dir === 'desc' ? `${this.orderBy} desc` : this.orderBy;
  }

  /** Page one, replacing whatever is on screen. */
  async reload(): Promise<void> {
    this.skip = 0;
    await this.#load({ append: false });
  }

  /** The next page, appended. */
  async loadMore(): Promise<void> {
    if (this.loading || !this.hasMore) {
      return;
    }

    await this.#load({ append: true });
  }

  /**
   * The auto-refresh tick: page one, replacing the rows. A failure stops the timer and toasts with
   * a Retry - React did exactly this, because a refresh that keeps failing every five seconds is
   * worse than one that stops and says so.
   */
  async refresh(): Promise<void> {
    await this.#load({ append: false });
  }

  /** Starts (or restarts) the timer for the interval in the preferences; 0 turns it off. */
  startAutoRefresh(): void {
    this.stopAutoRefresh();

    const seconds = this.#app.autoRefreshSeconds('instances');

    if (seconds > 0) {
      this.#timer = setInterval(() => void this.refresh(), seconds * 1000);
    }
  }

  stopAutoRefresh(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * The orchestrator names for the facet, from /stats over the current range. Cached for 30 s
   * (decision D10), and simply empty when the backend has no /stats: the facet then offers a field
   * to type a name into instead of a list to pick from.
   */
  async loadNameOptions(): Promise<void> {
    if (!this.#app.capabilities.stats) {
      this.nameOptions = [];
      return;
    }

    if (this.#now() - this.#namesLoadedAt < NAME_CACHE_MS && this.nameOptions.length > 0) {
      return;
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function, not state
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));

    try {
      const stats = await this.#app.track(() =>
        this.endpoints.stats({ from: from.toISOString(), to: to.toISOString() }),
      );

      this.nameOptions = stats.byName;
      this.#namesLoadedAt = this.#now();
    } catch {
      // A facet that cannot be filled is not worth a toast: the user can still type the name
      this.nameOptions = [];
    }
  }

  // Filter setters. Each writes the URL and reloads from page one, which is the only way the list
  // and the address bar can stay in step.

  setStatuses(statuses: RuntimeStatus[]): void {
    this.statuses = [...statuses];
    this.#apply();
  }

  toggleStatus(status: RuntimeStatus): void {
    this.setStatuses(
      this.statuses.includes(status) ? this.statuses.filter((item) => item !== status) : [...this.statuses, status],
    );
  }

  setNames(names: string[]): void {
    this.names = [...names];
    this.#apply();
  }

  toggleName(name: string): void {
    this.setNames(this.names.includes(name) ? this.names.filter((item) => item !== name) : [...this.names, name]);
  }

  /** The free filter: the typed value only takes effect here. */
  applyFilter(column: string, op: FilterOperator, value: string): void {
    this.column = column;
    this.op = op;
    this.value = value;
    this.applied = value;
    this.#apply();
  }

  clearFilter(): void {
    this.value = '';
    this.applied = '';
    this.#apply();
  }

  setIncludeEntities(include: boolean): void {
    this.includeEntities = include;
    this.#apply();
  }

  setView(view: InstancesView): void {
    this.view = view;
    this.#writeViewState();
  }

  /** Sorting is the backend's, so a new order is a new first page. */
  setOrder(orderBy: string, dir: SortDirection): void {
    this.orderBy = orderBy;
    this.dir = dir;
    this.#apply();
  }

  setHiddenColumns(hidden: string[]): void {
    this.hiddenColumns = [...hidden];
    this.#writeViewState();

    // The backend leaves the payload columns out of the response, so this needs a fresh page
    void this.reload();
  }

  /** Everything back to how the screen opens, and the URL with it. */
  clearAll(): void {
    this.statuses = [];
    this.names = [];
    this.value = '';
    this.applied = '';
    this.includeEntities = false;
    this.#apply();
  }

  /** `?selectAll=1` from the VS Code batch-ops command: every row that is loaded. */
  selectAllLoaded(): void {
    this.selection.set(this.rows.map((row) => ({ instanceId: row.instanceId, name: row.name })));
  }

  /** What the bulk bar acts on when nothing is selected: the rows on screen (React parity). */
  getShownInstances(): OrchestrationStatus[] {
    return this.rows;
  }

  /**
   * `?start=1` (the Start new instance dialog) and `?selectAll=1` (VS Code's batch operations) are
   * one-shot instructions, not view state: they are read once and taken off the URL, so a reload
   * does not open the dialog again.
   */
  takeFlag(name: 'start' | 'selectAll'): boolean {
    const isSet = this.#app.router.current.query.get(name) === '1';

    if (isSet) {
      this.#app.router.setQuery({ [name]: null });
    }

    return isSet;
  }

  /** Reads the filters out of the route query, falling back to what was stored (contracts §8). */
  #readViewState(): void {
    const query = this.#app.router.current.query;
    const read = (field: keyof InstancesViewState): string => query.get(field) ?? this.#storage.getItem(field) ?? '';

    const statuses = read('status');
    const names = read('name');
    const column = read('col');
    const op = read('op');
    const value = read('val');
    const view = read('view');
    const orderBy = read('orderby');
    const dir = read('dir');
    const hidden = read('hidden');

    this.statuses = statuses ? (statuses.split(',').filter(Boolean) as RuntimeStatus[]) : [];
    this.names = names ? names.split(',').filter(Boolean) : [];
    this.column = column || 'instanceId';
    this.op = (op as FilterOperator) || 'StartsWith';
    this.value = value;
    this.applied = value;
    this.includeEntities = read('entities') === '1';
    this.view = view === 'timeline' || view === 'histogram' ? view : 'table';
    this.orderBy = orderBy || 'createdTime';
    this.dir = dir === 'asc' ? 'asc' : 'desc';
    this.hiddenColumns = hidden ? hidden.split('|').filter(Boolean) : [...DEFAULT_HIDDEN_COLUMNS];
  }

  /** Writes them back, to the URL and to the storage behind it. */
  #writeViewState(): void {
    const values: InstancesViewState = {
      status: this.statuses.join(','),
      name: this.names.join(','),
      col: this.column,
      op: this.op,
      val: this.applied,
      entities: this.includeEntities ? '1' : '',
      view: this.view,
      orderby: this.orderBy,
      dir: this.dir,
      hidden: this.hiddenColumns.join('|'),
    };

    this.#app.router.setQuery(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])));

    this.#storage.setItems(
      Object.entries(values).map(([fieldName, value]) => ({
        fieldName: fieldName as Extract<keyof InstancesViewState, string>,
        value: value || null,
      })),
    );
  }

  #apply(): void {
    this.#writeViewState();
    void this.reload();
  }

  async #load(options: { append: boolean }): Promise<void> {
    const requestId = ++this.#requestId;
    const skip = options.append ? this.rows.length : 0;

    this.loading = true;
    this.error = null;

    try {
      const rows = await this.#app.track(() =>
        this.endpoints.listOrchestrations({
          filter: this.filter,
          orderBy: this.orderByClause,
          top: PAGE_SIZE,
          skip,
          hiddenColumns: this.hiddenColumns.filter((column) => OMITTABLE_COLUMNS.includes(column)),
        }),
      );

      if (requestId !== this.#requestId) {
        // A newer request is already on its way; this answer is about filters nobody is looking at
        return;
      }

      this.rows = options.append ? [...this.rows, ...rows] : rows;

      // A short page is the last page: the backend reports no total (contracts §6)
      this.hasMore = rows.length === PAGE_SIZE;
      this.skip = this.rows.length;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      this.error = message;

      // An auto-refresh that keeps failing is stopped, and the preference goes with it: a top bar
      // still saying "Every 5 sec." over a list that is not refreshing would be a lie
      this.stopAutoRefresh();
      this.#app.prefs.setAutoRefresh('instances', 0);
      this.#app.toast.fromError('Load failed', error, () => void this.reload());
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }
}
