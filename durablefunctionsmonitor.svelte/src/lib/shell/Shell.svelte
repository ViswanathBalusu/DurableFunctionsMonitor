<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Palette } from '$lib/state/palette.svelte';
  import Outlet from './Outlet.svelte';
  import BottomNav from './BottomNav.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import MoreSheet from './MoreSheet.svelte';
  import PeekPanel from './PeekPanel.svelte';
  import SideNav from './SideNav.svelte';
  import ToastHost from './ToastHost.svelte';
  import TopBar from './TopBar.svelte';
  import { installShortcuts } from './shortcuts';
  import { installVsCodeCommands } from './vscode-commands';

  interface Props {
    /** The badge on the Failures nav item; E9 fills it from the failures screen state. */
    failuresCount?: number;
    /** Told when the palette is asked for; the shell opens its own either way. */
    onOpenPalette?: () => void;
    /** E2-S7 passes the sign-out. */
    onSignOut?: () => void;
  }

  let { failuresCount = 0, onOpenPalette, onSignOut }: Props = $props();

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
<PeekPanel />
<CommandPalette {palette} />
<ToastHost />
