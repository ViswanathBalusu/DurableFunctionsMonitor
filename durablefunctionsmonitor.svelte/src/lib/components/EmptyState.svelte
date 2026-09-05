<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
    title: string;
    text?: string;
    /** The buttons under the text, centred (ScreenOverview.dc.html L27). */
    actions?: Snippet;
    children?: Snippet;
    class?: string;
  }

  let { title, text, actions, children, class: className, ...rest }: Props = $props();
</script>

<div class={cn('empty', className)} {...rest}>
  <h2 class="display">{title}</h2>
  {#if text}<p>{text}</p>{/if}
  {@render children?.()}
  {#if actions}
    <div class="row" style="justify-content:center;margin-top:16px">
      {@render actions()}
    </div>
  {/if}
</div>
