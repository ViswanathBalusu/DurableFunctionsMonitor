<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import ActionDialogs from '$lib/instance/ActionDialogs.svelte';
  import { entityKey, type ActionKind } from '$lib/instance/actions.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Palette } from '$lib/state/palette.svelte';
  import Outlet from './Outlet.svelte';
  import BottomNav from './BottomNav.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import MoreSheet from './MoreSheet.svelte';
  import PeekPanel, { type PeekAction } from './PeekPanel.svelte';
  import SideNav from './SideNav.svelte';
  import ToastHost from './ToastHost.svelte';
  import TopBar from './TopBar.svelte';
  import { installShortcuts } from './shortcuts';
  import { installVsCodeCommands } from './vscode-commands';

  interface Props {
    /** Told when the palette is asked for; the shell opens its own either way. */
    onOpenPalette?: () => void;
    /** E2-S7 passes the sign-out. */
    onSignOut?: () => void;
  }

  let { onOpenPalette, onSignOut }: Props = $props();

  let topBar = $state<TopBar | null>(null);
  let moreOpen = $state(false);

  /** The keyboard map (E2-S5) focuses the instance jump through the shell. */
  export function focusJump(): void {
    topBar?.focusJump();
  }

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  // Switching the task hub opens the top bar's own menu, which is where the hubs are listed
  const palette = new Palette(app, { onSwitchHub: () => topBar?.openHubMenu() });

  function togglePalette(): void {
    onOpenPalette?.();
    palette.toggle();
  }

  /** What the peek panel's buttons are called, and which confirm dialog each of them opens. */
  const PEEK_ACTIONS: Record<PeekAction, ActionKind> = {
    suspend: 'suspend',
    resume: 'resume',
    raiseEvent: 'raise',
    terminate: 'terminate',
    sendSignal: 'signal',
    purge: 'purge',
  };

  /** The badge both navs carry, whichever screen is on (E9-S1-T1). */
  const failuresCount = $derived(app.failuresCount);

  /**
   * The count follows the hub and the shared range, and has to wait for `/about` like everything
   * else does - every capability is false until it answers. The Failures screen sets the count from
   * its own load, so while it is on there is nothing here to ask for.
   */
  let loadedCountKey = '';

  $effect(() => {
    const key = JSON.stringify([app.hub, app.timeRange, app.capabilities.failures]);

    if (key === loadedCountKey || app.router.current.name === 'failures') {
      return;
    }

    loadedCountKey = key;

    queueMicrotask(() => void app.loadFailuresCount());
  });

  // The extension's menu commands need a screen to navigate to, so they wait for the shell
  onMount(() => installVsCodeCommands(app));

  // The keyboard map lives exactly as long as the shell does (contracts §13)
  $effect(() =>
    installShortcuts(app, {
      focusJump,
      togglePalette,
      paletteOpen: () => palette.open,
      closePalette: () => palette.close(),
    }),
  );
</script>

<!--
  The frame of `DFM App.dc.html` L25-L134: a two-column grid whose first column is the side nav
  (240px, 64px collapsed - the class is all the CSS needs), a sticky top bar over a scrolling
  content area, and the bottom tab bar that the responsive rules swap in below 768px.

  The palette is added by the task that owns it; this is the frame it hangs in.
-->
<div class={`shell${app.prefs.navCollapsed ? ' collapsed' : ''}`}>
  <SideNav {failuresCount} />

  <div class="main">
    <TopBar bind:this={topBar} onOpenPalette={togglePalette} {onSignOut} />

    {#if app.busy}
      <ProgressBar inline />
    {/if}

    <main class="content" id="main">
      <Outlet />
    </main>
  </div>

  <BottomNav {failuresCount} {moreOpen} onToggleMore={() => (moreOpen = !moreOpen)} />
</div>

<MoreSheet bind:open={moreOpen} onOpenPalette={togglePalette} />

<!-- Outside `.shell`: these are overlays over the whole app, not part of the content column -->
<PeekPanel
  onAction={(action, item) =>
    app.actions.open(PEEK_ACTIONS[action], {
      id: item.id,
      name: item.name,
      status: item.status,
      isEntity: item.kind === 'DurableEntity',
      key: entityKey(item.id),
      customStatus: item.customStatus,
    })}
/>
<CommandPalette {palette} />
<ActionDialogs />
<ToastHost />
