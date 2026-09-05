<script lang="ts">
  import { getContext } from 'svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { formatJson } from '$lib/format/json';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import { entityKey, type ActionTarget } from './actions.svelte';
  import { previewOf } from './input-op-copy';
  import type { Recovery } from './input-outcomes';

  interface Props {
    /** Bindable. */
    open?: boolean;
    recovery: Recovery;
    instance: InstanceState;
  }

  let { open = $bindable(false), recovery, instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const target = $derived<ActionTarget>({
    id: instance.instanceId,
    name: instance.functionName,
    status: instance.status ?? '',
    isEntity: instance.isEntity,
    key: entityKey(instance.instanceId),
    customStatus: instance.details?.customStatus,
  });

  /** The input the recovery hands back, when it hands one back at all. */
  const input = $derived(recovery.kind === 'update-input-and-rewind' ? undefined : recovery.body.input);

  const preview = $derived(input === undefined ? null : previewOf(formatJson(input)));

  const copy = $derived.by(() => {
    switch (recovery.kind) {
      case 'restart-in-place':
        return {
          title: 'The instance was purged but could not be restarted',
          body:
            'Start it again with the input below. The purge removed the history and large-message blobs of ' +
            `${recovery.body.instanceId}.`,
          confirm: 'Start new instance with this input',
          secondary: 'Copy input',
        };

      case 'replay':
        return {
          title: `History was cut and the instance reopened, but ${recovery.body.eventName} was not raised`,
          body:
            `${recovery.body.deletedRows} rows were removed after event #${recovery.body.sequenceNumber} and the ` +
            'instance is Running again. Raise the event now so the replay continues.',
          confirm: 'Raise event now',
          secondary: undefined,
        };

      case 'update-input-and-rewind':
        return {
          title: 'The input was updated but the rewind failed',
          body:
            `Event #${recovery.body.sequenceNumber} now carries the new input. Rewind the instance to run the ` +
            'failed steps with it.',
          confirm: 'Rewind',
          secondary: undefined,
        };
    }
  });

  /** Every recovery hands off to a dialog that already exists; none of them acts on its own. */
  function confirm(): void {
    // Read first: closing this dialog is what takes the recovery off the screen that owns it
    const current = recovery;
    const to = target;

    open = false;

    switch (current.kind) {
      case 'restart-in-place':
        app.dialogs.startNewInstance?.openWith({
          instanceId: current.body.instanceId,
          orchestrator: current.body.orchestratorName,
          input: current.body.input,
        });
        return;

      case 'replay':
        app.actions.open('raise', to, {
          prefill: { name: current.body.eventName, data: current.body.input },
        });
        return;

      case 'update-input-and-rewind':
        app.actions.open('rewind', to);
    }
  }

  async function copyInput(): Promise<void> {
    await navigator.clipboard.writeText(formatJson(input));

    app.toast.ok('Copied the input to the clipboard');
  }
</script>

<!--
  ScreenInstance.dc.html L363-L365. A 500 from these three endpoints is not a failure message: it is
  a half-finished operation that says what is left to do, which is why it is a dialog and never a
  toast - a toast goes away, and takes the recovery with it.
-->
<ConfirmDialog
  bind:open
  title={copy.title}
  body={copy.body}
  band
  confirmLabel={copy.confirm}
  confirmVariant="primary"
  cancelLabel="Close"
  secondaryLabel={copy.secondary}
  onConfirm={confirm}
  onSecondary={() => void copyInput()}
>
  {#if preview}
    <div class="ed" style="min-height:0">
      <pre style="font-size:12px;max-height:150px">{preview}</pre>
    </div>
  {/if}
</ConfirmDialog>
