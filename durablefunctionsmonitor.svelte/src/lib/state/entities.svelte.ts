// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Entities screen's state (contracts §7). Two ways to the same table: `GET /entities` (B4), which
// parses each entity's state for us, and - without that capability - the entity half of
// `GET /orchestrations`, which is the query the React UI used. Both end as `EntityRow`s, so nothing
// above this class asks which of the two answered; what does differ is that the second one carries no
// state at all (the backend lists entities with `IncludeState = false`), and the screen says so.

import type { EntityRow, OrchestrationStatus } from '$lib/api/types';
import { DURABLE_ENTITIES, columnPredicate } from '$lib/filters/odata';
import { parseMaybeJson, previewJson } from '$lib/format/json';
import { fmtInt } from '$lib/format/number';
import type { AppState } from './app.svelte';

/** The four windows the Updated select offers (ScreenEntities.dc.html L31). */
export type EntityWindow = '1h' | '24h' | '7d' | 'any';

export const ENTITY_WINDOWS: readonly EntityWindow[] = ['1h', '24h', '7d', 'any'];

export const ENTITY_WINDOW_LABELS: Readonly<Record<EntityWindow, string>> = {
  '1h': 'Updated in the last hour',
  '24h': 'Updated in the last 24 hours',
  '7d': 'Updated in the last 7 days',
  any: 'Any time',
};

/** How far back each window reaches, in milliseconds; `any` has no lower bound at all. */
const WINDOW_MS: Readonly<Record<Exclude<EntityWindow, 'any'>, number>> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
};

/** The window the screen opens in (E10-S1-T1.1). */
export const DEFAULT_WINDOW: EntityWindow = '7d';

/**
 * The longest range `/stats` accepts ("The requested range is longer than the maximum of 92 days",
 * verified against the host on 2026-09-05), which is as far back as the facet can count for `any`.
 */
export const STATS_MAX_MS = 92 * 86_400_000;

/** Rows per page, as contracts §6 asks `/entities` for. */
export const PAGE_SIZE = 50;

/** How long the entity names of the facet stay fresh (decision D10's window, as Instances uses it). */
export const FACETS_CACHE_MS = 30_000;

/** As long a preview as `/entities` itself summarises a state to (contracts §6, EntityRow). */
export const STATE_PREVIEW_MAX = 120;

export const ENTITIES_FAILED = 'Entities failed';

/** One entry of the name facet: what to filter by, and how many of them the hub holds. */
export interface EntityNameCount {
  name: string;
  count: number;
}

export function isEntityWindow(value: string | null): value is EntityWindow {
  return !!value && (ENTITY_WINDOWS as readonly string[]).includes(value);
}

/**
 * An entity's own state, out of the framework's `{ "exists": true, "state": "…" }` envelope. The
 * Azure Storage provider hands the state over already unwrapped, and B4 unwraps whatever it is given
 * anyway (`EntityState.Parse`) - this is for the provider that does not, so that one screen never
 * shows `exists` where another shows the value. Only that exact shape is unwrapped - an object
 * carrying both keys - so an entity whose own state has a `state` field keeps it.
 */
export function entityState(raw: unknown): unknown {
  const parsed = parseMaybeJson(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed ?? null;
  }

  const envelope = parsed as Record<string, unknown>;

  if (!('exists' in envelope) || !('state' in envelope)) {
    return parsed;
  }

  return parseMaybeJson(envelope.state) ?? null;
}

/** The one-line preview a table cell shows, or null when there is no state to preview. */
export function stateSummaryOf(state: unknown): string | null {
  return state === null || state === undefined ? null : previewJson(state, STATE_PREVIEW_MAX);
}

/**
 * One row of `GET /orchestrations` as an `EntityRow` - the shape `GET /entities` would have returned.
 * `entityId` is the backend's own split of `@name@key`; a row without one is not an entity. `input`
 * is where an entity's state lives when a backend fills it in, and null when it does not.
 */
export function toEntityRow(row: OrchestrationStatus): EntityRow {
  const state = entityState(row.input);

  return {
    instanceId: row.instanceId,
    entityName: row.entityId?.name ?? '',
    key: row.entityId?.key ?? '',
    state,
    stateSummary: stateSummaryOf(state),
    stateError: null,
    lastUpdatedTime: row.lastUpdatedTime,
    runtimeStatus: row.runtimeStatus,
  };
}

/** Newest first, which is the order the table's header claims (ScreenEntities.dc.html L39). */
function byUpdatedDesc(rows: EntityRow[]): EntityRow[] {
  return [...rows].sort((left, right) => right.lastUpdatedTime.localeCompare(left.lastUpdatedTime));
}

interface EntitiesPage {
  rows: EntityRow[];
  /** How many rows the backend actually sent, which is what the next `$skip` counts. */
  fetched: number;
  hasMore: boolean;
}

