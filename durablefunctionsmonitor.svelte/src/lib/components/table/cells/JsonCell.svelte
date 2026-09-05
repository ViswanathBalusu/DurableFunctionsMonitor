<script lang="ts">
  import LinkButton from '$lib/components/LinkButton.svelte';
  import { previewJson } from '$lib/format/json';

  interface Props {
    value: unknown;
    /** The dialog title the viewer opens with ("customStatus", "input", ...). */
    title: string;
    onOpenJson?: (value: unknown, title: string) => void;
  }

  let { value, title, onOpenJson }: Props = $props();

  const preview = $derived(previewJson(value));
</script>

<!--
  Decision D4: a table cell shows a one-line preview and opens the full, expanded viewer on click.
  Nothing is truncated silently - the preview is a link, and it says so.
-->
{#if value === null || value === undefined || value === ''}
  —
{:else}
  <LinkButton mono stopPropagation onclick={() => onOpenJson?.(value, title)}>{preview}</LinkButton>
{/if}
