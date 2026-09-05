<script lang="ts">
  import { getContext } from 'svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import IdsPreview from '$lib/components/IdsPreview.svelte';
  import ReasonField from '$lib/components/ReasonField.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import JsonEditor from '$lib/components/json/JsonEditor.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { bulkDef, bulkNote, type BulkAction, type BulkPayload } from './bulk-defs';

  interface Props {
    /** Bindable. */
    open?: boolean;
    action: BulkAction;
    /** What is about to be acted on, in selection order. */
    ids: string[];
    /** While the runner is working: the buttons are dead and the bar shows. */
    busy?: boolean;
    onConfirm: (payload: BulkPayload) => void;
    onCancel?: () => void;
  }

  let { open = $bindable(false), action, ids, busy = false, onConfirm, onCancel }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const def = $derived(bulkDef(action, ids.length));

  let reason = $state('');
  let eventName = $state('');
  let eventData = $state('');
  let eventDataValid = $state(true);

  let wasOpen = false;

  /** One dialog serves six actions, so it starts empty every time it opens. */
  $effect(() => {
    if (open && !wasOpen) {
      reason = '';
      eventName = '';
      eventData = '';
      eventDataValid = true;
    }

    wasOpen = open;
  });

  /** An event with no name is not an event; everything else can be confirmed as it stands. */
  const canConfirm = $derived(!def.event || (eventName.trim().length > 0 && eventDataValid));

  function payload(): BulkPayload {
    if (def.event) {
      return { name: eventName.trim(), data: eventData.trim() ? (JSON.parse(eventData) as unknown) : null };
    }

    return def.reason ? { reason } : {};
  }
</script>

<!-- ScreenInstances.dc.html L141-L157: one confirm for every bulk action, wearing its own wording. -->
<ConfirmDialog
  bind:open
  title={def.title}
  body={def.body}
  band={def.band}
  confirmLabel={def.confirm}
  confirmVariant={def.variant}
  confirmDisabled={!canConfirm}
  hint={bulkNote(app.capabilities.batch)}
  {busy}
  onConfirm={() => onConfirm(payload())}
  {onCancel}
>
  <IdsPreview {ids} />

  {#if def.event}
    <Field label="Event name" for="bulk-event-name">
      <TextInput id="bulk-event-name" bind:value={eventName} mono placeholder="PaymentApproved" />
    </Field>

    <Field label="Event data (JSON)">
      <JsonEditor
        bind:text={eventData}
        rows={3}
        ariaLabel="Event data (JSON)"
        onChange={(_text, isValid) => (eventDataValid = isValid)}
      />
    </Field>
  {/if}

  {#if def.reason}
    <ReasonField bind:value={reason} id="bulk-reason" />
  {/if}
</ConfirmDialog>
