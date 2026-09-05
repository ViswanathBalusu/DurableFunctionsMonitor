<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Hubs } from '$lib/state/hubs.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const hubs = new Hubs(app.endpoints, app.host);

  let open = $state(false);

  onMount(() => {
    void hubs.load(app.hub);
  });

  const accountName = $derived(app.about?.accountName || 'this storage account');

  function pick(hub: string): void {
    open = false;

    if (hub === app.hub) {
      return;
    }

    // A different hub is a different set of everything, so the switch lands on its Overview and
    // /about is asked again - capabilities are per hub as much as per provider.
    app.router.navigate({ name: 'overview', hub });
    void app.loadAbout();
  }

  function toLogin(): void {
    open = false;
    app.router.navigate({ name: 'login' });
  }
</script>

<!-- DFM App.dc.html L44-L55. No instance counts beside the hubs: the backend does not report them. -->
<Pop bind:open ariaLabel="Task hubs" minWidth="320px">
  {#snippet anchor({ props })}
    <button
      class="btn flat"
      type="button"
      style="font-family:var(--font-mono);font-weight:600;gap:10px;padding:0 10px"
      {...props}
    >
      <span>{app.hub}</span>
      <span class="meta hide-m sans">{app.about?.accountName ?? ''}</span>
      <span class="tri down" aria-hidden="true"></span>
    </button>
  {/snippet}

  <div class="meta" style="padding:6px 10px">Task hubs in {accountName}</div>

  {#each hubs.names as hub (hub)}
    <MenuItem role="menuitemradio" checked={hub === app.hub} active={hub === app.hub} onclick={() => pick(hub)}>
      <span class="mono" style="font-weight:600">{hub}</span>
      {#snippet meta()}
        {hub === app.hub ? 'current' : ''}
      {/snippet}
    </MenuItem>
  {/each}

  {#if hubs.switchable}
    <div class="sep"></div>
    <MenuItem onclick={toLogin}>Switch account or connection…</MenuItem>
  {/if}
</Pop>
