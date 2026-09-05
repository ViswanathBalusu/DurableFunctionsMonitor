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
    readOnly = false,
    dangerous = false,
    hubNames = ['DurableFunctionsHub'],
    suggestions = [],
    userName = '',
    endpoints = {},
    onOpenPalette,
    onSignOut,
  }: {
    path?: string;
    navCollapsed?: boolean;
    /** Whatever /about would have announced; the rest stay off. */
    capabilities?: Partial<Capabilities>;
    /** What the app state's badge count is set to before the shell renders. */
    failuresCount?: number;
    readOnly?: boolean;
    dangerous?: boolean;
    hubNames?: string[];
    suggestions?: string[];
    userName?: string;
    /** What the shell's own overlays call - the action confirms, mainly; the rest are stubbed. */
    endpoints?: Partial<Endpoints>;
    onOpenPalette?: () => void;
    onSignOut?: () => void;
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

  // svelte-ignore state_referenced_locally
  const app = new AppState({
    host: { ...host, clientConfig: { ...host.clientConfig, userName } },
    client: {} as BackendClient,
    endpoints: {
      taskHubNames: async () => hubNames,
      idSuggestions: async () => suggestions,
      ...endpoints,
    } as unknown as Endpoints,
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
  });

  // svelte-ignore state_referenced_locally
  app.failuresCount = failuresCount;

  setContext(APP_CONTEXT_KEY, app);

  let shell = $state<Shell | null>(null);

  export function focusJump(): void {
    shell?.focusJump();
  }

  export function begin(): void {
    app.begin();
  }

  export function toasts() {
    return app.toast;
  }

  export function appState() {
    return app;
  }

  export function peekState() {
    return app.peek;
  }

  export function go(name: string): void {
    app.router.navigate({ name: name as HubRouteName, hub: app.hub });
  }
</script>

<Shell bind:this={shell} {onOpenPalette} {onSignOut} />
