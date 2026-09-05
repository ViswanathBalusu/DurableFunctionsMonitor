<script lang="ts">
  import { getContext } from 'svelte';
  import NavIcon from '$lib/components/icons/NavIcon.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { cn } from '$lib/utils';
  import { activeNavId, visibleNavItems } from './nav-items';

  interface Props {
    failuresCount?: number;
    moreOpen?: boolean;
    onToggleMore?: () => void;
  }

  let { failuresCount = 0, moreOpen = false, onToggleMore }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const active = $derived(activeNavId(app.router.current.name));

  /**
   * Four slots and a More button (DFM App.dc.html L127-L133). Overview, Instances, Failures and
   * Entities when they are all there; when a capability hides one, the next screen moves up rather
   * than leaving a gap - four slots is what the grid is.
   */
  const slots = $derived(visibleNavItems(app.capabilities, app.host).slice(0, 4));

  /** More is lit while its sheet is open, or while the screen the user is on lives inside it. */
  const moreActive = $derived(moreOpen || !slots.some((item) => item.id === active));

  function go(id: string): void {
    app.router.navigate({ name: id as 'overview', hub: app.hub });
  }
</script>

<!-- Hidden above 768px by the stylesheet; below it this is the whole navigation. -->
<nav class="bottom-nav" aria-label="Main">
  {#each slots as item (item.id)}
    <button
      class={cn(active === item.id ? 'active' : '')}
      type="button"
      aria-current={active === item.id ? 'page' : undefined}
      onclick={() => go(item.id)}
    >
      <NavIcon name={item.icon} />
      {item.label}
      {#if item.id === 'failures' && failuresCount > 0}
        <span class="bcnt">{failuresCount}</span>
      {/if}
    </button>
  {/each}

  <button
    class={cn(moreActive ? 'active' : '')}
    type="button"
    aria-expanded={moreOpen}
    aria-haspopup="menu"
    onclick={onToggleMore}
  >
    <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.5"></circle>
      <circle cx="12" cy="12" r="1.5"></circle>
      <circle cx="19" cy="12" r="1.5"></circle>
    </svg>
    More
  </button>
</nav>
