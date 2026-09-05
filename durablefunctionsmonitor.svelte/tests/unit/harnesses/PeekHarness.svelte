<script lang="ts">
  // Test-only wrapper: the peek panel reads everything from the app context, and what it must not
  // disturb is the list behind it - so the harness renders a stand-in row with a selection checkbox.
  import { setContext } from 'svelte';
  import type { BackendClient } from '$lib/api/client';
  import type { Endpoints } from '$lib/api/endpoints';
  import { normalizeAbout } from '$lib/api/endpoints';
  import type { Capabilities } from '$lib/api/types';
  import { host } from '$lib/host.svelte';
  import { Router } from '$lib/router.svelte';
  import PeekPanel, { type PeekAction } from '$lib/shell/PeekPanel.svelte';
  import { APP_CONTEXT_KEY, AppState } from '$lib/state/app.svelte';
  import type { PeekItem } from '$lib/state/peek.svelte';
  import { Prefs } from '$lib/state/prefs.svelte';
  import type { ShowTimeAs } from '$lib/format/time';

  let {
    item,
    readOnly = false,
    showTimeAs = 'UTC',
    withActions = false,
    capabilities = {},
    endpoints = {},
    onAction,
  }: {
    /** The row the stand-in list peeks when it is clicked. */
    item: PeekItem;
    readOnly?: boolean;
    showTimeAs?: ShowTimeAs;
    /** Stands in for E5's `app.actions`, which the shell will pass once it exists. */
    withActions?: boolean;
    /** What `/about` announced; the peek asks for `/spans` only where they exist (E8-S4-T1). */
    capabilities?: Partial<Capabilities>;
    endpoints?: Partial<Endpoints>;
    onAction?: (action: PeekAction, item: PeekItem) => void;
  } = $props();

  window.history.replaceState({}, '', '/DurableFunctionsHub');

  const prefs = new Prefs(host, {
    setItem: () => {},
    setItems: () => {},
    getItem: () => null,
    removeItem: () => {},
  });

  // svelte-ignore state_referenced_locally
  prefs.showTimeAs = showTimeAs;

  // svelte-ignore state_referenced_locally
  const app = new AppState({
    host,
    client: {} as BackendClient,
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
    permissions: readOnly ? [] : ['DurableFunctionsMonitor.ReadWrite'],
  });

  setContext(APP_CONTEXT_KEY, app);

  /** What E4's selection store will hold; here a plain list, so the assertion is about the panel. */
  const selection: string[] = [];

  export function peekState() {
    return app.peek;
  }

  export function selected(): string[] {
    return [...selection];
  }

  export function router() {
    return app.router;
  }
</script>

<div class="list" style="height:80px;overflow:auto">
  <button type="button" data-testid="row" onclick={() => app.peek.open(item)}>{item.id}</button>
  <input
    type="checkbox"
    data-testid="select"
    aria-label="Select row"
    onchange={(event) =>
      event.currentTarget.checked ? selection.push(item.id) : selection.splice(selection.indexOf(item.id), 1)}
  />
</div>

<PeekPanel onAction={withActions ? (onAction ?? (() => {})) : undefined} />
