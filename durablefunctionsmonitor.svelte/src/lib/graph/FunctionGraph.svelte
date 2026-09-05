<script lang="ts" module>
  import type { Edge, Node } from '@xyflow/svelte';
  import { inkColor } from '$lib/charts/chart-tokens';
  import type { FunctionGraph } from './function-graph-model';
  import type { PositionedNode } from './layout';

  export interface NodeMetrics {
    completed: number;
    running: number;
    failed: number;
  }

  export interface FlowOptions {
    metrics?: Record<string, NodeMetrics>;
    kindSuffix?: (name: string) => string;
    activePath?: Set<string>;
    selected?: string | null;
  }

  /** The laid-out cards as Svelte Flow nodes. Pure, so what the graph draws can be tested. */
  export function flowNodes(positioned: PositionedNode[], options: FlowOptions = {}): Node[] {
    return positioned.map((node) => ({
      id: node.id,
      type: 'dfm',
      position: { x: node.x, y: node.y },
      selected: node.id === options.selected,
      draggable: false,
      data: {
        name: node.name,
        kind: node.kind,
        kindLabel: node.kindLabel,
        suffix: options.kindSuffix?.(node.name) ?? '',
        metrics: options.metrics?.[node.name],
      },
    }));
  }

  /**
   * The edges. Square-cornered steps, dashed for bindings, and the ones this instance actually
   * walked marked `active` - which dfm-ext.css draws in the ring colour.
   */
  export function flowEdges(model: FunctionGraph, options: FlowOptions = {}): Edge[] {
    return (
      model.edges
        // A self loop has no path between two cards; the card says ContinueAsNew itself
        .filter((edge) => edge.from !== edge.to)
        .map((edge) => ({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: 'smoothstep',
          pathOptions: { borderRadius: 0 },
          label: edge.label,
          class: options.activePath?.has(edge.id) ? 'active' : undefined,
          style: edge.dashed ? 'stroke-dasharray:6 4' : undefined,
          markerEnd:
            edge.arrow === false
              ? undefined
              : { type: 'arrowclosed' as never, color: inkColor(), width: 12, height: 12 },
        }))
    );
  }
</script>

<script lang="ts">
  import { Background, BackgroundVariant, Controls, MiniMap, SvelteFlow } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/base.css';
  import { tokenColor } from '$lib/charts/chart-tokens';
  import FunctionNode from './FunctionNode.svelte';
  import { graphToSvg } from './graph-svg';
  import { layout } from './layout';

  interface Props {
    model: FunctionGraph;
    /** The node the graph is filtered by. Bindable. */
    selected?: string | null;
    /** Per function name, the three counters its card shows. */
    metrics?: Record<string, NodeMetrics>;
    /** The edges this instance actually walked; they are drawn in the ring colour. */
    activePath?: Set<string>;
    /** Appended to a node's kind line. */
    kindSuffix?: (name: string) => string;
    height?: number;
    onSelect?: (name: string) => void;
    /** Double-click: VS Code opens the code, the browser opens the file the map points at. */
    onOpenCode?: (name: string) => void;
  }

  let {
    model,
    selected = $bindable(null),
    metrics = {},
    activePath,
    kindSuffix,
    height = 440,
    onSelect,
    onOpenCode,
  }: Props = $props();

  const nodeTypes = { dfm: FunctionNode };

  /** Laid out once per model: dagre is not cheap, and nothing else moves the cards. */
  const positioned = $derived(layout(model, { hasMetrics: (node) => !!metrics[node.name] }));

  const flowOptions = $derived({ metrics, kindSuffix, activePath, selected });

  const nodes = $derived(flowNodes(positioned, flowOptions));

  const edges = $derived(flowEdges(model, flowOptions));

  /** The same graph as a file: the cards, the step edges and the arrowheads, nothing else. */
  export function toSvg(): SVGSVGElement {
    return graphToSvg(model, positioned, { metrics, kindSuffix, activePath });
  }

  function choose(name: string): void {
    selected = name;
    onSelect?.(name);
  }

  /**
   * Svelte Flow has no double-click event of its own, so the wrapper listens for one and finds the
   * card it landed on. The node's own id is on the element Svelte Flow positions (`data-id`).
   */
  function openCode(event: MouseEvent): void {
    const card = (event.target as Element | null)?.closest('[data-id]');
    const id = card?.getAttribute('data-id');

    if (id) {
      onOpenCode?.(id);
    }
  }
</script>

<!--
  ScreenFunctions.dc.html L48-L63. Svelte Flow does the panning, the zooming and the minimap; the
  cards, the controls and the minimap frame are the design system's, restyled through dfm-ext.css
  because Svelte Flow's own classes are what it positions with.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="graph" style={`height:${height}px`} ondblclick={openCode}>
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    fitView
    nodesDraggable={false}
    nodesConnectable={false}
    zoomOnDoubleClick={false}
    onnodeclick={({ node }) => choose(node.id)}
  >
    <Background
      variant={BackgroundVariant.Dots}
      gap={16}
      size={1}
      bgColor="transparent"
      patternColor={tokenColor('muted-foreground')}
    />
    <Controls class="gctl" showLock={false} />
    <MiniMap class="minimap" />
  </SvelteFlow>
</div>
