<script lang="ts" module>
  /** Where the graph came from; the button opens the project that draws it. */
  export const AZ_FUNC_AS_A_GRAPH_URL = 'https://github.com/scale-tone/az-func-as-a-graph';

  export const GRAPH_FOOTER =
    'The ring-colored path is what this instance actually called. Click a function to open its code in VS Code.';
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import { saveSvg } from '$lib/charts/svg-export';
  import FunctionGraph, { type NodeMetrics } from '$lib/graph/FunctionGraph.svelte';
  import { buildFunctionGraph } from '$lib/graph/function-graph-model';
  import { resolve } from '$lib/filters/time-range';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import { activePath, activityOf, kindSuffix } from './graph-path';

  interface Props {
    instance: InstanceState;
  }

  let { instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let graph = $state<FunctionGraph | null>(null);
  let selected = $state<string | null>(null);

  /** The counters on the orchestrator's card, when the backend can count them. */
  let metrics = $state<Record<string, NodeMetrics>>({});

  const model = $derived(buildFunctionGraph(instance.functionMap));

  const orchestrator = $derived(instance.functionName);

  const activity = $derived(activityOf(instance.history.rows));

  const path = $derived(activePath(model, orchestrator, activity));

  /** Which card is picked out; the workspace opens on its own function, once the details name it. */
  let picked = false;

  $effect(() => {
    if (!picked && orchestrator) {
      picked = true;
      selected = orchestrator;
    }
  });

  onMount(() => {
    void loadMetrics();
  });

  /**
   * `/stats` counts what every orchestrator did over the shared range; the card shows the three
   * numbers for this one. Without the capability there are no counters, and the card is shorter -
   * a count this app worked out for itself would be a count of the page, not of the hub.
   */
  async function loadMetrics(): Promise<void> {
    if (!app.capabilities.stats) {
      return;
    }

    try {
      const { from, to } = resolve(app.timeRange, new Date());

      const stats = await app.track(() => app.endpoints.stats({ from: from.toISOString(), to: to.toISOString() }));

      metrics = Object.fromEntries(
        stats.byName.map((row) => [row.name, { completed: row.completed, running: row.running, failed: row.failed }]),
      );
    } catch {
      // A graph without counters is still a graph; a toast about it would be noise on this tab
      metrics = {};
    }
  }

  async function save(): Promise<void> {
    const svg = graph?.toSvg();

    if (svg) {
      await saveSvg(app.client, svg, `${instance.instanceId}.svg`);
    }
  }

  /** VS Code opens the function's code; the browser opens the file the map points at. */
  function openCode(name: string): void {
    if (app.client.isVsCode) {
      void app.client.host.gotoFunctionCode(name);
      return;
    }

    const filePath = model.nodes.find((node) => node.id === name)?.filePath;

    if (filePath) {
      globalThis.open?.(filePath, '_blank');
    }
  }
</script>

<!--
  ScreenInstance.dc.html L202-L225: the hub's function graph with this instance's own path drawn
  over it - the ring-coloured edges are what it actually called, and every card says how many times
  it was called, how many of those failed, or that it was never reached at all.
-->
<FunctionGraph
  bind:this={graph}
  {model}
  bind:selected
  {metrics}
  activePath={path}
  kindSuffix={(name) => kindSuffix(name, orchestrator, activity)}
  height={440}
  onOpenCode={openCode}
/>

<div class="row" style="justify-content:space-between">
  <span class="meta">{GRAPH_FOOTER}</span>

  <div class="row">
    <Button variant="ghost" onclick={() => void save()}>Save as SVG</Button>

    {#if app.client.isVsCode}
      <!-- The webview cannot open an external URL, and a button that does nothing is worse than text -->
      <span class="meta mono">{AZ_FUNC_AS_A_GRAPH_URL}</span>
    {:else}
      <Button variant="ghost" onclick={() => globalThis.open?.(AZ_FUNC_AS_A_GRAPH_URL, '_blank')}>
        az-func-as-a-graph
      </Button>
    {/if}
  </div>
</div>