export interface EntitiesOptions {
  app: AppState;
  /** The clock the window is resolved against, so a test can pin it. */
  now?: () => number;
}

export class Entities {
  rows = $state<EntityRow[]>([]);

  hasMore = $state(false);

  loading = $state(false);

  error = $state<string | null>(null);

  /** Every entity name the window holds, from /stats; empty without that capability. */
  statsNames = $state<EntityNameCount[]>([]);

  /** How many entities that is, from /stats; null when it cannot be asked. */
  statsTotal = $state<number | null>(null);

  /** /stats stopped at its cap, so the two numbers above are lower bounds. */
  statsPartial = $state(false);

  readonly #app: AppState;
  readonly #now: () => number;

  #requestId = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #fetched = 0;
  #facetsKey = '';
  #facetsLoadedAt = 0;

  /** Set as soon as a load fails, cleared when one answers: one toast per outage, not per reload. */
  #reported = false;

  constructor(options: EntitiesOptions) {
    this.#app = options.app;
    this.#now = options.now ?? (() => Date.now());
  }

  // ---------------------------------------------------------------- the filters (contracts §4)

  get name(): string {
    return this.#app.router.current.query.get('name') ?? '';
  }

  get keyPrefix(): string {
    return this.#app.router.current.query.get('key') ?? '';
  }

  get window(): EntityWindow {
    const asked = this.#app.router.current.query.get('updated');

    return isEntityWindow(asked) ? asked : DEFAULT_WINDOW;
  }

  /** The window as ISO bounds, or null for `Any time` - which is no bound, not a very old one. */
  get updatedRange(): { from: string; to: string } | null {
    if (this.window === 'any') {
      return null;
    }

    const to = this.#now();

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- two values formatted here, not state
    return { from: new Date(to - WINDOW_MS[this.window]).toISOString(), to: new Date(to).toISOString() };
  }

  /**
   * What the fallback asks `/orchestrations` for. `runtimeStatus in ('DurableEntities')` is the whole
   * point of it - it is the only way to ask that endpoint for entities - and the window goes on
   * `createdTime`, which is the property the backend maps to an entity's last-modified time.
   */
  get filter(): string {
    const clauses: string[] = [];
    const range = this.updatedRange;

    if (range) {
      clauses.push(`createdTime ge '${range.from}' and createdTime le '${range.to}'`);
    }

    clauses.push(`runtimeStatus in ('${DURABLE_ENTITIES}')`);

    // An entity id is `@name@key`, so a name (with or without a key prefix) is a prefix of the id.
    // A key prefix on its own is not - OData cannot say anything about the middle of a string - and
    // is applied to the rows that come back instead.
    if (this.name) {
      clauses.push(columnPredicate('instanceId', 'StartsWith', `@${this.name.toLowerCase()}@${this.keyPrefix}`));
    }

    return clauses.join(' and ');
  }

  // ---------------------------------------------------------------- what the screen reads

  /**
   * True while the backend has the endpoint that parses state for us. Without it the table still
   * lists entities - it just has no state to show, because `/orchestrations` lists them with
   * `IncludeState = false` and their `input` comes back null.
   */
  get supported(): boolean {
    return this.#app.capabilities.entities;
  }

  /** Answered, and nothing matches. */
  get isEmpty(): boolean {
    return !this.loading && this.rows.length === 0;
  }

  /** Whether anything is narrowing the list, which is what the empty state offers to undo. */
  get hasFilters(): boolean {
    return !!this.name || !!this.keyPrefix;
  }

