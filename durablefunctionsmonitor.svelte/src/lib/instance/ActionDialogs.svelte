<script lang="ts">
  import { getContext } from 'svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import ReasonField from '$lib/components/ReasonField.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import JsonEditor from '$lib/components/json/JsonEditor.svelte';
  import { formatJson } from '$lib/format/json';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { loadFunctionMap } from '$lib/state/instance.svelte';
  import { eventNames, type ActionPayload } from './actions.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);
  const actions = app.actions;

  const def = $derived(actions.def);

  let reason = $state('');
  let name = $state('');
  let dataText = $state('');
  let dataValid = $state(true);
  let customText = $state('');
  let customValid = $state(true);
  let withNewId = $state(true);

  /** The signal names the hub's functions are waiting for, offered as a datalist on Event name. */
  let names = $state<string[]>([]);

  /** Which dialog the fields below were filled in for; a different one starts from scratch. */
  let filledFor = '';

  $effect(() => {
    const key = actions.isOpen ? `${actions.kind}:${actions.target?.id}` : '';

    if (key && key !== filledFor) {
      const target = actions.target;
      const prefill = actions.prefill;

      reason = '';
      name = prefill?.name ?? '';
      dataText = prefill?.data === undefined ? '' : formatJson(prefill.data);
      dataValid = true;
      // The customStatus dialog opens on what the instance holds now; emptying it clears it
      customText = target?.customStatus == null ? '' : formatJson(target.customStatus);
      customValid = true;
      withNewId = true;

      if (actions.def?.event) {
        void loadNames();
      }
    }

    filledFor = key;
  });

  async function loadNames(): Promise<void> {
    const map = await loadFunctionMap(app);

    names = eventNames(map);
  }

  /** An event with no name is not an event, and JSON that does not parse cannot be sent. */
  const canConfirm = $derived.by(() => {
    if (def?.event || def?.signal) {
      return name.trim().length > 0 && dataValid;
    }

    return def?.custom ? customValid : true;
  });

  function payload(): ActionPayload {
    if (def?.event || def?.signal) {
      return { name: name.trim(), data: dataText.trim() ? (JSON.parse(dataText) as unknown) : null };
    }

    if (def?.custom) {
      return { customStatus: customText.trim() ? (JSON.parse(customText) as unknown) : null };
    }

    if (def?.restartOpts) {
      return { restartWithNewInstanceId: withNewId };
    }

    return def?.reason ? { reason } : {};
  }
</script>

<!--
  ScreenInstance.dc.html L256-L272: the one confirm dialog behind every instance action, wearing the
  wording of the action that opened it. It is mounted once, in the shell, so the workspace header,
  the peek panel over a list, the palette and the Failures rows all open the same dialog.
-->
{#if def}
  <ConfirmDialog
    bind:open={
      () => actions.isOpen,
      (next) => {
        // Escape, the overlay and Cancel all come through here, so one place closes the dialog
        if (!next) {
          actions.close();
        }
      }
    }
    title={def.title}
    body={def.body}
    band={def.band}
    confirmLabel={def.confirm}
    confirmVariant={def.variant}
    confirmDisabled={!canConfirm}
    busy={actions.busy}
    onConfirm={() => void actions.run(payload())}
  >
    {#if def.reason}
      <ReasonField bind:value={reason} id="dfm-action-reason" />
    {/if}

    {#if def.event || def.signal}
      <Field label={def.signal ? 'Signal name' : 'Event name'} for="dfm-action-event-name">
        <TextInput
          id="dfm-action-event-name"
          bind:value={name}
          mono
          list={names.length ? 'dfm-event-names' : undefined}
          placeholder="PaymentApproved"
        />
        {#if names.length}
          <!-- What the function map says these orchestrators are signalled by (React `eventNames`) -->
          <datalist id="dfm-event-names">
            {#each names as eventName (eventName)}
              <option value={eventName}></option>
            {/each}
          </datalist>
        {/if}
      </Field>

      <Field label={def.signal ? 'Signal data (JSON)' : 'Event data (JSON)'}>
        <JsonEditor
          bind:text={dataText}
          rows={4}
          ariaLabel={def.signal ? 'Signal data (JSON)' : 'Event data (JSON)'}
          onChange={(_text, isValid) => (dataValid = isValid)}
        />
      </Field>
    {/if}

    {#if def.custom}
      <Field label="customStatus (JSON)">
        <JsonEditor
          bind:text={customText}
          rows={4}
          ariaLabel="customStatus (JSON)"
          onChange={(_text, isValid) => (customValid = isValid)}
        />
      </Field>
    {/if}

    {#if def.restartOpts}
      <Checkbox label="Start with a new instance id" bind:checked={withNewId} />
    {/if}
  </ConfirmDialog>
{/if}
