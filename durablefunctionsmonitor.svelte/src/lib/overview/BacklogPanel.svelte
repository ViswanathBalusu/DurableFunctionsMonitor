<script lang="ts" module>
  import type { StorageResponse } from '$lib/api/types';

  /** What the panel says a deep queue means, under the numbers. */
  export const BACKLOG_META = 'A deep work-item queue means activities are waiting for workers.';

  /** `control-00` - what a control queue is called once the hub's own prefix is off it. */
  export function queueLabel(name: string, partition: number | null): string {
    return partition === null ? name : `control-${String(partition).padStart(2, '0')}`;
  }

  /** `4 · all owned`, or `3 of 4 owned` when a lease is between owners. */
  export function partitionsLine(storage: StorageResponse): string {
    const total = storage.partitions.length;
    const owned = storage.partitions.filter((partition) => !!partition.owner).length;

    return owned === total ? `${total} · all owned` : `${owned} of ${total} owned`;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { fmtInt } from '$lib/format/number';
  import { providerName } from '$lib/settings/ConnectionPanel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { workItemsQueued } from './NeedsAttention.svelte';

  interface Props {
    storage: StorageResponse;
  }

  let { storage }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const queued = $derived(workItemsQueued(storage));

  const deep = $derived(queued !== null && queued > app.prefs.thresholds.queueDepth);

  const controls = $derived(storage.queues.filter((queue) => queue.kind === 'control'));

  const rows = $derived<KvRow[]>([
    ...(queued === null ? [] : [{ k: 'workitems', v: fmtInt(queued), mono: true, extra: deep ? deepChip : '' }]),
    ...controls.map((queue) => ({
      k: queueLabel(queue.name, queue.partition),
      v: fmtInt(queue.approximateMessageCount ?? 0),
      mono: true,
    })),
    { k: 'partitions', v: partitionsLine(storage), mono: true },
  ]);
</script>

{#snippet deepChip()}
  <Chip size="sm" class="st-running">deep</Chip>
{/snippet}

<!-- ScreenOverview.dc.html L90-L101: how much work is waiting, and where it is waiting. -->
<Panel title="Backlog">
  {#snippet meta()}
    <Chip size="sm">{providerName(storage.provider)}</Chip>
  {/snippet}

  <Kv {rows} columns={3} />

  <p class="meta" style="margin-top:12px">
    {BACKLOG_META}
    <LinkButton onclick={() => app.router.navigate({ name: 'storage', hub: app.hub })}>Storage</LinkButton>
  </p>
</Panel>
