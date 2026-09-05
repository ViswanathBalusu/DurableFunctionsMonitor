<script lang="ts">
  // Test-only wrapper for the components that take an anchor/content snippet pair.
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';

  let {
    kind = 'menu',
    align = 'start',
    minWidth,
    padding,
  }: { kind?: 'menu' | 'popover' | 'item'; align?: 'start' | 'end'; minWidth?: string; padding?: string } = $props();
</script>

{#if kind === 'item'}
  <MenuItem>
    {#snippet leading()}
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16" /></svg>
    {/snippet}
    Instances
    {#snippet meta()}
      g i
    {/snippet}
  </MenuItem>
{:else}
  <Pop kind={kind as 'menu' | 'popover'} {align} {minWidth} {padding} ariaLabel="Actions">
    {#snippet anchor({ props })}
      <button class="btn" type="button" {...props}>{kind === 'menu' ? 'Actions' : 'Columns'}</button>
    {/snippet}

    {#if kind === 'menu'}
      <MenuItem>Suspend</MenuItem>
      <MenuItem destructive>Purge</MenuItem>
    {:else}
      <div>Column chooser</div>
    {/if}
  </Pop>
{/if}
