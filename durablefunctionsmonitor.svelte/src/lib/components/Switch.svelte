<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLButtonAttributes, 'onchange'> {
    label: string;
    /** The explanation beside the label, in `.meta` (ScreenSettings.dc.html L50). */
    hint?: string;
    /** Bindable. */
    checked?: boolean;
    onchange?: (checked: boolean) => void;
    class?: string;
  }

  let {
    label,
    hint,
    checked = $bindable(false),
    onchange,
    class: className,
    style = 'justify-content:space-between;width:100%;min-height:36px',
    type = 'button',
    ...rest
  }: Props = $props();

  function toggle(): void {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<!-- ScreenSettings.dc.html L50-L51: a full-width row, label and hint on the left, the switch on the right. -->
<button {type} class={cn('check', className)} {style} role="switch" aria-checked={checked} onclick={toggle} {...rest}>
  <span>
    {label}
    {#if hint}<span class="meta" style="margin-left:8px">{hint}</span>{/if}
  </span>
  <span class={cn('switch', checked ? 'on' : '')} aria-hidden="true"></span>
</button>