  /**
   * The names the facet offers. /stats knows every name in the window and how many of each; without
   * it the only names anyone can name are the ones on screen.
   */
  get names(): EntityNameCount[] {
    if (this.statsNames.length > 0) {
      return this.statsNames;
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a tally built per read, not state
    const counts = new Map<string, number>();

    for (const row of this.rows) {
      counts.set(row.entityName, (counts.get(row.entityName) ?? 0) + 1);
    }

    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }

  /** `212 durable entities · 3 entity names` (L19). */
  get summary(): string {
    const names = this.names.length;
    const total =
      this.statsTotal === null
        ? `${fmtInt(this.rows.length)}${this.hasMore ? '+' : ''}`
        : `${fmtInt(this.statsTotal)}${this.statsPartial ? '+' : ''}`;

    return `${total} durable entities · ${names} entity name${names === 1 ? '' : 's'}`;
  }

  /** What the footer counts the loaded rows against, when anything knows the whole number (L54). */
  get total(): number | null {
    return this.statsTotal;
  }

  // ---------------------------------------------------------------- the filters, written

  setName(name: string | null): void {
    this.#app.router.setQuery({ name: name || null });
  }

  setKeyPrefix(keyPrefix: string): void {
    this.#app.router.setQuery({ key: keyPrefix || null });
  }

  setWindow(window: EntityWindow): void {
    this.#app.router.setQuery({ updated: window === DEFAULT_WINDOW ? null : window });
  }

  // ---------------------------------------------------------------- loading

  /** Page one, replacing what is on screen. */
  async reload(): Promise<void> {
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
   * The entity names of the window, with a count each, from /stats - the facet to pick from and the
   * number the footer's `Showing 5 of 212` counts against. Asked over the same window the table
   * lists, so the two numbers describe the same set; `Any time` asks over the longest range /stats
   * accepts, since there is no such thing as an unbounded one.
   */
  async loadFacets(): Promise<void> {
    if (!this.#app.capabilities.stats) {
      this.statsNames = [];
      this.statsTotal = null;
      this.statsPartial = false;
      return;
    }

    const key = this.window;

    if (key === this.#facetsKey && this.#now() - this.#facetsLoadedAt < FACETS_CACHE_MS) {
      return;
    }

    const to = this.#now();
    /* eslint-disable svelte/prefer-svelte-reactivity -- two values formatted here, not state */
    const range = this.updatedRange ?? {
      from: new Date(to - STATS_MAX_MS).toISOString(),
      to: new Date(to).toISOString(),
    };
    /* eslint-enable svelte/prefer-svelte-reactivity */

    try {
      const stats = await this.#app.track(() => this.#app.endpoints.stats({ from: range.from, to: range.to }));

      this.statsNames = stats.entitiesByName.map((entry) => ({ name: entry.name, count: entry.count }));
      this.statsTotal = stats.totals.entities;
      this.statsPartial = stats.partial;
      this.#facetsKey = key;
      this.#facetsLoadedAt = this.#now();
    } catch {
      // A facet that cannot be filled is not worth a toast: the rows carry their own names
      this.statsNames = [];
      this.statsTotal = null;
      this.statsPartial = false;
    }
  }

  /** Starts (or restarts) the timer for the interval in the preferences; 0 turns it off. */
  startAutoRefresh(): void {
    this.stopAutoRefresh();

    const seconds = this.#app.autoRefreshSeconds('instances');

    if (seconds > 0) {
      this.#timer = setInterval(() => void this.reload(), seconds * 1000);
    }
  }

  stopAutoRefresh(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #load(options: { append: boolean }): Promise<void> {
    const requestId = ++this.#requestId;
    const skip = options.append ? this.#fetched : 0;

    this.loading = true;

    try {
      const page = this.supported ? await this.#fromEntities(skip) : await this.#fromOrchestrations(skip);

      if (requestId !== this.#requestId) {
        // A newer request is already on its way; this answer is about filters nobody is looking at
        return;
      }

      this.#fetched = skip + page.fetched;
      this.rows = byUpdatedDesc(options.append ? [...this.rows, ...page.rows] : page.rows);
      this.hasMore = page.hasMore;
      this.error = null;
      this.#reported = false;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);

      if (!this.#reported) {
        this.#reported = true;
        this.#app.toast.fromError(ENTITIES_FAILED, error, () => void this.reload());
      }
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }

  /** B4's endpoint: it filters, pages and parses the state itself. */
  async #fromEntities(skip: number): Promise<EntitiesPage> {
    const range = this.updatedRange;

    const response = await this.#app.track(() =>
      this.#app.endpoints.entities({
        name: this.name || undefined,
        keyPrefix: this.keyPrefix || undefined,
        updatedFrom: range?.from,
        updatedTo: range?.to,
        top: PAGE_SIZE,
        skip,
      }),
    );

    return {
      rows: response.entities.map((row) => {
        const state = entityState(row.state);

        return { ...row, state, stateSummary: row.stateError ? null : stateSummaryOf(state) };
      }),
      fetched: response.entities.length,
      hasMore: response.hasMore,
    };
  }

  /**
   * The fallback. A key prefix without a name cannot be pushed into the filter, so it is applied to
   * the rows that come back - which means a page can be shorter than the one the backend sent, and
   * the next `$skip` counts what was sent, not what survived.
   */
  async #fromOrchestrations(skip: number): Promise<EntitiesPage> {
    const rows = await this.#app.track(() =>
      this.#app.endpoints.listOrchestrations({
        filter: this.filter,
        orderBy: 'lastUpdatedTime desc',
        top: PAGE_SIZE,
        skip,
        // Everything but the input, which is where an entity's state would be
        hiddenColumns: ['output', 'customStatus'],
      }),
    );

    const prefix = this.keyPrefix;
    const pushedDown = !!this.name;
    const mapped = rows
      .filter((row) => !!row.entityId)
      .map(toEntityRow)
      .filter((row) => pushedDown || !prefix || row.key.startsWith(prefix));

    return { rows: mapped, fetched: rows.length, hasMore: rows.length === PAGE_SIZE };
  }
}
