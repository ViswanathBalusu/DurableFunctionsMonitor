<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import CheckRow from '$lib/components/CheckRow.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import type { RuntimeStatus } from '$lib/api/types';
  import { RUNTIME_STATUSES } from '$lib/format/status';

  interface Props {
    selected: RuntimeStatus[];
    onchange: (statuses: RuntimeStatus[]) => void;
  }

  let { selected, onchange }: Props = $props();

  let open = $state(false);

  /**
   * The popover edits its own copy and hands it over when it closes (React `isStatusSelectOpen`):
   * eight reloads while the user ticks eight boxes is not what anybody wants.
   */
  let draft = $state<RuntimeStatus[]>([]);

  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      draft = [...selected];
    }

    if (!open && wasOpen) {
      const applied = [...draft];

      // Out of the effect: this reloads the list, and an effect is not where that belongs
      queueMicrotask(() => onchange(applied));
    }

    wasOpen = open;
  });

  function toggle(status: RuntimeStatus): void {
    draft = draft.includes(status) ? draft.filter((item) => item !== status) : [...draft, status];
  }
</script>

<!-- ScreenInstances.dc.html L31-L37: the eight statuses, applied together when the popover closes. -->
<Pop bind:open kind="popover" ariaLabel="Add status filter" minWidth="230px" padding="10px">
  {#snippet anchor({ props })}
    <button {...props} class="fchip add" type="button">+ status</button>
  {/snippet}

  {#each RUNTIME_STATUSES as status (status)}
    <CheckRow {status} checked={draft.includes(status)} onchange={() => toggle(status)} />
  {/each}

  <div class="row" style="justify-content:flex-end;margin-top:8px">
    <Button variant="primary" size="sm" onclick={() => (open = false)}>Apply</Button>
  </div>
</Pop>
