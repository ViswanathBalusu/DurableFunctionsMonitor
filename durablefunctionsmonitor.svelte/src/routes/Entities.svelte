<script lang="ts" module>
  /** The empty state of ScreenEntities.dc.html L34. */
  export const NO_ENTITIES_TITLE = 'No entities';
  export const NO_ENTITIES_TEXT = 'No durable entity matches these filters. Clear the name chip or the key prefix.';
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import EntitiesTable from '$lib/entities/EntitiesTable.svelte';
  import EntityChips from '$lib/entities/EntityChips.svelte';
  import CleanEntityStorageDialog from '$lib/settings/CleanEntityStorageDialog.svelte';
  import { READ_ONLY_REASON, UNSUPPORTED_REASON } from '$lib/settings/HubAdminPanel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Entities } from '$lib/state/entities.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const entities = new Entities({ app });

  let cleanOpen = $state(false);

  /** Why Clean entity storage cannot be pressed, or nothing when it can (E6-S2-T1's rule). */
  const cleanReason = $derived(
    app.readOnly ? READ_ONLY_REASON : app.capabilities.cleanEntityStorage ? undefined : UNSUPPORTED_REASON,
  );

  onMount(() => {
    entities.startAutoRefresh();

    const stopRefresh = app.onRefresh(() => void entities.reload());

    return () => {
      entities.stopAutoRefresh();
      stopRefresh();
    };
  });

  /**
   * The filters live in the URL, so a change from anywhere is a new load; and the capabilities arrive
   * after the first render, so a screen that asked the wrong backend while they were unknown has to
   * ask again once they are known (Overview, Failures and the workspace watch the same thing).
   */
  let loadedKey = '';

  $effect(() => {
    const key = JSON.stringify([entities.name, entities.keyPrefix, entities.window, entities.supported]);

    if (key === loadedKey) {
      return;
    }

    loadedKey = key;

    queueMicrotask(() => {
      void entities.reload();
      void entities.loadFacets();
    });
  });
</script>

<!--
  ScreenEntities.dc.html L16-L56: the title row with the hub's numbers and the one destructive
  operation this screen offers, the filter chips, then the entities themselves.
-->
<Page data-screen-label="Entities">
  <PageTitle title="Entities">
    <span class="meta">{entities.summary}</span>

    <Button
      variant="destructive"
      style="margin-left:auto"
      disabled={!!cleanReason}
      title={cleanReason}
      onclick={() => (cleanOpen = true)}
    >
      Clean entity storage
    </Button>
  </PageTitle>

  <EntityChips {entities} />

  {#if entities.isEmpty}
    <!-- The chips above are what clears the filters, which is what this says to do (L34) -->
    <EmptyState title={NO_ENTITIES_TITLE} text={NO_ENTITIES_TEXT} />
  {:else}
    <EntitiesTable {entities} />
  {/if}

  <CleanEntityStorageDialog bind:open={cleanOpen} />
</Page>
