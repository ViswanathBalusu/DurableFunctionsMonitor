<script lang="ts">
  // Test-only wrapper: Shell reads everything from the app context, so a test needs one built around
  // a chosen URL. The endpoints are stubbed - the shell itself calls none of them.
  import { setContext } from 'svelte';
  import type { Endpoints } from '$lib/api/endpoints';
  import type { BackendClient } from '$lib/api/client';
  import { Router, type HubRouteName } from '$lib/router.svelte';
  import Shell from '$lib/shell/Shell.svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import { Prefs } from '$lib/state/prefs.svelte';
  import { host } from '$lib/host.svelte';
  import { normalizeAbout } from '$lib/api/endpoints';
  import type { Capabilities } from '$lib/api/types';

  let {
    path = '/DurableFunctionsHub',
    navCollapsed = false,
    capabilities = {},
    failuresCount = 0,
  }: {
    path?: string;
    navCollapsed?: boolean;
    /** Whatever /about would have announced; the rest stay off. */
    capabilities?: Partial<Capabilities>;
    failuresCount?: number;
  } = $props();

  // Read once on purpose: the harness renders one URL per test, and the router reads location at
  // construction. svelte-ignore, because that is exactly what the warning is about.
  // svelte-ignore state_referenced_locally
  window.history.replaceState({}, '', path);

  const prefs = new Prefs(host, {
    setItem: () => {},
    setItems: () => {},
    getItem: (field) => (field === 'nav' ? (navCollapsed ? 'collapsed' : 'expanded') : null),
    removeItem: () => {},
  });

  const app = new AppState({
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs,
  });

  // svelte-ignore state_referenced_locally
  app.about = normalizeAbout({ capabilities: capabilities as Capabilities });

  setContext(APP_CONTEXT_KEY, app);

  export function begin(): void {
    app.begin();
  }

  export function go(name: string): void {
    app.router.navigate({ name: name as HubRouteName, hub: app.hub });
  }
</script>

<Shell {failuresCount} />
