<script lang="ts" module>
  /** Why two of the four row actions are not offered over a whole group (L55). */
  export const GROUP_NOTE =
    'Update input, Replay and Restart in place open the instance because they need the payload in front of you.';

  /** How many instances a group carries in full; B3 stops at 50 and keeps counting (B3 §FailuresAggregator). */
  export function groupNote(count: number, listed: number): string {
    return listed < count ? `the newest ${listed} of ${count} · ${GROUP_NOTE}` : GROUP_NOTE;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { FailureGroup } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import { fmtTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import FailureRow from './FailureRow.svelte';

  interface Props {
    group: FailureGroup;
    open: boolean;
    onToggle: () => void;
    /** The ids of the rows below, which is what the two group buttons act on. */
    onRewindAll: (instanceIds: string[]) => void;
    onPurgeAll: (instanceIds: string[]) => void;
    onRewind: (instanceId: string) => void;
    onPurge: (instanceId: string) => void;
  }

  let { group, open, onToggle, onRewindAll, onPurgeAll, onRewind, onPurge }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /**
   * What the buttons will actually do. A group counts every instance that failed but carries the
   * newest fifty of them, so a button that said "all 340" would be promising thirty-nine it has
   * never been told the id of.
   */
  const ids = $derived(group.instances.map((instance) => instance.instanceId));
</script>

<!-- ScreenFailures.dc.html L28-L58: one orchestrator and one error signature, expanded in place. -->
<div class="group" aria-expanded={open}>
  <button class="ghead" type="button" aria-expanded={open} onclick={onToggle}>
    <span class="tri" aria-hidden="true"></span>
    <span>{group.name}</span>
    <span class="mono muted grow" style="font-weight:400">{group.signature}</span>
    <Chip size="sm" class="st-failed">{group.count}</Chip>
    <span class="fine muted">last {fmtTime(group.lastSeenAt, app.prefs.showTimeAs)}</span>
  </button>

  {#if open}
    {#each group.instances as instance (instance.instanceId)}
      <FailureRow {instance} name={group.name} {onRewind} {onPurge} />
    {/each}

    <div class="gfoot">
      <Button disabled={app.readOnly} onclick={() => onRewindAll(ids)}>Rewind all {ids.length}</Button>

      <Button variant="destructive" disabled={app.readOnly} onclick={() => onPurgeAll(ids)}>
        Purge all {ids.length}
      </Button>

      <span class="meta" style="margin-left:auto">{groupNote(group.count, ids.length)}</span>
    </div>
  {/if}
</div>
