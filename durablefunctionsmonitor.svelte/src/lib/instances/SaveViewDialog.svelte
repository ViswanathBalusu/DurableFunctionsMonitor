<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import TextInput from '$lib/components/TextInput.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
    /** What the name field is prefilled with: the statuses and the range, as the mockup names a view. */
    suggestedName: string;
    onSave: (name: string) => void;
  }

  let { open = $bindable(false), suggestedName, onSave }: Props = $props();

  let name = $state('');

  let wasOpen = false;

  /** Prefilled afresh every time it opens: the filters it names have moved on since the last save. */
  $effect(() => {
    if (open && !wasOpen) {
      name = suggestedName;
    }

    wasOpen = open;
  });

  function save(): void {
    const trimmed = name.trim();

    if (!trimmed) {
      return;
    }

    open = false;
    onSave(trimmed);
  }
</script>

<!-- ScreenInstances.dc.html L23: the one field behind "Save current view…". -->
<Dialog bind:open title="Save current view" width={480}>
  <Field label="Name" for="save-view-name">
    <TextInput id="save-view-name" bind:value={name} onEnter={save} />
  </Field>

  <p class="meta">The filters, the columns, the sort and the time range, saved in this browser.</p>

  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!name.trim()} onclick={save}>Save</Button>
  {/snippet}
</Dialog>
