<script lang="ts">
  import { getContext } from 'svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { parsePath } from '$lib/router.svelte';
  import Activity from '../../routes/Activity.svelte';
  import Entities from '../../routes/Entities.svelte';
  import Failures from '../../routes/Failures.svelte';
  import Functions from '../../routes/Functions.svelte';
  import Instance from '../../routes/Instance.svelte';
  import Instances from '../../routes/Instances.svelte';
  import Overview from '../../routes/Overview.svelte';
  import Settings from '../../routes/Settings.svelte';
  import Storage from '../../routes/Storage.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const route = $derived(app.router.current);

  /**
   * The two legacy instance paths (`durable-instances`, `orchestrations`) parse into the canonical
   * route plus where they should have gone (decision D8). Rewriting the URL keeps old bookmarks and
   * the VS Code deep link working, and `replace` keeps the alias out of the history.
   */
  $effect(() => {
    if (app.router.mode !== 'history') {
      return;
    }

    const parsed = parsePath(globalThis.location?.pathname ?? '', app.router.routePrefix);

    if (parsed.redirectTo) {
      app.router.navigate(app.router.current, { replace: true, query: app.router.current.query });
    }
  });

  // A new screen starts at the top, as it would after a page load (DFM App.dc.html L287), and the
  // refresh handlers of the screen that is leaving go with it (E2-S6-T2). Keyed on the screen and
  // not on the route object, so a filter or a range change does neither.
  $effect(() => {
    const screen = app.screenKey;

    globalThis.scrollTo?.(0, 0);

    return () => app.clearRefreshHandlers(screen);
  });
</script>

{#if route.name === 'overview'}
  <Overview />
{:else if route.name === 'instances'}
  <Instances />
{:else if route.name === 'instance'}
  <Instance />
{:else if route.name === 'failures'}
  <Failures />
{:else if route.name === 'entities'}
  <Entities />
{:else if route.name === 'functions'}
  <Functions />
{:else if route.name === 'storage'}
  <Storage />
{:else if route.name === 'activity'}
  <Activity />
{:else if route.name === 'settings'}
  <Settings />
{/if}
