// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What one instance actually did, read off its history and laid over the hub's function graph
// (ScreenInstance.dc.html L202-L225). The graph shows what the code *can* call; this says which of
// those calls happened, how often, and which failed - which is the whole reason the tab is on the
// instance screen and not only on the Functions screen.

import type { HistoryEvent } from '$lib/api/types';
import type { FunctionGraph } from '$lib/graph/function-graph-model';

export interface FunctionActivity {
  /** How many times it was called (every TaskScheduled, retries included). */
  calls: number;
  failed: number;
  /** Called and not yet finished. */
  running: number;
  reached: boolean;
}

export type ActivityByName = Record<string, FunctionActivity>;

function entry(activity: ActivityByName, name: string | null): FunctionActivity | null {
  if (!name) {
    return null;
  }

  activity[name] ??= { calls: 0, failed: 0, running: 0, reached: false };

  return activity[name];
}

/** Counts what each function did in this execution. */
export function activityOf(history: HistoryEvent[]): ActivityByName {
  const activity: ActivityByName = {};

  for (const event of history) {
    const record = entry(activity, event.Name);

    if (!record) {
      continue;
    }

    switch (event.EventType) {
      case 'TaskScheduled':
      case 'SubOrchestrationInstanceCreated':
        record.calls += 1;
        record.running += 1;
        record.reached = true;
        break;

      case 'TaskCompleted':
      case 'SubOrchestrationInstanceCompleted':
        record.running = Math.max(0, record.running - 1);
        record.reached = true;
        break;

      case 'TaskFailed':
      case 'SubOrchestrationInstanceFailed':
        record.running = Math.max(0, record.running - 1);
        record.failed += 1;
        record.reached = true;
        break;

      default:
        break;
    }
  }

  return activity;
}

/**
 * What each card says after its kind (L215-L220). The instance's own orchestrator says so; a
 * function nothing called says so too, because "not reached" is the answer people come here for.
 */
export function kindSuffix(name: string, orchestrator: string, activity: ActivityByName): string {
  if (name === orchestrator) {
    return ' · this instance';
  }

  const record = activity[name];

  if (!record?.reached) {
    return ' · not reached';
  }

  // Called and nothing back yet: the count would be a count of things still happening
  if (record.running > 0 && record.running === record.calls) {
    return ' · running';
  }

  const calls = `${record.calls} call${record.calls === 1 ? '' : 's'}`;

  return record.failed > 0 ? ` · ${calls}, ${record.failed} failed` : ` · ${calls}`;
}

/**
 * The edges this instance walked: the ones out of its orchestrator into something it reached, and
 * the ones into the orchestrator - whatever started it is part of the path too.
 */
export function activePath(graph: FunctionGraph, orchestrator: string, activity: ActivityByName): Set<string> {
  const active = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.to === orchestrator) {
      active.add(edge.id);
      continue;
    }

    if (edge.from === orchestrator && activity[edge.to]?.reached) {
      active.add(edge.id);
    }
  }

  return active;
}
