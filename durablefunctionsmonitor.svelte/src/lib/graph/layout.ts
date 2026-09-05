// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Where each node of the function graph sits. Svelte Flow draws nodes at coordinates and has no
// opinion about what those should be, so dagre lays the graph out left to right: triggers on the
// left, what they start next to them, and what those call after that (ScreenFunctions.dc.html L74).

import dagre from '@dagrejs/dagre';
import type { FunctionGraph, GraphNode } from './function-graph-model';

/** The card is a fixed width; only its height changes, and only when it carries counters. */
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 66;
export const NODE_HEIGHT_WITH_METRICS = 92;

/** Left to right, tight enough that a hub with forty functions still fits on one screen. */
export const RANK_SEP = 48;
export const NODE_SEP = 16;

export interface PositionedNode extends GraphNode {
  /** Top-left, which is what Svelte Flow positions a node by. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Which nodes carry the three counters, and are therefore taller. */
  hasMetrics?: (node: GraphNode) => boolean;
}

export function layout(graph: FunctionGraph, options: LayoutOptions = {}): PositionedNode[] {
  const g = new dagre.graphlib.Graph();

  g.setGraph({ rankdir: 'LR', ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  const heightOf = (node: GraphNode): number => (options.hasMetrics?.(node) ? NODE_HEIGHT_WITH_METRICS : NODE_HEIGHT);

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: heightOf(node) });
  }

  for (const edge of graph.edges) {
    // A self loop has nothing to rank against, and dagre would only push the node down for it
    if (edge.from !== edge.to && g.hasNode(edge.from) && g.hasNode(edge.to)) {
      g.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(g);

  return graph.nodes.map((node) => {
    const placed = g.node(node.id) as { x: number; y: number } | undefined;
    const height = heightOf(node);

    return {
      ...node,
      // dagre positions a node by its centre; Svelte Flow by its top-left corner
      x: Math.round((placed?.x ?? 0) - NODE_WIDTH / 2),
      y: Math.round((placed?.y ?? 0) - height / 2),
      width: NODE_WIDTH,
      height,
    };
  });
}
