<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import { label as rangeLabel } from '$lib/filters/time-range';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { Instances } from '$lib/state/instances.svelte';
  import type { SavedView } from '$lib/state/prefs.svelte';
  import SaveViewDialog from './SaveViewDialog.svelte';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let open = $state(false);
  let saveOpen = $state(false);

  /** The view whose × was pressed: a saved view is removed only after the row has asked. */
  let confirming = $state<string | null>(null);

  /** No built-in views: the three in the mockup are examples of what a user saves, not product. */
  const views = $derived(app.prefs.savedViews);

  const suggestedName = $derived(`${instances.statuses.join(', ') || 'Everything'} · ${rangeLabel(app.timeRange)}`);

  function openView(view: SavedView): void {
    open = false;
    instances.applyUrl(view.url);
  }

  function remove(view: SavedView): void {
    confirming = null;
    app.prefs.setSavedViews(views.filter((saved) => saved.name !== view.name));
  }

  function save(name: string): void {
    const view: SavedView = { name, url: app.router.href({ name: 'instances', hub: app.hub }, instances.viewQuery) };
    const at = views.findIndex((saved) => saved.name === name);

    // Saving under a name that is taken replaces that view where it stands, rather than adding a
    // second entry the menu cannot tell apart
    app.prefs.setSavedViews(at >= 0 ? views.map((saved, index) => (index === at ? view : saved)) : [...views, view]);

    app.toast.ok(`Saved view "${name}" to this browser`);
  }
</script>

<!-- ScreenInstances.dc.html L22-L23. -->
<Pop bind:open align="end" ariaLabel="Saved views" minWidth="260px">
  {#snippet anchor({ props })}
    <Button {...props}>
      Saved views
      <span class="tri down" aria-hidden="true"></span>
    </Button>
  {/snippet}

  {#if views.length === 0}
    <div class="meta" style="padding:6px 10px">Nothing saved yet</div>
  {/if}

  {#each views as view (view.name)}
    {#if confirming === view.name}
      <div class="row" style="gap:6px;padding:4px 10px">
        <span class="meta grow">Remove “{view.name}”?</span>
        <Button size="sm" variant="destructive" flat onclick={() => remove(view)}>Remove</Button>
        <Button size="sm" flat onclick={() => (confirming = null)}>Cancel</Button>
      </div>
    {:else}
      <div class="row" style="gap:4px">
        <MenuItem class="grow" onclick={() => openView(view)}>{view.name}</MenuItem>
        <Button
          size="sm"
          variant="ghost"
          flat
          aria-label={`Remove ${view.name}`}
          onclick={() => (confirming = view.name)}
        >
          ×
        </Button>
      </div>
    {/if}
  {/each}

  <div class="sep"></div>

  <MenuItem
    onclick={() => {
      open = false;
      saveOpen = true;
    }}
  >
    Save current view…
  </MenuItem>
</Pop>

<SaveViewDialog bind:open={saveOpen} {suggestedName} onSave={save} />
