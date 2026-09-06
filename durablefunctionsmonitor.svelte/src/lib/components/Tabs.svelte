<script lang="ts" module>
  export interface TabDefinition {
    id: string;
    label: string;
    /** The Summary tab, which the wide layout hides (`.tab.summary-tab`, dfm-ui.css L148). */
    summaryTab?: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    tabs: TabDefinition[];
    /** Bindable: the id of the selected tab. */
    value: string;
    ariaLabel: string;
    /** The controls after the trailing spacer (auto-refresh select, Refresh; Instance L51-L53). */
    controls?: Snippet;
    class?: string;
    onchange?: (id: string) => void;
  }

  let { tabs, value = $bindable(), ariaLabel, controls, class: className, onchange }: Props = $props();

  let buttons = $state<HTMLButtonElement[]>([]);

  function choose(id: string): void {
    if (id === value) {
      return;
    }

    value = id;
    onchange?.(id);
  }

  /** Arrow keys move along the tab list and select as they go, as WAI-ARIA's tabs pattern does. */
  function onkeydown(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : step === 0
            ? -1
            : (index + step + tabs.length) % tabs.length;

    if (target < 0) {
      return;
    }

    event.preventDefault();
    choose(tabs[target].id);
    buttons[target]?.focus();
  }
</script>

<!--
  The tab strip of ScreenInstance.dc.html L44-L53: `.tabs` of `.tab` buttons, state on aria-selected.

  The tablist is an inner element rather than `.tabs` itself, because the strip also carries a spacer
  and the screen's own controls (a select, a Refresh button) and a `role="tablist"` may own nothing
  but tabs (axe `aria-required-children`). `display: contents` on it - dfm-ext.css - keeps every tab a
  direct flex item of `.tabs`, so the row looks exactly as it did.
-->
<div class={cn('tabs', className)}>
  <div class="tablist" role="tablist" aria-label={ariaLabel}>
    {#each tabs as tab, index (tab.id)}
      <button
        bind:this={buttons[index]}
        type="button"
        class={cn('tab', tab.summaryTab ? 'summary-tab' : '')}
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={tab.id === value}
        aria-controls={`panel-${tab.id}`}
        tabindex={tab.id === value ? 0 : -1}
        onclick={() => choose(tab.id)}
        onkeydown={(event) => onkeydown(event, index)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if controls}
    <span class="grow"></span>
    {@render controls()}
  {/if}
</div>
