<script lang="ts">
  import type { Component } from 'svelte';
  import type { LucideProps } from '@lucide/svelte';

  interface Props extends Omit<LucideProps, 'size' | 'strokeWidth' | 'absoluteStrokeWidth' | 'aria-hidden'> {
    /** The `@lucide/svelte` icon component to render, e.g. `import Settings from '@lucide/svelte/icons/settings'`. */
    icon: Component<LucideProps>;
    /** Defaults to 20; pass 16 for icons inside buttons. */
    size?: number | string;
    class?: string;
  }

  let { icon: IconComponent, size = 20, class: cls = '', ...rest }: Props = $props();
</script>

<IconComponent {...rest} {size} strokeWidth={2.5} absoluteStrokeWidth aria-hidden="true" class={cls} />
