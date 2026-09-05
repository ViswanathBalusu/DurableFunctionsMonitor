// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Edge } from '@xyflow/svelte';
import { describe, expect, it } from 'vitest';
import { serializeSvg } from '$lib/charts/svg-export';
import FunctionGraph, { flowEdges, flowNodes } from './FunctionGraph.svelte';
import { buildFunctionGraph } from './function-graph-model';
import { edgePoints, graphToSvg } from './graph-svg';
import { layout } from './layout';
import { functionMap } from '../../../tests/unit/fixtures/function-map';

const model = buildFunctionGraph(functionMap());

const METRICS = { ProcessOrderOrchestrator: { completed: 1088, running: 14, failed: 8 } };

function mount(props: Record<string, unknown> = {}) {
  return render(FunctionGraph, { props: { model, ...props } as never });
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.graph .node'));
}

describe('graphToSvg', () => {
  it('draws one card per node and one polyline per edge', () => {
    const positioned = layout(model);
    const svg = graphToSvg(model, positioned);
    const text = svg.outerHTML;

    // A frame and a band per card, plus one arrowhead per edge
    expect(svg.querySelectorAll('rect')).toHaveLength(model.nodes.length * 2 + model.edges.length);
    expect(svg.querySelectorAll('polyline')).toHaveLength(model.edges.length);

    // The name and the kind of every function are in the file
    for (const node of model.nodes) {
      expect(text).toContain(node.name);
    }
  });

  it('is a file anyone can open: no script, no variables, real sizes', () => {
    const svg = graphToSvg(model, layout(model));

    document.body.appendChild(svg);

    const text = serializeSvg(svg);

    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).not.toContain('<script');
    expect(text).not.toContain('var(--');
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(svg.getAttribute('height'))).toBeGreaterThan(0);

    svg.remove();
  });

  it('draws the active path apart from the rest', () => {
    const active = new Set(['ProcessOrderOrchestrator->ReserveInventory']);
    const svg = graphToSvg(model, layout(model), { activePath: active });

    const thick = Array.from(svg.querySelectorAll('polyline')).filter(
      (line) => line.getAttribute('stroke-width') === '3',
    );

    expect(thick).toHaveLength(1);
  });

  it('carries the counters and the kind suffix a caller passes in', () => {
    const svg = graphToSvg(model, layout(model), {
      metrics: METRICS,
      kindSuffix: (name) => (name === 'ProcessOrderOrchestrator' ? ' · this instance' : ''),
    });

    expect(svg.outerHTML).toContain('· this instance');
    expect(svg.outerHTML).toContain('1088');
  });

  it('steps out of one card and into the next', () => {
    const from = { x: 0, y: 0, width: 190, height: 66 } as never;
    const to = { x: 300, y: 100, width: 190, height: 66 } as never;

    // Right edge, across at the midpoint, into the left edge
    expect(edgePoints(from, to)).toBe('190,33 245,33 245,133 300,133');
  });
});

