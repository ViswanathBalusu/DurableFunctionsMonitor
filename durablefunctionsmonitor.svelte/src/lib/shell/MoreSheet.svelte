<script lang="ts">
  import { getContext } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { cn } from '$lib/utils';
  import { NAV_ITEMS, SETTINGS_ITEM, activeNavId } from './nav-items';

  interface Props {
    /** Bindable. */
    open?: boolean;
    onOpenPalette?: () => void;
  }

  let { open = $bindable(false), onOpenPalette }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const active = $derived(activeNavId(app.router.current.name));

  /** Whatever the four bottom-nav slots did not take, in nav order, still capability-gated. */
  const items = $derived(
    NAV_ITEMS.filter((item) => item.visible(app.capabilities, app.host))
      .slice(4)
      .concat(SETTINGS_ITEM),
  );

  function go(id: string): void {
    open = false;
    app.router.navigate({ name: id as 'overview', hub: app.hub });
  }

  function toLogin(): void {
    open = false;
    app.router.navigate({ name: 'login' });
  }
</script>

<!-- DFM App.dc.html L135-L148: the bottom sheet behind the More button, restyled onto `.sheet`. -->
<Sheet.Root bind:open>
  <Sheet.Content side="bottom" role="menu" aria-label="More">
    <div class="meta" style="padding:4px 12px 8px">More</div>

    {#each items as item (item.id)}
      <button
        class={cn('item', active === item.id ? 'active' : '')}
        type="button"
        role="menuitem"
        onclick={() => go(item.id)}
      >
        {item.label}
        {#if item.id === 'settings'}
          <span class="meta" style="margin-left:auto">theme, mode, density</span>
        {/if}
      </button>
    {/each}

    <div class="sep"></div>

    {#if onOpenPalette}
      <button
        class="item"
        type="button"
        role="menuitem"
        onclick={() => {
          open = false;
          onOpenPalette?.();
        }}
      >
        Command palette
      </button>
    {/if}

    {#if app.host.kind === 'browser'}
      <button class="item" type="button" role="menuitem" onclick={toLogin}>Switch hub or sign out</button>
    {/if}
  </Sheet.Content>
</Sheet.Root>
