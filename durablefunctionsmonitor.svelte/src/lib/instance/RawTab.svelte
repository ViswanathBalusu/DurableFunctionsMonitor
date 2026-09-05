<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import JsonViewer from '$lib/components/json/JsonViewer.svelte';
  import { formatJson } from '$lib/format/json';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';

  interface Props {
    instance: InstanceState;
  }

  let { instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  async function copy(): Promise<void> {
    // Contracts §9: what is copied is what is shown - pretty-printed, two spaces, whole
    await navigator.clipboard.writeText(formatJson(instance.details));

    app.toast.ok('Copied the instance status JSON');
  }
</script>

<!--
  ScreenInstance.dc.html L227-L246: the whole status document as the backend returned it, in the
  viewer with its menu bar on (tree/text/table and search), and a Copy under it. Nothing is
  reshaped on the way: this tab is what the other tabs are read against.
-->
<div class="brutal-flat" style="overflow:hidden;background:var(--card)">
  <!-- Nothing is drawn until the details arrive: an empty viewer over null says nothing -->
  {#if instance.details}
    <JsonViewer value={instance.details} ariaLabel="Instance status JSON" />
  {/if}
</div>

<div class="row" style="justify-content:flex-end">
  <Button onclick={copy}>Copy to clipboard</Button>
</div>
