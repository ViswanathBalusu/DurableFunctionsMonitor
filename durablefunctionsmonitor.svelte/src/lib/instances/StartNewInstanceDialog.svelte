<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Combobox from '$lib/components/Combobox.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import JsonEditor from '$lib/components/json/JsonEditor.svelte';
  import SizeMeter from '$lib/components/json/SizeMeter.svelte';
  import { utf16Bytes } from '$lib/format/bytes';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { isJsonInput, type StartInstance } from '$lib/state/start-instance.svelte';

  interface Props {
    start: StartInstance;
  }

  let { start }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /**
   * Read from the text rather than from the editor's own parse report: the two agree in text mode,
   * and this way an input the dialog was opened with is judged before it has been touched.
   * Empty is valid: it is sent as null.
   */
  const jsonValid = $derived(isJsonInput(start.inputText));

  const bytes = $derived(utf16Bytes(start.inputText));

  const canStart = $derived(start.orchestrator.trim().length > 0 && jsonValid && !start.busy);
</script>

<!-- ScreenInstances.dc.html L160-L172. -->
<Dialog
  bind:open={
    () => start.open,
    (next) => {
      if (!next) {
        start.close();
      }
    }
  }
  title="Start new instance"
>
  <Field label="Orchestrator" for="start-orchestrator">
    {#if app.host.functionGraphAvailable}
      <!-- The names of the function map, which only a host with a function graph publishes -->
      <Combobox
        bind:value={start.orchestrator}
        items={start.orchestrators}
        minChars={0}
        ariaLabel="Orchestrator"
        emptyText="No orchestrator with that name."
        placeholder="ProcessOrderOrchestrator"
      />
    {:else}
      <TextInput id="start-orchestrator" bind:value={start.orchestrator} mono placeholder="ProcessOrderOrchestrator" />
    {/if}
  </Field>

  <Field label="Instance id" for="start-instance-id">
    <TextInput
      id="start-instance-id"
      bind:value={start.instanceId}
      mono
      placeholder="Leave empty for a generated GUID"
    />
  </Field>

  <Field label="Input (JSON)">
    <JsonEditor bind:text={start.inputText} rows={6} ariaLabel="Input (JSON)">
      {#snippet footer()}
        <span>text mode · JSON {jsonValid ? 'valid' : 'invalid'}</span>
        <span style="margin-left:auto">
          <SizeMeter {bytes} />
        </span>
      {/snippet}
    </JsonEditor>
  </Field>

  {#snippet footer()}
    <Button disabled={start.busy} onclick={() => start.close()}>Cancel</Button>
    <Button variant="primary" disabled={!canStart} onclick={() => void start.start()}>Start</Button>
  {/snippet}
</Dialog>
