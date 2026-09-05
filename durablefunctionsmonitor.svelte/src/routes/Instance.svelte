<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Page from '$lib/components/Page.svelte';
  import HistoryTab from '$lib/instance/HistoryTab.svelte';
  import InstanceActions from '$lib/instance/InstanceActions.svelte';
  import InputsTab from '$lib/instance/InputsTab.svelte';
  import InstanceHeader from '$lib/instance/InstanceHeader.svelte';
  import RawTab from '$lib/instance/RawTab.svelte';
  import WorkspaceTabs from '$lib/instance/WorkspaceTabs.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { InstanceState } from '$lib/state/instance.svelte';
  import { Inputs } from '$lib/state/inputs.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const route = app.router.current;

  const instance = new InstanceState({
    app,
    instanceId: 'instanceId' in route ? route.instanceId : '',
  });

  /** The Inputs tab's own state; the tab loads it when it is opened and registers its reload. */
  const inputs = new Inputs({ app, instanceId: instance.instanceId });

  onMount(() => {
    void instance.refreshAll();

    instance.startAutoRefresh();

    // The confirm dialogs act through the workspace while it is the instance on screen (E5-S1-T2)
    const unbind = app.actions.bind(instance);

    // The screen's Refresh, the palette's Refresh and VS Code all come through here (E2-S6-T2)
    const stopRefresh = app.onRefresh(() => void instance.refreshAll());

    return () => {
      instance.stopAutoRefresh();
      stopRefresh();
      unbind();
    };
  });

  const tab = $derived(instance.tab);
</script>

<!--
  ScreenInstance.dc.html L17-L253: the breadcrumb and hero, the tab strip, and the two columns of
  the workspace - the summary beside the tab body, and, below 1100px, the Summary tab instead.
  The tab bodies are filled in by the tasks that own them (E5-S3-T2 onwards).
-->
<Page data-screen-label="Instance workspace">
  <InstanceHeader {instance}>
    {#snippet actions()}
      <InstanceActions {instance} />
    {/snippet}
  </InstanceHeader>

  <WorkspaceTabs {instance} inputsCount={inputs.loaded ? inputs.cards.length : null} />

  <div class="ws" data-tab={tab}>
    <aside class="summary" aria-label="Summary">
      <p class="meta">The summary column is built by E5-S8.</p>
    </aside>

    <div class="tabbody" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {#if tab === 'summary'}
        <p class="meta">The summary is the column beside this one on a wider screen.</p>
      {:else if tab === 'history'}
        <HistoryTab {instance} />
      {:else if tab === 'inputs'}
        <InputsTab {instance} {inputs} />
      {:else if tab === 'raw'}
        <RawTab {instance} />
      {:else}
        <p class="meta">The {tab} tab is not built yet.</p>
      {/if}
    </div>
  </div>
</Page>
