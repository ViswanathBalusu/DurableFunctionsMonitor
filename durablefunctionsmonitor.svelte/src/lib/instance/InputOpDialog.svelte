<script lang="ts">
  import type { InputEventOperation } from '$lib/api/types';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import ReasonField from '$lib/components/ReasonField.svelte';
  import type { InputCard, RunOptions } from '$lib/state/inputs.svelte';
  import { TERMINATE_LABEL, TERMINATE_NOTE, inputOpCopy } from './input-op-copy';

  interface Props {
    /** Bindable. */
    open?: boolean;
    op: InputEventOperation;
    card: InputCard;
    /** While the operation runs: the buttons are dead and the progress bar shows. */
    busy?: boolean;
    onConfirm: (options: RunOptions) => void;
    onCancel?: () => void;
  }

  let { open = $bindable(false), op, card, busy = false, onConfirm, onCancel }: Props = $props();

  const copy = $derived(inputOpCopy(op, card));

  let reason = $state('');
  let terminate = $state(false);

  let openedFor = '';

  /** One dialog serves three operations, so it starts empty every time it opens. */
  $effect(() => {
    const key = open ? `${op}:${card.sequenceNumber}` : '';

    if (key && key !== openedFor) {
      reason = '';
      terminate = false;
    }

    openedFor = key;
  });

  /** The terminate checkbox is an interlock, not an option: the replay cannot run without it. */
  const canConfirm = $derived(!copy.terminate || terminate);

  function confirm(): void {
    onConfirm({
      reason: copy.reason ? reason : undefined,
      terminateIfRunning: copy.terminate ? terminate : undefined,
    });
  }
</script>

<!--
  ScreenInstance.dc.html L353-L355 and design §9's table: the last thing between an operator and a
  rewritten task hub. It quotes back the first six lines of what is about to be sent whenever that
  is not what is stored, because "with your edited input" is only worth saying if the input is shown.
-->
<ConfirmDialog
  bind:open
  title={copy.title}
  body={copy.body}
  band={copy.band}
  confirmLabel={copy.confirm}
  confirmVariant={copy.variant}
  confirmDisabled={!canConfirm}
  {busy}
  onConfirm={confirm}
  {onCancel}
>
  {#if copy.preview}
    <div class="ed" style="min-height:0">
      <pre style="font-size:12px;max-height:150px">{copy.preview}</pre>
    </div>
  {/if}

  {#if copy.terminate}
    <Checkbox label={TERMINATE_LABEL} bind:checked={terminate} />
    <p class="meta">{TERMINATE_NOTE}</p>
  {/if}

  {#if copy.reason}
    <ReasonField bind:value={reason} id="dfm-input-op-reason" />
  {/if}
</ConfirmDialog>
