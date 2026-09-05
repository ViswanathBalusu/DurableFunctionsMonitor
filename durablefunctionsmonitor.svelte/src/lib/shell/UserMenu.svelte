<script lang="ts">
  import { getContext } from 'svelte';
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** Opens the command palette; the item is only shown on narrow screens (`show-m`). */
    onOpenPalette?: () => void;
    /** E2-S7's login.signOut(); absent inside VS Code, where there is nothing to sign out of. */
    onSignOut?: () => void;
  }

  let { onOpenPalette, onSignOut }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let open = $state(false);

  /** No user name means authentication is off, which is a real state and not an error. */
  const userName = $derived(app.userName || 'anonymous');
  const shortName = $derived(userName.split('@')[0]);
  const initial = $derived(shortName.charAt(0).toLowerCase() || 'a');

  const permissions = $derived(
    [app.readOnly ? 'Read only' : 'ReadWrite', app.dangerous ? 'DangerousOperations' : ''].filter(Boolean).join(' · '),
  );

  function goSettings(): void {
    open = false;
    app.router.navigate({ name: 'settings', hub: app.hub });
  }
</script>

<!-- DFM App.dc.html L90-L94. -->
<Pop bind:open align="end" ariaLabel="Account">
  {#snippet anchor({ props })}
    <button class="btn flat" type="button" style="padding:0 8px" {...props}>
      <span class="avatar" aria-hidden="true">{initial}</span>
      <span class="hide-m">{shortName}</span>
    </button>
  {/snippet}

  <div class="meta" style="padding:6px 10px">{userName} · {permissions}</div>

  <MenuItem onclick={goSettings}>Settings</MenuItem>

  {#if onOpenPalette}
    <MenuItem
      class="show-m"
      onclick={() => {
        open = false;
        onOpenPalette?.();
      }}
    >
      Command palette
    </MenuItem>
  {/if}

  {#if onSignOut}
    <div class="sep"></div>
    <MenuItem
      onclick={() => {
        open = false;
        onSignOut?.();
      }}
    >
      Sign out
    </MenuItem>
  {/if}
</Pop>
