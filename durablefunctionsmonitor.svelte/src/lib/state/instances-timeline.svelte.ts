// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Instances screen's Timeline view (React `ResultsGanttDiagramTabState`): the same filter the
// table is looking at, fetched once as 500 rows in created order and turned into swimlanes. React
// drew this with mermaid; the lanes here are the app's own swimlane, so the bars carry the status
// colours of the rest of the UI and the picture can be saved as an SVG without a diagram library.

import type { OrchestrationStatus } from '$lib/api/types';
import { domainTicks, isNarrow, placeSpan, type Swimlane, type TimeDomain } from '$lib/charts/swimlane';
import { fmtDuration } from '$lib/format/duration';
import { statusClass } from '$lib/format/status';
import { fmtDateTime, type ShowTimeAs } from '$lib/format/time';
import { displayName } from '$lib/instances/columns';
import type { AppState } from './app.svelte';
import type { Instances } from './instances.svelte';

/** One page, as React asked for it: `$top=500&$orderby=createdTime asc`. */
export const TIMELINE_TOP = 500;

/** Tick labels on the axis (ScreenInstances.dc.html L101). */
export const TIMELINE_TICKS = 6;

/** The window a timeline with no rows in it still has to draw. */
const EMPTY_DOMAIN_MS = 60 * 60_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The payload columns the timeline never shows, so the backend need not send them. */
const TIMELINE_HIDDEN_COLUMNS = ['input', 'output', 'customStatus'];

/** A lane is labelled by its instance id, or by an entity's key - which is the readable half of it. */
export function laneLabel(row: OrchestrationStatus): string {
  return row.entityType === 'DurableEntity' ? (row.entityId?.key ?? row.instanceId) : row.instanceId;
}

/**
 * Lane order: by orchestrator name, in the order the names first appear, and by creation inside each
 * name. React grouped the rows into mermaid sections, which is the same grouping without the
 * headers; the rows arrive in created order, so a single-name list comes out exactly as it went in.
 */
export function orderLanes(rows: OrchestrationStatus[]): OrchestrationStatus[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local index inside a pure function
  const groups = new Map<string, OrchestrationStatus[]>();

  for (const row of rows) {
    const name = displayName(row);
    const group = groups.get(name);

    if (group) {
      group.push(row);
    } else {
      groups.set(name, [row]);
    }
  }

  return [...groups.values()].flat();
}

/**
 * The axis labels. A tick carries its day when it opens the axis or lands on a different day from
 * the one before it (`Sep 3 23:50`, then `02:00`), which is how the mockup reads across midnight.
 */
export function tickLabels(domain: TimeDomain, count: number, showTimeAs: ShowTimeAs): string[] {
  let previousDay = '';

  return domainTicks(domain, count).map((tick) => {
    // `2026-09-04 14:02:11` on the clock the user reads the rest of the screen on
    const text = fmtDateTime(tick.toISOString(), showTimeAs);
    const day = text.slice(0, 10);
    const time = text.slice(11, 16);

    if (day === previousDay) {
      return time;
    }

    previousDay = day;

    return `${MONTHS[Number(text.slice(5, 7)) - 1]} ${Number(text.slice(8, 10))} ${time}`;
  });
}

export interface InstancesTimelineOptions {
  app: AppState;
  /** The filters on screen; the timeline shows what the table is filtered to. */
  instances: Instances;
  now?: () => number;
}

export class InstancesTimeline {
  rows = $state<OrchestrationStatus[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  /**
   * The moment the domain runs to, fixed when the rows arrive: a running bar reaching the right edge
   * means "still running as of this load", and a domain that moved with the clock would make the
   * bars creep on every re-render.
   */
  loadedAt = $state(0);

  readonly #app: AppState;
  readonly #instances: Instances;
  readonly #now: () => number;

  #requestId = 0;

  constructor(options: InstancesTimelineOptions) {
    this.#app = options.app;
    this.#instances = options.instances;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Earliest creation to the moment of the load (contracts §10: the "now" line is the right edge). */
  get domain(): TimeDomain {
    const to = this.loadedAt || this.#now();

    const earliest = this.rows.reduce(
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- parsing a string, not holding a date
      (oldest, row) => Math.min(oldest, new Date(row.createdTime).getTime()),
      Number.POSITIVE_INFINITY,
    );

    /* eslint-disable svelte/prefer-svelte-reactivity -- the domain is a value, recomputed whenever
       the rows change; nothing ever mutates these two dates */
    return {
      from: new Date(Number.isFinite(earliest) ? Math.min(earliest, to) : to - EMPTY_DOMAIN_MS),
      to: new Date(to),
    };
    /* eslint-enable svelte/prefer-svelte-reactivity */
  }

  get lanes(): Swimlane[] {
    const domain = this.domain;
    const ordered = orderLanes(this.rows);

    return ordered.map((row, index) => {
      // Still going: the bar runs to the right edge rather than stopping at the last update
      const open = row.runtimeStatus === 'Running' || row.runtimeStatus === 'Pending';
      const { left, width } = placeSpan(row.createdTime, open ? null : row.lastUpdatedTime, domain);

      /* eslint-disable svelte/prefer-svelte-reactivity -- parsing the row's ISO strings */
      const end = open ? domain.to.getTime() : new Date(row.lastUpdatedTime).getTime();
      const text = fmtDuration(Math.max(0, end - new Date(row.createdTime).getTime()));
      /* eslint-enable svelte/prefer-svelte-reactivity */
      const narrow = isNarrow(width);

      return {
        key: row.instanceId,
        label: laneLabel(row),
        href: this.#app.router.href({ name: 'instance', hub: this.#app.hub, instanceId: row.instanceId }),
        bars: [
          {
            key: row.instanceId,
            cls: statusClass(row.runtimeStatus),
            left,
            width,
            text: narrow ? undefined : text,
            title: `${displayName(row)} · ${text}`,
          },
        ],
        // A bar too narrow to hold its own duration says it beside itself instead (L104)
        lbl: narrow ? text : undefined,
        lblLeft: narrow ? Math.min(100, left + width + 1) : undefined,
        now: index === ordered.length - 1 ? 100 : undefined,
      };
    });
  }

  get axisTicks(): string[] {
    return tickLabels(this.domain, TIMELINE_TICKS, this.#app.prefs.showTimeAs);
  }

  /** The one row the peek opens on, by lane key. */
  rowOf(key: string): OrchestrationStatus | undefined {
    return this.rows.find((row) => row.instanceId === key);
  }

  async load(): Promise<void> {
    const requestId = ++this.#requestId;

    this.loading = true;
    this.error = null;

    try {
      const rows = await this.#app.track(() =>
        this.#app.endpoints.listOrchestrations({
          filter: this.#instances.filter,
          orderBy: 'createdTime asc',
          top: TIMELINE_TOP,
          skip: 0,
          hiddenColumns: TIMELINE_HIDDEN_COLUMNS,
        }),
      );

      if (requestId !== this.#requestId) {
        return;
      }

      this.rows = rows;
      this.loadedAt = this.#now();
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);
      this.#app.toast.fromError('Load failed', error, () => void this.load());
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }
}
