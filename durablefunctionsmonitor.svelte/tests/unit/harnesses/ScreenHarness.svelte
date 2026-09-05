<script lang="ts">
  // Test-only wrapper for one screen: the app context a route reads from, with the endpoints the
  // test wants to answer with. The shell is not rendered - a screen test is about the screen.
  import type { Component } from 'svelte';
  import { setContext } from 'svelte';
  import type { BackendClient } from '$lib/api/client';
  import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
  import type { About, Capabilities } from '$lib/api/types';
  import { host } from '$lib/host.svelte';
  import { Router } from '$lib/router.svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import { Prefs } from '$lib/state/prefs.svelte';

  let {
    screen,
    path = '/DurableFunctionsHub/instances',
    client = {},
    endpoints = {},
    capabilities = {},
    readOnly = false,
    dangerous = false,
    about: aboutOverrides = {},
  }: {
    /** The route component under test. */
    screen: Component;
    path?: string;
    /** Only what the screen under test calls: saving an SVG, opening a second window. */
    client?: Partial<BackendClient>;
    /** Whatever the test answers with; anything not given simply is not called. */
    endpoints?: Partial<Endpoints>;
    capabilities?: Partial<Capabilities>;
    readOnly?: boolean;
    dangerous?: boolean;
    about?: Partial<About>;
  } = $props();

  // Read once on purpose: the harness renders one URL per test
  // svelte-ignore state_referenced_locally
  window.history.replaceState({}, '', path);

  const prefs = new Prefs(host, {
    setItem: () => {},
    setItems: () => {},
    getItem: () => null,
    removeItem: () => {},
  });

  // svelte-ignore state_referenced_locally
  const app = new AppState({
    host,
    client: client as BackendClient,
    endpoints: endpoints as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs,
  });

  // svelte-ignore state_referenced_locally
  app.about = normalizeAbout({
    accountName: 'mystorageaccount',
    hubName: 'DurableFunctionsHub',
    capabilities: capabilities as Capabilities,
    readOnly,
    dangerousOperations: dangerous,
    permissions: readOnly ? [] : ['DurableFunctionsMonitor.ReadWrite'],
    ...aboutOverrides,
  });

  setContext(APP_CONTEXT_KEY, app);

  const Screen = $derived(screen);

  export function appState(): AppState {
    return app;
  }
</script>

<Screen />
