<script lang="ts" module>
  /** Why a hub-administration button cannot be pressed, in the order the two reasons apply. */
  export const READ_ONLY_REASON = 'Read-only mode';
  export const UNSUPPORTED_REASON = 'Not supported by this backend';
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import type { Capabilities } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import CleanEntityStorageDialog from './CleanEntityStorageDialog.svelte';
  import DeleteTaskHubDialog from './DeleteTaskHubDialog.svelte';
  import PurgeHistoryDialog from './PurgeHistoryDialog.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let purgeOpen = $state(false);
  let cleanOpen = $state(false);
  let deleteOpen = $state(false);

  const hub = $derived(app.about?.hubName || app.hub);

  interface AdminRow {
    title: string;
    meta: string;
    button: string;
    capability: keyof Capabilities;
    open: () => void;
  }

  const rows = $derived<AdminRow[]>([
    {
      title: 'Purge instance history',
      meta: 'By created time and runtime status. Cannot be undone.',
      button: 'Purge…',
      capability: 'purgeHistory',
      open: () => (purgeOpen = true),
    },
    {
      title: 'Clean entity storage',
      meta: 'Removes empty entities and orphaned locks.',
      button: 'Clean…',
      capability: 'cleanEntityStorage',
      open: () => (cleanOpen = true),
    },
    {
      title: 'Delete task hub',
      meta: `Drops every table, queue and blob of ${hub}.`,
      button: 'Delete…',
      capability: 'deleteTaskHub',
      open: () => (deleteOpen = true),
    },
  ]);

  /**
   * Why this row's button is dead, or nothing when it is not. Read-only first: a backend that says
   * the caller may not write is answering about all three, whatever it announces for them
   * separately. A capability off is the backend saying it cannot do this one at all - which is what
   * the isolated backend says about cleaning and deleting today, and it beats React's behaviour of
   * calling anyway and showing the 400.
   */
  function reason(capability: keyof Capabilities): string | undefined {
    if (app.readOnly) {
      return READ_ONLY_REASON;
    }

    return app.capabilities[capability] ? undefined : UNSUPPORTED_REASON;
  }

  onMount(() => {
    // VS Code's "Purge history" and "Clean entity storage" commands navigate here with the dialog
    // named in the query (E2-S6-T3); the param is spent as it is read, so Back does not re-open it.
    const dialog = app.router.current.query.get('dialog');

    if (dialog === 'purge') {
      purgeOpen = true;
    } else if (dialog === 'clean') {
      cleanOpen = true;
    }

    if (dialog) {
      app.router.setQuery({ dialog: null });
    }
  });
</script>

<!-- ScreenSettings.dc.html L31-L38: the three operations that act on the whole hub. -->
<Panel title="Hub administration">
  {#snippet meta()}
    <span class="fine muted">ReadWrite only</span>
  {/snippet}

  <div class="stack">
    {#each rows as row (row.title)}
      <div class="row" style="justify-content:space-between;border:2px solid var(--muted);padding:10px 12px">
        <div>
          <div style="font-weight:700">{row.title}</div>
          <div class="meta">{row.meta}</div>
        </div>

        <Button
          variant="destructive"
          disabled={reason(row.capability) !== undefined}
          title={reason(row.capability)}
          onclick={row.open}
        >
          {row.button}
        </Button>
      </div>
    {/each}
  </div>
</Panel>

<PurgeHistoryDialog bind:open={purgeOpen} />
<CleanEntityStorageDialog bind:open={cleanOpen} />
<DeleteTaskHubDialog bind:open={deleteOpen} />
