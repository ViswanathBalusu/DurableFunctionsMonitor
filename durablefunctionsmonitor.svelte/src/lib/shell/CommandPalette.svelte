<script lang="ts">
  import * as Command from '$lib/components/ui/command/index.js';
  import type { Palette } from '$lib/state/palette.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    palette: Palette;
  }

  let { palette }: Props = $props();

  /** The highlighted row, which bits-ui moves with the arrow keys and with the pointer. */
  let selected = $state('');

  let input = $state<HTMLInputElement | null>(null);

  const groups = $derived(palette.groups);

  // The first row of a new list is the one Enter runs, as it is in every palette
  $effect(() => {
    if (!palette.items.some((item) => item.id === selected)) {
      selected = palette.items[0]?.id ?? '';
    }
  });

  $effect(() => {
    if (palette.open) {
      input?.focus();
    }
  });

  function run(id: string): void {
    const item = palette.items.find((candidate) => candidate.id === id);

    if (item) {
      palette.run(item);
    }
  }
</script>

<!--
  DFM App.dc.html L198-L214: `.overlay.pal > .palette[role=dialog]`, the palette being the restyled
  Command root itself - one box, as the mockup draws it. Escape is the shell's keyboard map, which
  owns the whole "innermost first" order (contracts §13); a click on the overlay itself closes.
-->
{#if palette.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay pal" onclick={(event) => event.target === event.currentTarget && palette.close()}>
    <Command.Root
      bind:value={selected}
      shouldFilter={false}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <Command.Input
        bind:ref={input}
        value={palette.query}
        placeholder="Type a command, a screen or an instance id"
        aria-label="Command"
        oninput={(event) => palette.setQuery(event.currentTarget.value)}
      />

      <Command.List>
        {#each groups as group (group.name)}
          <Command.Group heading={group.name}>
            {#each group.items as item (item.id)}
              <Command.Item value={item.id} class={cn(selected === item.id ? 'sel' : '')} onSelect={() => run(item.id)}>
                <span>{item.label}</span>
                {#if item.kbd}
                  <Command.Shortcut>{item.kbd}</Command.Shortcut>
                {/if}
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}

        {#if palette.isEmpty}
          <div class="meta" style="padding:16px">Nothing matches. Try a screen, a theme name or an instance id.</div>
        {/if}
      </Command.List>

      <div class="pfoot fine muted">Up and down to move · Enter to run · Esc to close · Ctrl K opens this anywhere</div>
    </Command.Root>
  </div>
{/if}
