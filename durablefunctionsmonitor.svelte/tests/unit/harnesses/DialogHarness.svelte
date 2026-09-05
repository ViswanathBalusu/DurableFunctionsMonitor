<script lang="ts">
  // Test-only wrapper: Dialog takes its body and footer as snippets.
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';

  let {
    open = $bindable(false),
    band = false,
    width = 560,
  }: { open?: boolean; band?: boolean; width?: number } = $props();
</script>

<Dialog bind:open title="Terminate 3 instances?" {band} {width}>
  <p>They stop where they are.</p>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="destructive">Terminate</Button>
  {/snippet}
</Dialog>
