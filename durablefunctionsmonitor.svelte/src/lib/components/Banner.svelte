<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /** The chip in front of the text (ScreenOverview.dc.html L24: "Partial results"). */
    chip?: Snippet;
    /** The action at the end of the row. */
    action?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let { chip, action, children, class: className, ...rest }: Props = $props();
</script>

<!-- role="status": a banner appears in response to something the user did, and should be announced. -->
<div class={cn('banner', className)} role="status" {...rest}>
  {@render chip?.()}
  <span>{@render children?.()}</span>
  {#if action}
    <span class="grow"></span>
    {@render action()}
  {/if}
</div>
