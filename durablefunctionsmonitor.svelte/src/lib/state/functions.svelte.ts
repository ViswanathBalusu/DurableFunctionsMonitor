// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Functions screen's state (contracts §7): the hub's orchestrators as a table and as a graph,
// which are two views of the same two answers - `/stats` counts what ran, `/function-map` says what
// calls what. Either can be missing, and the screen is then whichever half is left.

import type { FunctionMapResponse, StatsByName, StatsResponse } from '$lib/api/types';
import { resolve } from '$lib/filters/time-range';
import type { NodeMetrics } from '$lib/graph/FunctionGraph.svelte';
import { buildFunctionGraph, type FunctionGraph } from '$lib/graph/function-graph-model';
import type { AppState } from './app.svelte';

export type FunctionsLayout = 'table' | 'both' | 'graph';

/** The three layouts of the segmented control (ScreenFunctions.dc.html L20). */
export const FUNCTIONS_LAYOUTS: readonly FunctionsLayout[] = ['table', 'both', 'graph'];

export function isLayout(value: string | null): value is FunctionsLayout {
  return !!value && (FUNCTIONS_LAYOUTS as readonly string[]).includes(value);
}

export interface FunctionsOptions {
  app: AppState;
  /** The clock the range is resolved against, so a test can pin its window. */
  now?: () => number;
}

export class Functions {
  /** What /stats answered: the table's rows and the counters on the orchestrator cards. */
  stats = $state<StatsResponse | null>(null);

  /** What the host published, when it publishes one. */
  functionMap = $state<FunctionMapResponse | null>(null);

  loading = $state(false);

  /** The /stats error; the graph half of the screen is unaffected by it. */
  error = $state<string | null>(null);

  /** The range the numbers on screen were loaded for, watched by the screen (as Instances does). */
  loadedRangeKey = $state('');

  readonly #app: AppState;
  readonly #now: () => number;

  #requestId = 0;

  constructor(options: FunctionsOptions) {
    this.#app = options.app;
    this.#now = options.now ?? (() => Date.now());
  }

  /** There is a table to draw when the backend counts; there is a graph when the host has a map. */
  get hasStats(): boolean {
    return this.#app.capabilities.stats;
  }

  get hasGraph(): boolean {
    return this.#app.host.functionGraphAvailable;
  }

  /**
   * Which halves are on show. `?layout` is the user's choice, but a half that does not exist cannot
   * be shown: without a map there is only the table, without /stats only the graph. The VS Code
   * function-graph view (DfmViewMode 1) is the graph and nothing else, whatever the URL says.
   */
  get layout(): FunctionsLayout {
    if (this.#app.host.viewMode === 1) {
      return 'graph';
    }

    if (!this.hasGraph) {
      return 'table';
    }

    if (!this.hasStats) {
      return 'graph';
    }

    const asked = this.#app.router.current.query.get('layout');

    return isLayout(asked) ? asked : 'both';
  }

  get showTable(): boolean {
    return this.layout !== 'graph';
  }

  get showGraph(): boolean {
    return this.layout !== 'table';
  }

  /** The function the table and the graph agree on, from `?selected`. */
  get selected(): string | null {
    return this.#app.router.current.query.get('selected');
  }

  /** The map as nodes and edges (E5-S6-T1); empty, not null, when there is no map. */
  get graph(): FunctionGraph {
    return buildFunctionGraph(this.functionMap);
  }

  /** The table's rows: every orchestrator /stats counted in the range. */
  get rows(): StatsByName[] {
    return this.stats?.byName ?? [];
  }

  /** The three counters each orchestrator card carries (ScreenFunctions.dc.html L57). */
  get metrics(): Record<string, NodeMetrics> {
    return Object.fromEntries(
      this.rows.map((row) => [row.name, { completed: row.completed, running: row.running, failed: row.failed }]),
    );
  }

  /** How much of the hub was scanned to produce these numbers, for the table's footer. */
  get scanned(): number {
    return this.stats?.scanned ?? 0;
  }

  get partial(): boolean {
    return this.stats?.partial ?? false;
  }

  /**
   * The names the selected function is joined to by an edge, itself included
   * (ScreenFunctions.dc.html L103-L104). Nothing selected is nothing related - not everything.
   */
  related(name: string | null = this.selected): string[] {
    if (!name) {
      return [];
    }

    const names = [name];

    for (const edge of this.graph.edges) {
      if (edge.from === name && !names.includes(edge.to)) {
        names.push(edge.to);
      }
      if (edge.to === name && !names.includes(edge.from)) {
        names.push(edge.from);
      }
    }

    return names;
  }

  /** The edges that touch the selection, which the graph draws in the ring colour (L108-L109). */
  activeEdges(name: string | null = this.selected): Set<string> {
    const touching = name ? this.graph.edges.filter((edge) => edge.from === name || edge.to === name) : [];

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a lookup built per read, not state
    return new Set(touching.map((edge) => edge.id));
  }

  /** Picking a function is view state: it belongs in the URL, so the link carries the selection. */
  select(name: string | null): void {
    this.#app.router.setQuery({ selected: name });
  }

  setLayout(layout: FunctionsLayout): void {
    this.#app.router.setQuery({ layout });
  }

  /**
   * The two answers, asked for together. The map does not depend on the range and does not change
   * while the app is open, so it is fetched once; a failure of either leaves the other half of the
   * screen standing.
   */
  async load(): Promise<void> {
    const requestId = ++this.#requestId;

    this.loadedRangeKey = JSON.stringify(this.#app.timeRange);
    this.loading = true;

    await Promise.all([this.#loadStats(requestId), this.#loadFunctionMap()]);

    if (requestId === this.#requestId) {
      this.loading = false;
    }
  }

  async #loadStats(requestId: number): Promise<void> {
    if (!this.hasStats) {
      this.stats = null;
      return;
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value passed to a pure function
    const { from, to } = resolve(this.#app.timeRange, new Date(this.#now()));

    try {
      const stats = await this.#app.track(() =>
        this.#app.endpoints.stats({ from: from.toISOString(), to: to.toISOString() }),
      );

      if (requestId !== this.#requestId) {
        return;
      }

      this.stats = stats;
      this.error = null;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);
      this.#app.toast.fromError('Statistics failed', error, () => void this.load());
    }
  }

  async #loadFunctionMap(): Promise<void> {
    if (!this.hasGraph || this.functionMap) {
      return;
    }

    try {
      this.functionMap = await this.#app.track(() => this.#app.endpoints.functionMap());
    } catch (error) {
      // The graph is half the screen here, so this one is worth saying out loud
      this.functionMap = null;
      this.#app.toast.fromError('Function map failed', error, () => void this.load());
    }
  }
}
