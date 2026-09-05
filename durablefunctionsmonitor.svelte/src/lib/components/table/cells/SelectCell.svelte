<script lang="ts">
  import { cn } from '$lib/utils';

  interface Props {
    checked: boolean;
    label?: string;
    onToggle: () => void;
  }

  let { checked, label = 'Select row', onToggle }: Props = $props();
</script>

<!--
  The select box a table row carries. DataTable renders its own for the built-in selection column;
  this is for tables that put a box somewhere else (the failure groups, the input events).
-->
<button
  class={cn('box', checked ? 'on' : '')}
  type="button"
  aria-label={label}
  aria-pressed={checked}
  onclick={(event) => {
    event.stopPropagation();
    onToggle();
  }}
></button>
