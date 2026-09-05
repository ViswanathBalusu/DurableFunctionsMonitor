<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import StatusChip from './StatusChip.svelte';

  interface Props extends Omit<HTMLButtonAttributes, 'onchange'> {
    /** Bindable. */
    checked?: boolean;
    /** Renders a StatusChip beside the box - what the status filter popover shows. */
    status?: string;
    /** Plain label, when the row is not about a status. */
    label?: string;
    children?: Snippet;
    onchange?: (checked: boolean) => void;
    class?: string;
  }

  let {
    checked = $bindable(false),
    status,
    label,
    children,
    onchange,
    class: className,
    type = 'button',
    ...rest
  }: Props = $props();

  function toggle(): void {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<!-- The check row inside a popover (ScreenInstances.dc.html L34): a menuitemcheckbox with a chip. -->
<button
  {type}
  class={cn('check', className)}
  style="height:30px;width:100%"
  role="menuitemcheckbox"
  aria-checked={checked}
  onclick={toggle}
  {...rest}
>
  <span class={cn('box', checked ? 'on' : '')} aria-hidden="true"></span>
  {#if status}
    <StatusChip {status} size="sm" />
  {:else if children}
    {@render children()}
  {:else}
    {label}
  {/if}
</button>
