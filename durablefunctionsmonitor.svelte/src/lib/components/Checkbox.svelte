<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLButtonAttributes, 'onchange'> {
    label: string;
    /** Bindable. */
    checked?: boolean;
    onchange?: (checked: boolean) => void;
    class?: string;
  }

  let { label, checked = $bindable(false), onchange, class: className, type = 'button', ...rest }: Props = $props();

  function toggle(): void {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<!--
  The markup of ScreenEntities.dc.html L69: a button with role="checkbox", the state on aria-checked,
  and the box drawn by `.box`/`.box.on`. A native <input type="checkbox"> cannot be styled into this
  shape without hiding it, and the button is what the mockups use everywhere.
-->
<button {type} class={cn('check', className)} role="checkbox" aria-checked={checked} onclick={toggle} {...rest}>
  <span class={cn('box', checked ? 'on' : '')} aria-hidden="true"></span>
  {label}
</button>
