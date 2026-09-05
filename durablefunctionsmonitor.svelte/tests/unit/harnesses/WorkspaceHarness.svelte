<script lang="ts">
  // Test-only wrapper for one piece of the instance workspace: the app context a component reads
  // from, an InstanceState for a chosen instance, and the component under test rendered with it.
  // The details are loaded on mount, which is what the workspace screen does.
  import type { Component } from 'svelte';
  import { setContext } from 'svelte';
  import type { BackendClient } from '$lib/api/client';
  import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
  import type { Capabilities } from '$lib/api/types';
  import { host } from '$lib/host.svelte';
  import { Router } from '$lib/router.svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import { InstanceState } from '$lib/state/instance.svelte';
  import { Prefs } from '$lib/state/prefs.svelte';
  import type { ShowTimeAs } from '$lib/state/prefs.svelte';

  let {
    component,
    instanceId = 'order-2026-09-04-000913',
    path,
    client = {},
    endpoints = {},
    capabilities = {},
    readOnly = false,
    dangerous = false,
    functionGraph = false,
    showTimeAs = 'UTC',
    load = true,
    props = {},
  }: {
    /** The component under test; it is given the `instance` plus whatever `props` holds. */
    component: Component<{ instance: InstanceState }>;
    instanceId?: string;
    /** Defaults to the workspace route of `instanceId`. */
    path?: string;
    client?: Partial<BackendClient>;
    endpoints?: Partial<Endpoints>;
    capabilities?: Partial<Capabilities>;
    readOnly?: boolean;
    dangerous?: boolean;
    /** Whether the host publishes a function graph, which is what the Graph tab needs. */
    functionGraph?: boolean;
    showTimeAs?: ShowTimeAs;
    /** Loads the details on mount; a test about the empty state turns it off. */
    load?: boolean;
    props?: Record<string, unknown>;
  } = $props();

  // Read once on purpose: the harness renders one URL per test
  // svelte-ignore state_referenced_locally
  window.history.replaceState({}, '', path ?? `/DurableFunctionsHub/instances/${encodeURIComponent(instanceId)}`);

  const prefs = new Prefs(host, {
    setItem: () => {},
    setItems: () => {},
    getItem: (field) => (field === 'showTimeAs' ? showTimeAs : null),
    removeItem: () => {},
  });

  // svelte-ignore state_referenced_locally
  const app = new AppState({
    host: functionGraph ? { ...host, functionGraphAvailable: true } : host,
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
  });

  setContext(APP_CONTEXT_KEY, app);

  // svelte-ignore state_referenced_locally
  const instance = new InstanceState({ app, instanceId });

  // svelte-ignore state_referenced_locally
  if (load) {
    void instance.loadDetails();
  }

  const Part = $derived(component);

  export function appState(): AppState {
    return app;
  }

  export function instanceState(): InstanceState {
    return instance;
  }
</script>

<Part {instance} {...props} />
