// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What the workspace knows about the shape of a run rather than its status: `/spans` (B2) - the
// Timeline tab, "Where the time went", the peek's mini timeline and the Execution panel's numbers -
// and `/children` (B1), the sub-orchestrations this instance started.
//
// Both are capabilities, and neither is worth failing the workspace over: a `/spans` call that 500s
// costs the Timeline tab and leaves the History tab, the actions and the details exactly as they
// were. Conditional GET is not used here even where the backend offers it (contracts §6): the body
// is a few kilobytes, and a 304 would save less than the header that asked for it.

import type { ChildrenResponse, Span, SpansResponse, SpansTotals } from '$lib/api/types';
import type { AppState } from './app.svelte';

/** The two loads, named for the toast that reports one failing. */
type Part = 'spans' | 'children';

const PART_TITLES: Readonly<Record<Part, string>> = {
  spans: 'Timeline failed',
  children: 'Children failed',
};

export interface InstanceSpansOptions {
  app: AppState;
  instanceId: string;
}

export class InstanceSpansState {
  /** `GET /spans`, or null while nothing has answered - or while nothing can. */
  response = $state<SpansResponse | null>(null);

  children = $state<ChildrenResponse | null>(null);

  loading = $state(false);

  /**
   * The span the pointer is over, whichever half of the Timeline tab it entered: the swimlane sets
   * it from a lane, the history table from the span that covers the row's sequence number, and both
   * read it back to draw the highlight. One value, so the two halves cannot disagree about it.
   */
  hover = $state<string | null>(null);

  readonly instanceId: string;

  readonly #app: AppState;

  /** React's CancelToken: an answer is applied only while its request is still the current one. */
  #requestId = 0;

  /** Which parts have already reported a failure, so an auto-refresh does not toast every tick. */
  #reported: Partial<Record<Part, boolean>> = {};

  /**
   * Sequence number → the span that covers it. A history row belongs to at most one span, and the
   * first span to claim a number keeps it: the aggregation of B2 can put two spans over one row only
   * when they are the same call, in which case either answer is the same lane.
   */
  readonly #bySequence = $derived.by(() => {
    const map: Record<number, Span> = {};

    for (const span of this.response?.spans ?? []) {
      for (const sequenceNumber of span.sequenceNumbers) {
        map[sequenceNumber] ??= span;
      }
    }

    return map;
  });

  constructor(options: InstanceSpansOptions) {
    this.#app = options.app;
    this.instanceId = options.instanceId;
  }

  /** Whether this backend can draw a timeline at all (`/about`, contracts §5). */
  get supported(): boolean {
    return this.#app.capabilities.spans;
  }

  get spans(): Span[] {
    return this.response?.spans ?? [];
  }

  /** Where the time went, or null until `/spans` has said. */
  get totals(): SpansTotals | null {
    return this.response?.totals ?? null;
  }

  /**
   * How many history rows this execution has, as the provider counts them - which is the whole
   * history, not the page the History tab happens to have loaded.
   */
  get historyRows(): number | null {
    return this.response?.historyRows ?? null;
  }

  /** How many sub-orchestrations this instance started, or null while nobody has looked. */
  get childrenCount(): number | null {
    return this.children ? this.children.children.length : null;
  }

  /** The span a history row belongs to, from its `SequenceNumber`. */
  spanForSequence(sequenceNumber: number | null | undefined): Span | null {
    return sequenceNumber === null || sequenceNumber === undefined ? null : (this.#bySequence[sequenceNumber] ?? null);
  }

  /**
   * The key the history table gives the row with this sequence number (`historyKey`), so the hovered
   * span can name the rows to highlight without the table having to look at spans at all.
   */
  rowKeyForSequence(sequenceNumber: number): string {
    return `s${sequenceNumber}`;
  }

  /** The rows of the hovered span, as table keys. Empty when nothing is hovered. */
  get hoveredRowKeys(): string[] {
    const span = this.spans.find((candidate) => candidate.id === this.hover);

    return span ? span.sequenceNumbers.map((sequenceNumber) => this.rowKeyForSequence(sequenceNumber)) : [];
  }

  /** Both calls at once. Each answers for itself: one failing does not blank the other. */
  async load(): Promise<void> {
    const requestId = ++this.#requestId;

    this.loading = true;

    await Promise.all([this.#loadSpans(requestId), this.#loadChildren(requestId)]);

    if (requestId === this.#requestId) {
      this.loading = false;
    }
  }

  async #loadSpans(requestId: number): Promise<void> {
    if (!this.#app.capabilities.spans) {
      this.response = null;
      return;
    }

    try {
      const response = await this.#app.track(() => this.#app.endpoints.spans(this.instanceId));

      if (requestId !== this.#requestId) {
        return;
      }

      this.response = response;
      this.#reported.spans = false;
    } catch (error) {
      // Keeping the spans of a call that failed would draw a timeline of a run that has moved on
      if (requestId === this.#requestId) {
        this.response = null;
      }

      this.#fail(requestId, 'spans', error);
    }
  }

  async #loadChildren(requestId: number): Promise<void> {
    if (!this.#app.capabilities.children) {
      this.children = null;
      return;
    }

    try {
      const children = await this.#app.track(() => this.#app.endpoints.children(this.instanceId));

      if (requestId !== this.#requestId) {
        return;
      }

      this.children = children;
      this.#reported.children = false;
    } catch (error) {
      if (requestId === this.#requestId) {
        this.children = null;
      }

      this.#fail(requestId, 'children', error);
    }
  }

  /** One toast per part per outage, and none at all for an answer nobody is waiting for. */
  #fail(requestId: number, part: Part, error: unknown): void {
    if (requestId !== this.#requestId || this.#reported[part]) {
      return;
    }

    this.#reported[part] = true;
    this.#app.toast.fromError(PART_TITLES[part], error);
  }
}
