<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Instances } from '$lib/state/instances.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const instances = new Instances({ app });

  /** The Start new instance dialog (E4-S7), which `?start=1` and the palette both ask for. */
  let startOpen = $state(false);

  /** `?selectAll=1` from VS Code: the rows are not there yet when the flag is read. */
  let selectAllPending = $state(false);

  /** The range the list on screen was loaded for; a plain variable, so watching it cannot loop. */
  let loadedRangeKey = '';

  onMount(() => {
    startOpen = instances.takeFlag('start');
    selectAllPending = instances.takeFlag('selectAll');

    loadedRangeKey = JSON.stringify(app.timeRange);
    void instances.reload();

    instances.startAutoRefresh();

    // The screen's Refresh, the palette's Refresh and VS Code all come through here (E2-S6-T2)
    const stopRefresh = app.onRefresh(() => void instances.reload());

    return () => {
      instances.stopAutoRefresh();
      stopRefresh();
    };
  });

  /**
   * The shared time range lives in the URL, so a change from anywhere is a new first page. Keyed on
   * the range itself and not on the query: writing a filter to the URL is already a reload of its
   * own, and this must not make it two. The load is queued rather than started inside the effect,
   * which is not the place to be writing state (the progress counter, the rows).
   */
  $effect(() => {
    const key = JSON.stringify(app.timeRange);

    if (key === loadedRangeKey) {
      return;
    }

    loadedRangeKey = key;
    queueMicrotask(() => void instances.reload());
  });

  $effect(() => {
    if (selectAllPending && !instances.loading && instances.rows.length > 0) {
      instances.selectAllLoaded();
      selectAllPending = false;
    }
  });
</script>

<!--
  ScreenInstances.dc.html L16-L27. The chips, the rail, the views and the dialogs are added by the
  tasks that own them (E4-S2 to E4-S8); this is the frame they hang in.
-->
<Page data-screen-label="Instances">
  <PageTitle title="Instances">
    <span class="meta">{instances.matchLabel}</span>

    <div class="row" style="margin-left:auto;gap:10px">
      <!-- The dialog itself is E4-S7; the flag it opens from is the one ?start=1 already sets -->
      <Button
        variant="primary"
        disabled={app.readOnly}
        aria-haspopup="dialog"
        aria-expanded={startOpen}
        onclick={() => (startOpen = true)}
      >
        Start new instance
      </Button>
    </div>
  </PageTitle>

  {#if instances.error}
    <p class="meta">{instances.error}</p>
  {/if}
</Page>
