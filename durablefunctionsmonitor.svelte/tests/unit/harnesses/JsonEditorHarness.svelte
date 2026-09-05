<script lang="ts">
  // Test-only wrapper: JsonEditor takes its footer as a snippet.
  import JsonEditor from '$lib/components/json/JsonEditor.svelte';
  import SizeMeter from '$lib/components/json/SizeMeter.svelte';

  let {
    text = $bindable('{}'),
    readOnly = false,
    onChange,
  }: { text?: string; readOnly?: boolean; onChange?: (text: string, isValid: boolean) => void } = $props();
</script>

<JsonEditor bind:text {readOnly} ariaLabel="Input" {onChange}>
  {#snippet footer()}
    <span>text mode · JSON valid</span>
    <SizeMeter bytes={text.length * 2} class="grow" />
  {/snippet}
</JsonEditor>
