<script lang="ts">
  import { type WithElementRef } from '$lib/utils.js';
  import type { HTMLThAttributes } from 'svelte/elements';

  let { ref = $bindable(null), class: className, children, ...restProps }: WithElementRef<HTMLThAttributes> = $props();
</script>

<th bind:this={ref} data-slot="table-head" class={className} {...restProps}>
  {@render children?.()}
</th>
