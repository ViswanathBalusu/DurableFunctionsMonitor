<script lang="ts">
  // Test-only wrapper for the form controls that take children (Field).
  import Field from '$lib/components/Field.svelte';
  import TextInput from '$lib/components/TextInput.svelte';

  let { which }: { which: 'field' } = $props();

  let value = $state('');
</script>

{#if which === 'field'}
  <Field label="Instance id" for="instance-id">
    <TextInput id="instance-id" bind:value mono />
  </Field>
{/if}
