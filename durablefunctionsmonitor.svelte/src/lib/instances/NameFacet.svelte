<script lang="ts">
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import type { StatsByName } from '$lib/api/types';
  import { fmtInt } from '$lib/format/number';
  import { cn } from '$lib/utils';

  interface Props {
    selected: string[];
    /** From /stats; empty when the backend has none, and then the popover offers a field instead. */
    options: StatsByName[];
    /** Called when the popover opens, so the names are asked for only when they are wanted. */
    onopen?: () => void;
    onchange: (names: string[]) => void;
  }

  let { selected, options, onopen, onchange }: Props = $props();

  let open = $state(false);
  let typed = $state('');

  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      onopen?.();
    }

    wasOpen = open;
  });

  function toggle(name: string): void {
    onchange(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]);
  }

  function addTyped(): void {
    const name = typed.trim();

    if (!name) {
      return;
    }

    typed = '';
    open = false;

    if (!selected.includes(name)) {
      onchange([...selected, name]);
    }
  }
</script>

<!--
  ScreenInstances.dc.html L40-L46. With /stats the popover lists the orchestrators that actually ran,
  with how many; without it there is nothing truthful to list, so the user types the name instead.
-->
<Pop bind:open kind="popover" ariaLabel="Add orchestrator filter" minWidth="280px">
  {#snippet anchor({ props })}
    <button {...props} class="fchip add" type="button">+ orchestrator</button>
  {/snippet}

  {#if options.length > 0}
    <div class="meta" style="padding:6px 10px">Orchestrators in this range</div>

    {#each options as option (option.name)}
      <MenuItem role="menuitemcheckbox" checked={selected.includes(option.name)} onclick={() => toggle(option.name)}>
        {#snippet leading()}
          <span class={cn('box', selected.includes(option.name) ? 'on' : '')} aria-hidden="true"></span>
        {/snippet}
        <span class="mono" style="font-weight:600">{option.name}</span>
        {#snippet meta()}
          {fmtInt(option.started)}
        {/snippet}
      </MenuItem>
    {/each}
  {:else}
    <div style="padding:10px;min-width:260px">
      <TextInput
        bind:value={typed}
        mono
        placeholder="Type an orchestrator name"
        aria-label="Orchestrator name"
        onEnter={addTyped}
      />
    </div>
  {/if}
</Pop>
