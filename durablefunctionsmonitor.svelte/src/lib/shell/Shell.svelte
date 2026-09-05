<script lang="ts">
  import { getContext } from 'svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import Outlet from './Outlet.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);
</script>

<!--
  The frame of `DFM App.dc.html` L25-L134: a two-column grid whose first column is the side nav
  (240px, 64px collapsed - the class is all the CSS needs), a sticky top bar over a scrolling
  content area, and the bottom tab bar that the responsive rules swap in below 768px.

  The nav, top bar, bottom nav, More sheet, peek panel, palette and toast host are added by the
  tasks that own them; this is the frame they hang in.
-->
<div class={`shell${app.prefs.navCollapsed ? ' collapsed' : ''}`}>
  <div class="main">
    {#if app.busy}
      <ProgressBar inline />
    {/if}

    <main class="content" id="main">
      <Outlet />
    </main>
  </div>
</div>
