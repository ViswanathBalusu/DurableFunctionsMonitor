<script lang="ts">
  import { getContext } from 'svelte';
  import NavIcon from '$lib/components/icons/NavIcon.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { cn } from '$lib/utils';
  import { SETTINGS_ITEM, activeNavId, visibleNavItems } from './nav-items';

  interface Props {
    /** The failure count on the Failures item; E9 fills it. Zero hides the badge. */
    failuresCount?: number;
  }

  let { failuresCount = 0 }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const items = $derived(visibleNavItems(app.capabilities, app.host));
  const active = $derived(activeNavId(app.router.current.name));
  const collapsed = $derived(app.prefs.navCollapsed);

  function go(id: string): void {
    app.router.navigate({ name: id as 'overview', hub: app.hub });
  }
</script>

<!-- DFM App.dc.html L26-L38. Items are hidden when their capability is missing, never disabled. -->
<nav class="snav" aria-label="Main">
  <div class="brand">
    <div class="logo" aria-hidden="true"></div>
    <span class="lbl">DFM</span>
  </div>

  {#each items as item (item.id)}
    <button
      class={cn('item', active === item.id ? 'active' : '')}
      type="button"
      title={item.label}
      aria-current={active === item.id ? 'page' : undefined}
      onclick={() => go(item.id)}
    >
      <NavIcon name={item.icon} />
      <span class="lbl">{item.label}</span>
      {#if item.id === 'failures' && failuresCount > 0}
        <span class="cnt chip st-failed sm">{failuresCount}</span>
      {/if}
    </button>
  {/each}

  <div class="gap"></div>

  <button
    class={cn('item', active === SETTINGS_ITEM.id ? 'active' : '')}
    type="button"
    title={SETTINGS_ITEM.label}
    aria-current={active === SETTINGS_ITEM.id ? 'page' : undefined}
    onclick={() => go(SETTINGS_ITEM.id)}
  >
    <NavIcon name={SETTINGS_ITEM.icon} />
    <span class="lbl">{SETTINGS_ITEM.label}</span>
  </button>

  <button
    class="item muted"
    type="button"
    title={collapsed ? 'Expand' : 'Collapse'}
    aria-expanded={!collapsed}
    onclick={() => app.prefs.setNavCollapsed(!collapsed)}
  >
    <NavIcon name={collapsed ? 'expand' : 'collapse'} />
    <span class="lbl">Collapse</span>
  </button>
</nav>
