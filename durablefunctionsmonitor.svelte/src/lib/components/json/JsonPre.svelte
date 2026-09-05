<script lang="ts">
  import { formatJson, tokenizeJson } from '$lib/format/json';
  import { cn } from '$lib/utils';

  interface Props {
    /** Anything: a parsed object, or the raw string the backend sent. */
    value: unknown;
    /** Clips the block at this height (`overflow:hidden`) for a preview inside a panel. */
    maxHeight?: string;
    /** Drops the card background and padding, for the Summary panel look. */
    transparent?: boolean;
    /** Wraps long lines instead of scrolling them. */
    wrap?: boolean;
    class?: string;
  }

  let { value, maxHeight, transparent = false, wrap = false, class: className }: Props = $props();

  // Contracts §9: always pretty-printed with two spaces and fully expanded. There is no collapsed form.
  const tokens = $derived(tokenizeJson(formatJson(value)));

  const style = $derived(
    [
      maxHeight ? `max-height:${maxHeight};overflow:hidden` : '',
      transparent ? 'background:transparent;padding:0' : '',
      wrap ? 'white-space:pre-wrap;overflow-wrap:anywhere' : '',
    ]
      .filter(Boolean)
      .join(';') || undefined,
  );
</script>

<pre class={cn('json', className)} {style}>{#each tokens as token, index (index)}{#if token.cls}<span class={token.cls}
        >{token.text}</span
      >{:else}{token.text}{/if}{/each}</pre>
