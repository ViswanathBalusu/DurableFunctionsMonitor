<script lang="ts">
  // E0 placeholder shell. It exists to prove the whole spine works in both hosts - host detection,
  // router, backend client, /about, prefs and the five themes - and is replaced screen by screen from
  // E2 onwards. Deliberately unstyled beyond the design tokens: E1 owns the look.
  import { onMount, setContext } from 'svelte';
  import { formatJson } from '$lib/format/json';
  import { themeNames } from '$lib/state/prefs.svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import type { ThemeName } from '$lib/host.svelte';

  const app = new AppState();

  setContext(APP_CONTEXT_KEY, app);

  app.prefs.apply();

  onMount(() => {
    void app.loadAbout();
  });

  const route = $derived(app.router.current);
  const isLogin = $derived(route.name === 'login' && app.host.kind === 'browser');

  function setTheme(theme: ThemeName): void {
    app.prefs.setTheme(theme);
  }

  function toggleMode(): void {
    app.prefs.setMode(app.prefs.resolvedMode === 'dark' ? 'light' : 'dark');
  }
</script>

<div id="dfm-app" style="padding: 16px; font-family: var(--font-sans, system-ui);">
  {#if isLogin}
    <!-- The hub picker and MSAL sign-in arrive in E2; nothing here can be loaded without a hub. -->
    <h1>Login (E2)</h1>
  {:else}
    <h1>Durable Functions Monitor</h1>

    <p>
      host <strong>{app.host.kind}</strong> · route <strong>{route.name}</strong> · hub
      <strong>{app.hub || '(none)'}</strong>
      {#if route.name === 'instance'}
        · instance <strong>{route.instanceId}</strong>
      {/if}
    </p>

    <p>
      {#each themeNames as theme (theme)}
        <button type="button" onclick={() => setTheme(theme)} aria-pressed={app.prefs.theme === theme}>
          {theme}
        </button>
      {/each}
      <button type="button" onclick={toggleMode}>mode: {app.prefs.resolvedMode}</button>
    </p>

    {#if app.aboutError}
      <p role="alert">/about failed: {app.aboutError}</p>
    {/if}

    <!-- Contracts §9: every JSON value is pretty-printed with two spaces and fully expanded. -->
    <pre>{app.about ? formatJson(app.about) : 'loading /about…'}</pre>
  {/if}
</div>
