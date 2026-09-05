// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The function graph as a standalone SVG (`Save as SVG`). Built rather than serialized: what is on
// screen is Svelte Flow's own DOM - transforms, handles, a viewport - and none of that belongs in a
// file someone opens next week. This draws the same cards, the same step edges and the same square
// arrowheads, with real colours instead of the variables no viewer can resolve.

import { inkColor, tokenColor } from '$lib/charts/chart-tokens';
import type { FunctionGraph, GraphEdge } from './function-graph-model';
import type { PositionedNode } from './layout';

/** Padding around the drawing, so the cards do not touch the edge of the file. */
export const SVG_PADDING = 24;

export interface GraphSvgOptions {
  /** The counters a node carries, if any (the same ones the card shows). */
  metrics?: Record<string, { completed: number; running: number; failed: number }>;
  /** What is appended to a node's kind line ("· this instance", "· 2 calls, 1 failed"). */
  kindSuffix?: (name: string) => string;
  /** The edges to draw in the ring colour: what this instance actually called. */
  activePath?: Set<string>;
}

function el(document: Document, name: string, attributes: Record<string, string>, text?: string): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);

  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

/** The step path between two cards: out of the right edge, across, into the left edge. */
export function edgePoints(from: PositionedNode, to: PositionedNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const mid = Math.round((x1 + x2) / 2);

  return `${x1},${y1} ${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

export function graphToSvg(
  graph: FunctionGraph,
  positions: PositionedNode[],
  options: GraphSvgOptions = {},
): SVGSVGElement {
  const doc = document;
  const ink = inkColor();
  const ring = tokenColor('ring');

  const byId = new Map(positions.map((node) => [node.id, node]));

  const width = Math.max(0, ...positions.map((node) => node.x + node.width)) + SVG_PADDING * 2;
  const height = Math.max(0, ...positions.map((node) => node.y + node.height)) + SVG_PADDING * 2;

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const root = el(doc, 'g', { transform: `translate(${SVG_PADDING}, ${SVG_PADDING})` });

  svg.appendChild(root);

  // Edges first, so a card is never drawn under its own arrow
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (!from || !to || edge.from === edge.to) {
      continue;
    }

    const active = options.activePath?.has(edge.id) ?? false;
    const color = active ? ring : ink;

    root.appendChild(
      el(doc, 'polyline', {
        points: edgePoints(from, to),
        fill: 'none',
        stroke: color,
        'stroke-width': active ? '3' : '2',
        ...(edge.dashed ? { 'stroke-dasharray': '6 4' } : {}),
      }),
    );

    if (edge.arrow !== false) {
      root.appendChild(
        el(doc, 'rect', {
          x: String(to.x - 8),
          y: String(to.y + to.height / 2 - 4),
          width: '8',
          height: '8',
          fill: color,
        }),
      );
    }

    if (edge.label) {
      root.appendChild(
        el(
          doc,
          'text',
          {
            x: String(Math.round((from.x + from.width + to.x) / 2)),
            y: String(Math.round((from.y + from.height / 2 + to.y + to.height / 2) / 2) - 6),
            'text-anchor': 'middle',
            'font-family': 'monospace',
            'font-size': '11',
            fill: ink,
          },
          edge.label,
        ),
      );
    }
  }

  for (const node of positions) {
    root.appendChild(
      el(doc, 'rect', {
        x: String(node.x),
        y: String(node.y),
        width: String(node.width),
        height: String(node.height),
        fill: tokenColor('card') || '#fff',
        stroke: ink,
        'stroke-width': '2',
      }),
    );

    // The band: the one thing that says what kind of function this is
    root.appendChild(
      el(doc, 'rect', {
        x: String(node.x),
        y: String(node.y),
        width: String(node.width),
        height: '10',
        fill: tokenColor(`node-${node.kind}`) || ink,
      }),
    );

    root.appendChild(
      el(
        doc,
        'text',
        {
          x: String(node.x + 12),
          y: String(node.y + 30),
          'font-family': 'sans-serif',
          'font-size': '11',
          'font-weight': '700',
          fill: ink,
        },
        `${node.kindLabel}${options.kindSuffix?.(node.name) ?? ''}`,
      ),
    );

    root.appendChild(
      el(
        doc,
        'text',
        {
          x: String(node.x + 12),
          y: String(node.y + 48),
          'font-family': 'monospace',
          'font-size': '13',
          'font-weight': '600',
          fill: ink,
        },
        node.name,
      ),
    );

    const counters = options.metrics?.[node.name];

    if (counters) {
      const parts: [number, string][] = [
        [counters.completed, 'status-completed'],
        [counters.running, 'status-running'],
        [counters.failed, 'status-failed'],
      ];

      parts.forEach(([count, token], index) => {
        root.appendChild(
          el(
            doc,
            'text',
            {
              x: String(node.x + 12 + index * 44),
              y: String(node.y + 72),
              'font-family': 'monospace',
              'font-size': '11',
              fill: tokenColor(token) || ink,
            },
            String(count),
          ),
        );
      });
    }
  }

  return svg;
}

/** True for an edge that goes somewhere: a self loop is drawn by the card, not by a line. */
export function isDrawable(edge: GraphEdge): boolean {
  return edge.from !== edge.to;
}
