<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import Shell from '$lib/shell/Shell.svelte';
  import Functions from './routes/Functions.svelte';

  const app = new AppState();

  setContext(APP_CONTEXT_KEY, app);

  app.prefs.apply();

  onMount(() => {
    void app.loadAbout();
  });

  const route = $derived(app.router.current);

  /** The browser shows the hub picker when no hub is in the URL; the webview never does. */
  const isLogin = $derived(route.name === 'login' && app.host.kind === 'browser');

  /** DfmViewMode 1: the extension embeds the function graph alone, without the shell (contracts §3). */
  const graphOnly = $derived(app.host.viewMode === 1);
</script>

{#if isLogin}
  <!-- E2-S7 replaces this with the hub picker and the MSAL sign-in. -->
  <div class="page" style="padding:24px">
    <h1 class="display">Login (E2)</h1>
  </div>
{:else if graphOnly}
  <Functions />
{:else}
  <Shell />
{/if}
