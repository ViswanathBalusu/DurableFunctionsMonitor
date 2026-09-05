<script lang="ts">
  import Field from './Field.svelte';
  import TextInput from './TextInput.svelte';

  interface Props {
    /** Bindable. */
    value?: string;
    label?: string;
    id?: string;
  }

  let { value = $bindable(''), label = 'Reason (optional)', id = 'dfm-reason' }: Props = $props();
</script>

<!-- Every write dialog offers the same reason box, and says where it ends up (ScreenInstance L265). -->
<Field {label} for={id}>
  <TextInput {id} bind:value placeholder="Written to the audit log" />
</Field>
