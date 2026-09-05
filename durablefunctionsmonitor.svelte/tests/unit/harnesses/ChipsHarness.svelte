<script lang="ts">
  // Test-only wrapper for the chip-sized components, which take their text as a snippet.
  import Chip from '$lib/components/Chip.svelte';
  import DangerBadge from '$lib/components/DangerBadge.svelte';
  import MiniCounter from '$lib/components/MiniCounter.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import Tag from '$lib/components/Tag.svelte';

  let {
    which,
    label = '',
    status = 'Running',
    count = 0,
    ...rest
  }: {
    which: 'chip' | 'status' | 'danger' | 'tag' | 'mini';
    label?: string;
    status?: string;
    count?: number;
    [key: string]: unknown;
  } = $props();
</script>

{#if which === 'chip'}
  <Chip {...rest}>{label}</Chip>
{:else if which === 'status'}
  <StatusChip {status} {...rest} />
{:else if which === 'danger'}
  <DangerBadge {...rest} />
{:else if which === 'tag'}
  <Tag {...rest}>{label}</Tag>
{:else if which === 'mini'}
  <MiniCounter {count} {status} {...rest} />
{/if}
