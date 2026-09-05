<script lang="ts">
  import Tabs from '$lib/components/Tabs.svelte';
  import type { Instances, InstancesView } from '$lib/state/instances.svelte';
  import { fmtInt } from '$lib/format/number';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  const tabs = [
    { id: 'table', label: 'Table' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'histogram', label: 'Histogram' },
  ];

  const shownLabel = $derived(
    `${fmtInt(instances.rows.length)} loaded · sorted by ${instances.orderBy} ${instances.dir}`,
  );
</script>

<!-- ScreenInstances.dc.html L69-L75: the three views, and what is on screen right now. -->
<Tabs {tabs} value={instances.view} ariaLabel="View" onchange={(id) => instances.setView(id as InstancesView)}>
  {#snippet controls()}
    <span class="meta" style="align-self:center;padding:0 4px 4px">{shownLabel}</span>
  {/snippet}
</Tabs>
