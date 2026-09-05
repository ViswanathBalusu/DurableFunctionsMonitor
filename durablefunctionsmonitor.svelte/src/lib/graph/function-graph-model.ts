// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The function graph as data: what `/function-map` describes, turned into nodes and edges
// (ScreenFunctions.dc.html L74-L96). A port of az-func-as-a-graph's classification -
// `buildFunctionDiagramCode.js` - which produced mermaid text; here it produces a model, because
// the graph is drawn by Svelte Flow and has to be clickable, filterable and savable.

import type { FunctionMapNode, FunctionMapResponse } from '$lib/api/types';

export type NodeKind =
  'orchestrator' | 'suborchestrator' | 'activity' | 'entity' | 'http' | 'timer' | 'queue' | 'other';

export interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** What the card says above the name ("Orchestrator", "Service Bus trigger", …). */
  kindLabel: string;
  /** True for the nodes that are bindings rather than functions: they have no code to open. */
  binding?: boolean;
  /** Where the function is declared, when the map says; the browser opens it. */
  filePath?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** The signal name, or `ContinueAsNew` on a self loop. */
  label?: string;
  /** Bindings are dashed; calls are solid. */
  dashed?: boolean;
  /** An "other" binding is attached to its function without pointing anywhere. */
  arrow?: boolean;
}

export interface FunctionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** What a function whose trigger says nothing else is called. */
export const DEFAULT_KIND_LABEL = 'Function';

/** The kind each trigger type maps to (Functions L83-L94). */
const TRIGGER_KINDS: Readonly<Record<string, NodeKind>> = {
  orchestrationTrigger: 'orchestrator',
  activityTrigger: 'activity',
  entityTrigger: 'entity',
  httpTrigger: 'http',
  timerTrigger: 'timer',
  queueTrigger: 'queue',
  serviceBusTrigger: 'queue',
  eventHubTrigger: 'queue',
  eventGridTrigger: 'queue',
  kafkaTrigger: 'queue',
};

/** What each trigger is called on the card. Several kinds share a colour but not a name. */
const TRIGGER_LABELS: Readonly<Record<string, string>> = {
  orchestrationTrigger: 'Orchestrator',
  activityTrigger: 'Activity',
  entityTrigger: 'Entity',
  httpTrigger: 'HTTP trigger',
  timerTrigger: 'Timer trigger',
  queueTrigger: 'Queue trigger',
  serviceBusTrigger: 'Service Bus trigger',
  eventHubTrigger: 'Event Hub trigger',
  eventGridTrigger: 'Event Grid trigger',
  kafkaTrigger: 'Kafka trigger',
};

type Binding = NonNullable<FunctionMapNode['bindings']>[number];

/** The trigger of a function: the binding whose type ends in `Trigger`. */
export function triggerOf(node: FunctionMapNode): Binding | undefined {
  return (node.bindings ?? []).find((binding) => typeof binding.type === 'string' && binding.type.endsWith('Trigger'));
}

/**
 * What a binding node is called: az-func-as-a-graph's `getBindingText`, without the `#32;` spacer
 * it used to keep mermaid from eating the leading space.
 */
export function bindingText(binding: Binding): string {
  const value = (key: string): string => {
    const raw = binding[key];

    return typeof raw === 'string' ? raw : '';
  };

  switch (binding.type) {
    case 'table':
      return `table:${value('tableName')}`;
    case 'blob':
      return `blob:${value('blobPath') || value('path')}`;
    case 'cosmosDB':
      return `cosmosDB:${value('databaseName')}:${value('collectionName')}`;
    case 'eventHub':
      return `eventHub:${value('eventHubName')}`;
    case 'kafka':
      return `kafka:${value('brokerList')}`;
    case 'eventGrid':
      return `eventGrid:${value('topicEndpointUri')}`;
    case 'serviceBus': {
      const queueOrTopic = value('queueOrTopicName') || value('queueName') || value('topicName');
      const subscription = value('subscriptionName');

      return `serviceBus:${queueOrTopic}${subscription ? `:${subscription}` : ''}`;
    }
    case 'queue':
      return `queue:${value('queueName')}`;
    default:
      return binding.type ?? '';
  }
}

/**
 * Turns the map into nodes and edges.
 *
 * One rule differs from the plan's shorthand: an orchestrator is a *sub*-orchestrator when another
 * orchestrator calls it, not merely when anything does. An HTTP or timer starter appears in
 * `isCalledBy` too, and calling an orchestration from a trigger does not make it a
 * sub-orchestration - which is exactly the picture the mockup draws (Functions L83-L96), where
 * ProcessOrderOrchestrator is started by two triggers and is still an orchestrator.
 */
export function buildFunctionGraph(map: FunctionMapResponse | null): FunctionGraph {
  const functions = Object.entries(map?.functions ?? {});
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const kinds = new Map<string, NodeKind>();

  for (const [name, node] of functions) {
    kinds.set(name, TRIGGER_KINDS[triggerOf(node)?.type ?? ''] ?? 'other');
  }

  const isOrchestrator = (name: string): boolean =>
    kinds.get(name) === 'orchestrator' || kinds.get(name) === 'suborchestrator';

  for (const [name, node] of functions) {
    const trigger = triggerOf(node);
    const base = kinds.get(name) ?? 'other';

    // Called by another orchestration: this one runs inside that one
    const sub = base === 'orchestrator' && (node.isCalledBy ?? []).some(isOrchestrator);
    const kind = sub ? 'suborchestrator' : base;

    kinds.set(name, kind);

    nodes.push({
      id: name,
      name,
      kind,
      kindLabel: sub ? 'Sub-orchestrator' : (TRIGGER_LABELS[trigger?.type ?? ''] ?? DEFAULT_KIND_LABEL),
      filePath: node.filePath,
    });
  }

  for (const [name, node] of functions) {
    for (const caller of node.isCalledBy ?? []) {
      edges.push({ id: `${caller}->${name}`, from: caller, to: name, arrow: true });
    }

    for (const signal of node.isSignalledBy ?? []) {
      edges.push({
        id: `${signal.name}->${name}:${signal.signalName}`,
        from: signal.name,
        to: name,
        label: signal.signalName,
        arrow: true,
      });
    }

    if (node.isCalledByItself) {
      edges.push({ id: `${name}->${name}`, from: name, to: name, label: 'ContinueAsNew', arrow: true });
    }

    (node.bindings ?? []).forEach((binding, index) => {
      if (typeof binding.type !== 'string' || binding.type.endsWith('Trigger')) {
        // The trigger is the function's own kind, not a node beside it
        return;
      }

      const id = `${name}.binding${index}`;

      nodes.push({ id, name: bindingText(binding), kind: 'other', kindLabel: DEFAULT_KIND_LABEL, binding: true });

      if (binding.direction === 'in') {
        edges.push({ id: `${id}->${name}`, from: id, to: name, dashed: true, arrow: true });
      } else if (binding.direction === 'out') {
        edges.push({ id: `${name}->${id}`, from: name, to: id, dashed: true, arrow: true });
      } else {
        // Neither in nor out: attached to the function, pointing nowhere
        edges.push({ id: `${name}-${id}`, from: name, to: id, dashed: true, arrow: false });
      }
    });
  }

  // Proxies are rare and have no kind of their own; the route is what identifies them
  for (const [name, proxy] of Object.entries(map?.proxies ?? {})) {
    const route = (proxy.matchCondition as { route?: string } | undefined)?.route;

    nodes.push({
      id: `proxy.${name}`,
      name: route || name,
      kind: 'other',
      kindLabel: 'Proxy',
      binding: true,
    });
  }

  return { nodes, edges };
}
