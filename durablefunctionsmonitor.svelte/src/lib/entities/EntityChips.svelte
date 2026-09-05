<script lang="ts">
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import Select, { type SelectOption } from '$lib/components/Select.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import { fmtInt } from '$lib/format/number';
  import { ENTITY_WINDOWS, ENTITY_WINDOW_LABELS, type Entities, type EntityWindow } from '$lib/state/entities.svelte';

  interface Props {
    entities: Entities;
  }

  let { entities }: Props = $props();

  let addOpen = $state(false);

  /**
   * What is in the field. The filter itself is in the URL, and only Enter or a blur writes it there -
   * but the URL is where the field comes from, so a change from anywhere else (Back, a link) moves it
   * too. A writable `$derived` is exactly that: typed over locally, reset by its own source.
   */
  let typed = $derived(entities.keyPrefix);

  const windowOptions: SelectOption<EntityWindow>[] = ENTITY_WINDOWS.map((window) => ({
    value: window,
    label: ENTITY_WINDOW_LABELS[window],
  }));

  function pick(name: string): void {
    addOpen = false;
    entities.setName(name);
  }

  function applyKey(): void {
    const next = typed.trim();

    if (next !== entities.keyPrefix) {
      entities.setKeyPrefix(next);
    }
  }
</script>

<!--
  ScreenEntities.dc.html L22-L32. The name is one chip at a time (an entity has exactly one name),
  the key is a prefix of the key half of `@name@key` - which is what the backend matches on - and
  the window is the last thing narrowing the list.
-->
<div class="chips2" aria-label="Filters">
  {#if entities.name}
    <span class="fchip">
      <span class="mono" style="font-weight:600">{entities.name}</span>
      <button class="x" type="button" aria-label="Remove entity name filter" onclick={() => entities.setName(null)}>
        ×
      </button>
    </span>
  {/if}

  <Pop bind:open={addOpen} kind="popover" ariaLabel="Add entity name filter" minWidth="240px">
    {#snippet anchor({ props })}
      <button {...props} class="fchip add" type="button">+ entity name</button>
    {/snippet}

    {#each entities.names as option (option.name)}
      <MenuItem onclick={() => pick(option.name)}>
        <span class="mono" style="font-weight:600">{option.name}</span>
        {#snippet meta()}
          {fmtInt(option.count)}
        {/snippet}
      </MenuItem>
    {/each}

    {#if entities.names.length === 0}
      <div class="meta" style="padding:6px 10px">No entity name to filter by yet</div>
    {/if}
  </Pop>

  <span class="vsep" aria-hidden="true"></span>

  <span class="fchip">
    <span class="meta" style="font-weight:600">key starts with</span>
    <TextInput
      bind:value={typed}
      mono
      aria-label="Key starts with"
      placeholder="warehouse-"
      style="height:22px;border:0;background:transparent;width:150px;padding:0"
      onEnter={applyKey}
      onblur={applyKey}
    />
  </span>

  <span class="vsep" aria-hidden="true"></span>

  <Select
    options={windowOptions}
    value={entities.window}
    ariaLabel="Updated in"
    chip
    size="sm"
    width="auto"
    onchange={(window) => entities.setWindow(window)}
  />
</div>
