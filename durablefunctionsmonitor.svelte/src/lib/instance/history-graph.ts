// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The graph of one orchestration, read off its own history.
//
// The Graph tab normally draws the hub's function map, which az-func-as-a-graph builds from the
// source code and the host publishes; a deployment that does not publish one had no Graph tab at
// all. But the history already names every activity, sub-orchestration, timer and external event
// this instance touched - it is what the Sequence tab is drawn from - so one execution's own graph
// can be built without the map. It is a smaller claim than the map's: the map says what the code
// *can* call, this says only what this instance *did* call, and the tab says so.

import type { HistoryEvent } from '$lib/api/types';
import type { FunctionGraph, GraphEdge, GraphNode, NodeKind } from '$lib/graph/function-graph-model';

/** What the tab says over a graph that is one execution rather than the hub's code. */
export const DERIVED_FROM_HISTORY =
  'Built from this instance history: what it actually called, not what the code can call. ' +
  'Publish a function map (az-func-as-a-graph) for the full graph.';

/** The lane an external event arrives on; it has no function behind it. */
export const EXTERNAL_EVENTS = 'external events';

/** The one node every durable timer of the execution is collapsed into. */
export const DURABLE_TIMER = 'durable timer';

/** How each history event names what it touched, and what kind of node that is. */
const CALLED: Readonly<Record<string, NodeKind>> = {
  TaskScheduled: 'activity',
  TaskCompleted: 'activity',
  TaskFailed: 'activity',
  SubOrchestrationInstanceCreated: 'suborchestrator',
  SubOrchestrationInstanceCompleted: 'suborchestrator',
  SubOrchestrationInstanceFailed: 'suborchestrator',
};

const KIND_LABELS: Readonly<Record<NodeKind, string>> = {
  orchestrator: 'Orchestrator',
  suborchestrator: 'Sub-orchestrator',
  activity: 'Activity',
  entity: 'Entity',
  http: 'HTTP trigger',
  timer: 'Timer',
  queue: 'Queue trigger',
  other: 'Function',
};

/**
 * Builds the graph of one execution: the orchestrator in the middle, everything it called on the
 * right, and whatever came in from outside - external events, timers - on the left.
 *
 * `orchestrator` is the instance's own function name. It is passed rather than read off the
 * `ExecutionStarted` row because a history page that does not reach back to the start still belongs
 * to an instance whose name the details already gave.
 */
export function buildHistoryGraph(orchestrator: string, history: HistoryEvent[]): FunctionGraph {
  if (!orchestrator) {
    return { nodes: [], edges: [] };
  }

  const nodes: GraphNode[] = [
    { id: orchestrator, name: orchestrator, kind: 'orchestrator', kindLabel: KIND_LABELS.orchestrator },
  ];

  const edges: GraphEdge[] = [];
  const kinds = new Map<string, NodeKind>();

  let timers = false;
  let externalEvents = false;
  let continuedAsNew = false;

  for (const event of history) {
    const type = event.EventType ?? '';
    const name = event.Name ?? '';

    if (type === 'TimerCreated' || type === 'TimerFired') {
      timers = true;
      continue;
    }

    if (type === 'EventRaised' || type === 'ExecutionTerminated') {
      // A raised event is the outside talking to this instance; the name is the event's, not a
      // function's, so it does not become a node of its own
      externalEvents = externalEvents || type === 'EventRaised';
      continue;
    }

    if (type === 'ContinueAsNew') {
      continuedAsNew = true;
      continue;
    }

    const kind = CALLED[type];

    // The orchestrator's own ExecutionStarted names itself; a call to itself is ContinueAsNew
    if (!kind || !name || name === orchestrator) {
      continue;
    }

    // A sub-orchestration seen once as a sub-orchestration stays one, whatever a later row says
    if (!kinds.has(name) || kind === 'suborchestrator') {
      kinds.set(name, kind);
    }
  }

  for (const [name, kind] of kinds) {
    nodes.push({ id: name, name, kind, kindLabel: KIND_LABELS[kind] });
    edges.push({ id: `${orchestrator}->${name}`, from: orchestrator, to: name, arrow: true });
  }

  if (externalEvents) {
    nodes.push({
      id: EXTERNAL_EVENTS,
      name: EXTERNAL_EVENTS,
      kind: 'other',
      kindLabel: 'External',
      binding: true,
    });
    edges.push({
      id: `${EXTERNAL_EVENTS}->${orchestrator}`,
      from: EXTERNAL_EVENTS,
      to: orchestrator,
      dashed: true,
      arrow: true,
    });
  }

  if (timers) {
    nodes.push({ id: DURABLE_TIMER, name: DURABLE_TIMER, kind: 'timer', kindLabel: 'Timer', binding: true });
    edges.push({
      id: `${orchestrator}-${DURABLE_TIMER}`,
      from: orchestrator,
      to: DURABLE_TIMER,
      dashed: true,
      arrow: false,
    });
  }

  if (continuedAsNew) {
    edges.push({
      id: `${orchestrator}->${orchestrator}`,
      from: orchestrator,
      to: orchestrator,
      label: 'ContinueAsNew',
      arrow: true,
    });
  }

  return { nodes, edges };
}
