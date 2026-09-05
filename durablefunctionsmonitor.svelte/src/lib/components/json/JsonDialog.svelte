<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { formatJson, isBlobUrl } from '$lib/format/json';
  import BlobLink from './BlobLink.svelte';
  import JsonViewer from './JsonViewer.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
    title: string;
    /** The instance id or field path under the title, in `.meta.mono`. */
    subtitle?: string;
    value: unknown;
    width?: number;
    /** Adds a Download button; the owner knows which endpoint to call. */
    onDownload?: () => void;
    /** Told after a successful copy, so the screen can toast it (the toast host is E2). */
    onCopied?: () => void;
  }

  let { open = $bindable(false), title, subtitle, value, width = 760, onDownload, onCopied }: Props = $props();

  const isBlob = $derived(isBlobUrl(value));

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(formatJson(value));
    onCopied?.();
  }
</script>

<Dialog bind:open {title} {width}>
  {#if subtitle}
    <p class="meta mono">{subtitle}</p>
  {/if}

  {#if isBlob}
    <!-- Contracts §9: a payload that lives in a blob is linked, never fetched to be displayed. -->
    <BlobLink url={String(value)} {onDownload} />
  {:else}
    <JsonViewer {value} ariaLabel={title} />
  {/if}

  {#snippet footer()}
    {#if onDownload && !isBlob}
      <Button onclick={onDownload}>Download</Button>
    {/if}
    <Button onclick={copy}>Copy to clipboard</Button>
    <Button variant="primary" onclick={() => (open = false)}>Close</Button>
  {/snippet}
</Dialog>
