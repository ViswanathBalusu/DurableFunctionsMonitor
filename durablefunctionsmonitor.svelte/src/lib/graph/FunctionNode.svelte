<script lang="ts" module>
  import type { NodeKind } from './function-graph-model';

  /** What Svelte Flow carries on a node for this component to draw. */
  export interface FunctionNodeData {
    name: string;
    kind: NodeKind;
    kindLabel: string;
    /** Appended to the kind line: "· this instance", "· 2 calls, 1 failed" (Functions L215-L220). */
    suffix?: string;
    metrics?: { completed: number; running: number; failed: number };
    [key: string]: unknown;
  }

  export const NODE_TITLE = 'Click to filter the table · double-click opens the code in VS Code (GotoFunctionCode)';
</script>

<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import MiniCounter from '$lib/components/MiniCounter.svelte';
  import { cn } from '$lib/utils';

  let { data, selected }: NodeProps = $props();

  const node = $derived(data as unknown as FunctionNodeData);
</script>

<!--
  ScreenFunctions.dc.html L54-L59: a card with a coloured band saying what kind of function it is,
  the kind, the name, and - for the functions something counted - three counters. The handles are
  what Svelte Flow attaches edges to; they are not part of the design, so they are invisible.
-->
<Handle type="target" position={Position.Left} style="opacity:0" isConnectable={false} />

<div class={cn('node', `n-${node.kind}`, selected ? 'sel' : '')} title={NODE_TITLE}>
  <div class="band"></div>
  <div class="body">
    <div class="kind">{node.kindLabel}{node.suffix ?? ''}</div>
    <div class="name">{node.name}</div>
    {#if node.metrics}
      <div class="metrics">
        <MiniCounter count={node.metrics.completed} status="Completed" />
        <MiniCounter count={node.metrics.running} status="Running" />
        <MiniCounter count={node.metrics.failed} status="Failed" />
      </div>
    {/if}
  </div>
</div>

<Handle type="source" position={Position.Right} style="opacity:0" isConnectable={false} />
