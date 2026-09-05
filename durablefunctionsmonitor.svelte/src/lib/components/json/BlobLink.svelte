<script lang="ts">
  import Button from '$lib/components/Button.svelte';

  interface Props {
    /** The blob URL the backend returned in place of a payload too large to inline. */
    url: string;
    onDownload?: () => void;
  }

  let { url, onDownload }: Props = $props();
</script>

<!--
  Contracts §9: a payload that lives in a blob is not fetched to be shown - the URL is shown, and the
  download is an explicit act.
-->
<div class="row">
  <a class="link mono" href={url} target="_blank" rel="noreferrer">{url}</a>
  {#if onDownload}
    <Button size="sm" onclick={onDownload}>Download</Button>
  {/if}
</div>