describe('FunctionGraph', () => {
  it('renders a card per node, with its kind and its band', async () => {
    mount();

    await waitFor(() => expect(cards()).toHaveLength(model.nodes.length));

    const orchestrator = cards().find((card) => card.textContent?.includes('ProcessOrderOrchestrator'));

    expect(orchestrator).toHaveClass('n-orchestrator');
    expect(orchestrator?.querySelector('.band')).not.toBeNull();
    expect(orchestrator?.querySelector('.kind')?.textContent).toBe('Orchestrator');
    expect(orchestrator).toHaveAttribute('title', expect.stringContaining('double-click opens the code'));

    // The kinds of the mockup, each with its own band colour class
    expect(document.querySelectorAll('.graph .n-activity')).toHaveLength(5);
    expect(document.querySelectorAll('.graph .n-suborchestrator')).toHaveLength(1);
    expect(document.querySelectorAll('.graph .n-entity')).toHaveLength(1);
  });

  it('shows the three counters on the functions something counted', async () => {
    mount({ metrics: METRICS });

    await waitFor(() => expect(document.querySelector('.graph .metrics')).not.toBeNull());

    const counters = Array.from(document.querySelectorAll('.graph .metrics .mini')).map(
      (counter) => counter.textContent,
    );

    expect(counters).toEqual(['1088', '14', '8']);
    expect(document.querySelectorAll('.graph .metrics')).toHaveLength(1);
  });

  it('appends the suffix a caller asks for to the kind line', async () => {
    mount({ kindSuffix: (name: string) => (name === 'ChargePayment' ? ' · 2 calls, 1 failed' : '') });

    await waitFor(() => expect(cards().length).toBeGreaterThan(0));

    const card = cards().find((node) => node.textContent?.includes('ChargePayment'));

    expect(card?.querySelector('.kind')?.textContent).toBe('Activity · 2 calls, 1 failed');
  });

  it('selects the node that was clicked, and opens the code on a double click', async () => {
    const selections: string[] = [];
    const opened: string[] = [];

    mount({ onSelect: (name: string) => selections.push(name), onOpenCode: (name: string) => opened.push(name) });

    await waitFor(() => expect(cards().length).toBeGreaterThan(0));

    const card = cards().find((node) => node.textContent?.includes('ReserveInventory')) as HTMLElement;

    await fireEvent.click(card);
    await waitFor(() => expect(selections).toEqual(['ReserveInventory']));

    await fireEvent.dblClick(card);
    await waitFor(() => expect(opened).toEqual(['ReserveInventory']));
  });

  it('marks the selected node, however the selection was made', async () => {
    mount({ selected: 'ChargePayment' });

    await waitFor(() => expect(document.querySelector('.graph .node.sel')).not.toBeNull());
    expect(document.querySelector('.graph .node.sel')?.textContent).toContain('ChargePayment');
  });

  it('hands Svelte Flow square-cornered edges, with the active ones marked', () => {
    // jsdom measures nothing, so Svelte Flow never paints an edge; what it is given is the thing to
    // check, and it is a pure function
    const edges = flowEdges(model, { activePath: new Set(['ProcessOrderOrchestrator->ReserveInventory']) });

    expect(edges).toHaveLength(model.edges.length);
    expect(edges.every((edge) => edge.type === 'smoothstep')).toBe(true);
    expect(edges.filter((edge) => edge.class === 'active')).toHaveLength(1);

    const call = edges.find((edge) => edge.id === 'ProcessOrderOrchestrator->ReserveInventory') as
      (Edge & { pathOptions?: { borderRadius: number } }) | undefined;

    // Square corners, and a filled head at the end the call points at
    expect(call?.pathOptions).toEqual({ borderRadius: 0 });
    expect(call?.markerEnd).toMatchObject({ type: 'arrowclosed' });
  });

  it('leaves a self loop off the canvas, and dashes a binding', () => {
    const looping = buildFunctionGraph({
      functions: {
        Reconcile: {
          bindings: [
            { type: 'orchestrationTrigger', direction: 'in' },
            { type: 'queue', direction: 'out', queueName: 'archived' },
          ],
          isCalledByItself: true,
        },
      },
      proxies: {},
    });

    const edges = flowEdges(looping);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'Reconcile',
      target: 'Reconcile.binding1',
      style: 'stroke-dasharray:6 4',
    });
  });

  it('positions each card where the layout put it', () => {
    const positioned = layout(model);
    const nodes = flowNodes(positioned, { selected: 'ChargePayment' });

    expect(nodes).toHaveLength(model.nodes.length);
    expect(nodes.every((node) => node.type === 'dfm' && node.draggable === false)).toBe(true);
    expect(nodes.find((node) => node.id === 'ChargePayment')?.selected).toBe(true);
    expect(nodes[0].position).toEqual({ x: positioned[0].x, y: positioned[0].y });
  });
});
