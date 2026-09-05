<script lang="ts" module>
  import type { BulkAction } from './bulk-defs';

  /** The six the bar offers, in the mockup's order. Dangerous operations are never bulk (design §3). */
  export const BULK_BUTTONS: { action: BulkAction; label: string; destructive?: boolean }[] = [
    { action: 'terminate', label: 'Terminate' },
    { action: 'suspend', label: 'Suspend' },
    { action: 'resume', label: 'Resume' },
    { action: 'rewind', label: 'Rewind' },
    { action: 'raise-event', label: 'Raise event' },
    { action: 'purge', label: 'Purge', destructive: true },
  ];
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import { fmtInt } from '$lib/format/number';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** How many rows are selected; the bar is not drawn at all when nothing is. */
    count: number;
    onAction: (action: BulkAction) => void;
    onClear: () => void;
  }

  let { count, onAction, onClear }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);
</script>

<!-- ScreenInstances.dc.html L130-L139: the floating bar, which only exists while something is selected. -->
{#if count > 0}
  <div class="bulk" role="toolbar" aria-label="Bulk actions">
    <span class="cnt">{fmtInt(count)} selected</span>

    {#each BULK_BUTTONS as button (button.action)}
      <Button
        variant={button.destructive ? 'destructive' : 'default'}
        disabled={app.readOnly}
        onclick={() => onAction(button.action)}
      >
        {button.label}
      </Button>
    {/each}

    <Button variant="ghost" style="height:32px;padding:0 8px" aria-label="Clear selection" onclick={onClear}>×</Button>
  </div>
{/if}
