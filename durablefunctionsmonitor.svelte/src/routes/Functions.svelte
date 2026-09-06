<script lang="ts" module>
  import type { SegmentedOption } from '$lib/components/Segmented.svelte';
  import type { FunctionsLayout } from '$lib/state/functions.svelte';

  /** The layout segment (ScreenFunctions.dc.html L20). */
  export const LAYOUT_OPTIONS: SegmentedOption<FunctionsLayout>[] = [
    { value: 'table', label: 'Table' },
    { value: 'both', label: 'Both' },
    { value: 'graph', label: 'Graph' },
  ];

  /** The seven kinds of card the graph draws, in the order the mockup's legend lists them (L66). */
  export const NODE_LEGEND: readonly { kind: string; label: string }[] = [
    { kind: 'http', label: 'HTTP' },
    { kind: 'timer', label: 'timer' },
    { kind: 'queue', label: 'queue / Service Bus' },
    { kind: 'orchestrator', label: 'orchestrator' },
    { kind: 'activity', label: 'activity' },
    { kind: 'suborchestrator', label: 'sub-orchestrator' },
    { kind: 'entity', label: 'entity' },
  ];
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { saveSvg } from '$lib/charts/svg-export';
  import Button from '$lib/components/Button.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import TimeRangeSelect from '$lib/components/TimeRangeSelect.svelte';
  import FunctionsTable from '$lib/functions/FunctionsTable.svelte';
  import FunctionGraph from '$lib/graph/FunctionGraph.svelte';
  import { AZ_FUNC_AS_A_GRAPH_URL } from '$lib/instance/GraphTab.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Functions } from '$lib/state/functions.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const functions = new Functions({ app });

  let graph = $state<FunctionGraph | null>(null);

  /** The extension's function-graph view: this screen alone, without the shell (contracts §3). */
  const graphOnly = $derived(app.host.viewMode === 1);

  onMount(() => {
    const stopRefresh = app.onRefresh(() => void functions.load());

    return stopRefresh;
  });

  /**
   * What is on screen was loaded for a range, and for the halves that existed at the time. The range
   * lives in the URL, so a change from anywhere is a new set of numbers; the `stats` capability
   * arrives with `/about`, after the first render, so a screen that asked for nothing while it was
   * unknown has to ask again once it is known.
   */
  let loadedKey = '';

  $effect(() => {
    const key = JSON.stringify([app.timeRange, functions.hasStats, functions.hasGraph]);

    if (key === loadedKey) {
      return;
    }

    loadedKey = key;

    queueMicrotask(() => void functions.load());
  });

  async function save(): Promise<void> {
    const svg = graph?.toSvg();

    if (svg) {
      await saveSvg(app.client, svg, `${app.hub}-functions.svg`);
    }
  }

  /** VS Code opens the function's code; the browser opens the file the map points at. */
  function openCode(name: string): void {
    if (app.client.isVsCode) {
      void app.client.host.gotoFunctionCode(name);
      return;
    }

    const filePath = functions.graph.nodes.find((node) => node.id === name)?.filePath;

    if (filePath) {
      globalThis.open?.(filePath, '_blank');
    }
  }
</script>

<!--
  ScreenFunctions.dc.html L16-L71: the hub's orchestrators as numbers and as a picture, and the
  segment that decides how much of each is on screen.
-->
<Page data-screen-label="Functions">
  <PageTitle title="Functions">
    <TimeRangeSelect />

    {#if !graphOnly && functions.hasStats && functions.hasGraph}
      <div style="margin-left:auto">
        <Segmented
          options={LAYOUT_OPTIONS}
          value={functions.layout}
          ariaLabel="Layout"
          size="sm"
          onchange={(layout) => functions.setLayout(layout)}
        />
      </div>
    {/if}
  </PageTitle>

  <div class="two{functions.layout === 'both' ? '' : ' single'}">
    {#if functions.showTable}
      <FunctionsTable {functions} />
    {/if}

    {#if functions.showGraph}
      <div>
        <FunctionGraph
          bind:this={graph}
          model={functions.graph}
          selected={functions.selected}
          metrics={functions.metrics}
          activePath={functions.activeEdges()}
          height={520}
          onSelect={(name) => functions.select(name)}
          onOpenCode={openCode}
        />

        <div class="row" style="justify-content:space-between;margin-top:10px">
          <div class="legend">
            {#each NODE_LEGEND as node (node.kind)}
              <span><i style={`background:var(--node-${node.kind})`}></i>{node.label}</span>
            {/each}
          </div>

          <div class="row" style="gap:8px">
            <Button variant="ghost" size="sm" onclick={() => void save()}>Save as SVG</Button>

            {#if graphOnly}
              <!-- The extension writes the map to a file of the user's choosing -->
              <Button variant="ghost" size="sm" onclick={() => void app.client.host.saveFunctionGraphAsJson()}>
                Save as JSON
              </Button>
            {/if}

            {#if app.client.isVsCode}
              <!-- The webview cannot open an external URL, and a button that does nothing is worse -->
              <span class="meta mono">{AZ_FUNC_AS_A_GRAPH_URL}</span>
            {:else}
              <Button variant="ghost" size="sm" onclick={() => globalThis.open?.(AZ_FUNC_AS_A_GRAPH_URL, '_blank')}>
                az-func-as-a-graph
              </Button>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</Page>
