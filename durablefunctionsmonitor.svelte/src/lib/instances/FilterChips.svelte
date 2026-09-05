<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import { FILTER_OPERATOR_LABELS } from '$lib/filters/odata';
  import type { Instances } from '$lib/state/instances.svelte';
  import { cn } from '$lib/utils';
  import NameFacet from './NameFacet.svelte';
  import RangeChip from './RangeChip.svelte';
  import StatusFacet from './StatusFacet.svelte';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  /** `instanceId starts with order-2026-` - the free filter, as the chip spells it. */
  const freeLabel = $derived(
    `${instances.column} ${FILTER_OPERATOR_LABELS[instances.op].toLowerCase()} ${instances.applied}`,
  );
</script>

<!--
  ScreenInstances.dc.html L28-L53. Every chip goes through the state, which writes the URL and
  reloads: the chips are a view of the filters, never a second copy of them.
-->
<div class="chips2" aria-label="Filters">
  {#each instances.statuses as status (status)}
    <span class="fchip">
      {status}
      <button
        class="x"
        type="button"
        aria-label={`Remove ${status} filter`}
        onclick={() => instances.toggleStatus(status)}
      >
        ×
      </button>
    </span>
  {/each}

  <StatusFacet selected={instances.statuses} onchange={(statuses) => instances.setStatuses(statuses)} />

  <span class="vsep" aria-hidden="true"></span>

  {#each instances.names as name (name)}
    <span class="fchip">
      <span class="mono" style="font-weight:600">{name}</span>
      <button class="x" type="button" aria-label={`Remove ${name} filter`} onclick={() => instances.toggleName(name)}>
        ×
      </button>
    </span>
  {/each}

  <NameFacet
    selected={instances.names}
    options={instances.nameOptions}
    onopen={() => void instances.loadNameOptions()}
    onchange={(names) => instances.setNames(names)}
  />

  <span class="vsep" aria-hidden="true"></span>

  <RangeChip />

  {#if instances.applied}
    <span class="vsep" aria-hidden="true"></span>
    <span class="fchip">
      <span class="mono" style="font-weight:600">{freeLabel}</span>
      <button class="x" type="button" aria-label="Remove filter" onclick={() => instances.clearFilter()}>×</button>
    </span>
  {/if}

  <span class="vsep" aria-hidden="true"></span>

  <!-- Dashed while the entities are out, solid with a × once they are in (L51) -->
  <button
    class={cn('fchip', instances.includeEntities ? '' : 'add')}
    type="button"
    aria-pressed={instances.includeEntities}
    onclick={() => instances.setIncludeEntities(!instances.includeEntities)}
  >
    {instances.includeEntities ? 'Entities included ×' : '+ include entities'}
  </button>

  {#if instances.hasFilters}
    <Button variant="ghost" size="sm" onclick={() => instances.clearAll()}>Clear all</Button>
  {/if}
</div>
