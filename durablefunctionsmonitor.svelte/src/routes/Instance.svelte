<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Page from '$lib/components/Page.svelte';
  import HistoryTab from '$lib/instance/HistoryTab.svelte';
  import InstanceActions from '$lib/instance/InstanceActions.svelte';
  import InputsTab from '$lib/instance/InputsTab.svelte';
  import InstanceHeader from '$lib/instance/InstanceHeader.svelte';
  import RawTab from '$lib/instance/RawTab.svelte';
  import RecoveryDialog from '$lib/instance/RecoveryDialog.svelte';
  import WorkspaceTabs from '$lib/instance/WorkspaceTabs.svelte';
  import { outcomeAction, type Recovery } from '$lib/instance/input-outcomes';
  import StartNewInstanceDialog from '$lib/instances/StartNewInstanceDialog.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { InstanceState } from '$lib/state/instance.svelte';
  import { Inputs, type InputOpOutcome } from '$lib/state/inputs.svelte';
  import { StartInstance } from '$lib/state/start-instance.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const route = app.router.current;

  const instance = new InstanceState({
    app,
    instanceId: 'instanceId' in route ? route.instanceId : '',
  });

  /** The Inputs tab's own state; the tab loads it when it is opened and registers its reload. */
  const inputs = new Inputs({ app, instanceId: instance.instanceId });

  /**
   * The workspace owns a Start new instance dialog of its own: the recovery of a restart-in-place
   * that purged the instance but could not start it again opens exactly that dialog, prefilled, and
   * the Instances screen that usually holds it is not on screen here (contracts §7).
   */
  const start = new StartInstance({ app });

  /** The half-finished operation a 500 handed back, while its dialog is up. */
  let recovery = $state<Recovery | null>(null);

  /**
   * Design §9's outcomes. A 409 reloads the list before it says anything - the sequence numbers
   * moved - and a 500 with a recovery payload opens a dialog rather than a toast, because a toast
   * goes away and takes the recovery with it.
   */
  async function handleOutcome(outcome: InputOpOutcome): Promise<void> {
    const action = outcomeAction(outcome);

    if (action.kind === 'recovery') {
      recovery = action.recovery;
      await instance.refreshAll();
      return;
    }

    if (action.kind === 'ok') {
      app.toast.ok(action.message);
      await instance.refreshAll();
      return;
    }

    if (action.reloadInputs) {
      await inputs.load();
    }

    app.toast.error(action.message);
  }

  onMount(() => {
    void instance.refreshAll();

    instance.startAutoRefresh();

    // The confirm dialogs act through the workspace while it is the instance on screen (E5-S1-T2)
    const unbind = app.actions.bind(instance);

    // While this screen is on, it is the one that renders the dialog (contracts §7)
    app.dialogs.startNewInstance = start;

    // The screen's Refresh, the palette's Refresh and VS Code all come through here (E2-S6-T2)
    const stopRefresh = app.onRefresh(() => void instance.refreshAll());

    return () => {
      instance.stopAutoRefresh();
      stopRefresh();
      unbind();
      app.dialogs.startNewInstance = null;
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
        <InputsTab {instance} {inputs} onOutcome={(outcome) => void handleOutcome(outcome)} />
      {:else if tab === 'raw'}
        <RawTab {instance} />
      {:else}
        <p class="meta">The {tab} tab is not built yet.</p>
      {/if}
    </div>
  </div>

  {#if recovery}
    <RecoveryDialog
      bind:open={
        () => recovery !== null,
        (next) => {
          if (!next) {
            recovery = null;
          }
        }
      }
      {recovery}
      {instance}
    />
  {/if}

  {#if start.open}
    <StartNewInstanceDialog {start} />
  {/if}
</Page>
