<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import { Login } from '$lib/state/login.svelte';
  import Shell from '$lib/shell/Shell.svelte';
  import Functions from './routes/Functions.svelte';
  import LoginScreen from './routes/Login.svelte';

  const app = new AppState();

  setContext(APP_CONTEXT_KEY, app);

  app.prefs.apply();

  /**
   * Signing in is the browser's business: the webview is handed its hub and its identity by the
   * extension. The client asks the login state for its Authorization header on every call, which
   * is why this is wired before anything is loaded.
   */
  const login = new Login({
    endpoints: app.endpoints,
    host: app.host,
    router: app.router,
    client: app.client as unknown as { reloadOnNetworkError: boolean },
  });

  app.setAuthHeaders(() => login.getAuthHeaders());

  onMount(async () => {
    if (app.host.kind === 'browser' && !(await login.login())) {
      // On the way to AAD: nothing else may run, msal has to be able to redirect the page
      return;
    }

    await loadAbout();
  });

  /**
   * Every screen keeps working without `/about` (degraded, with every capability off), but the user
   * has to be told why it is empty - an unknown or disallowed task hub answers 401, and a shell with
   * no explanation looks like a bug in the app rather than a hub that is not there.
   */
  async function loadAbout(): Promise<void> {
    await app.loadAbout();

    if (app.aboutError) {
      app.toast.error(`Could not load task hub ${app.hub}. ${app.aboutError}`, { retry: () => void loadAbout() });
    }
  }

  const route = $derived(app.router.current);

  /** The browser shows the hub picker when no hub is in the URL; the webview never does. */
  const isLogin = $derived(route.name === 'login' && app.host.kind === 'browser');

  /** DfmViewMode 1: the extension embeds the function graph alone, without the shell (contracts §3). */
  const graphOnly = $derived(app.host.viewMode === 1);

  function pickHub(hub: string): void {
    app.router.navigate({ name: 'overview', hub });
    void loadAbout();
  }
</script>

{#if isLogin}
  <LoginScreen {login} onPick={pickHub} />
{:else if graphOnly}
  <Functions />
{:else}
  <Shell onSignOut={login.isAnonymous ? undefined : () => void login.signOut()} />
{/if}
