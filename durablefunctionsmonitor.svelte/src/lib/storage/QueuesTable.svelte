<script lang="ts" module>
  import type { StorageQueue } from '$lib/api/types';
  import { fmtInt } from '$lib/format/number';

  /** The partition number as the queue itself spells it: `control-00`, not `control-0`. */
  export function partitionLabel(partition: number | null): string {
    return String(partition ?? 0).padStart(2, '0');
  }

  /**
   * What a queue's depth means (ScreenStorage.dc.html L36-L40). The activities queue is the backlog
   * workers have not picked up; a control queue is the orchestrator mail of one partition. A count
   * nobody could read says neither that it is idle nor that it is deep.
   */
  export function queueMeaning(queue: StorageQueue, threshold: number): string {
    if (queue.kind === 'workitems') {
      const base = 'Activities waiting for a worker.';

      return isDeep(queue, threshold)
        ? `${base} Above the ${fmtInt(threshold)} threshold: scale out or check for a stuck worker.`
        : base;
    }

    if (queue.approximateMessageCount === 0) {
      return 'Idle.';
    }

    return `Orchestrator messages for partition ${partitionLabel(queue.partition)}.`;
  }

  /** Whether the backlog is over the threshold in the preferences (E6-S3-T1's `queueDepth`). */
  export function isDeep(queue: StorageQueue, threshold: number): boolean {
    return queue.kind === 'workitems' && (queue.approximateMessageCount ?? 0) > threshold;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { Storage } from '$lib/state/storage.svelte';

  interface Props {
    storage: Storage;
  }

  let { storage }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const threshold = $derived(app.prefs.thresholds.queueDepth);

  /** The activities queue first, then the control queues in partition order (L36-L40). */
  const rows = $derived<StorageQueue[]>([...(storage.workitems ? [storage.workitems] : []), ...storage.controlQueues]);
</script>

<!-- ScreenStorage.dc.html L44-L57: what is in each queue, and what that means for the hub. -->
<!-- `tabindex="0"` because the frame scrolls sideways and holds nothing focusable: without it a
     keyboard alone cannot reach the columns past the edge (axe `scrollable-region-focusable`). The
     compiler's rule is about widgets, and a scroll container is the documented exception to it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="tbl-wrap keep" role="region" aria-label="Queues, scrollable" tabindex="0">
  <table class="tbl" aria-label="Queues">
    <thead>
      <tr>
        <th>queue</th>
        <th>approximate messages</th>
        <th>what it means</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as queue (queue.name)}
        <tr>
          <td class="mono">{queue.name}</td>
          <td class="mono">
            {#if queue.approximateMessageCount === null}
              —
            {:else if isDeep(queue, threshold)}
              <span class="chip st-running">{fmtInt(queue.approximateMessageCount)}</span>
            {:else}
              {fmtInt(queue.approximateMessageCount)}
            {/if}
          </td>
          <td>{queueMeaning(queue, threshold)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
