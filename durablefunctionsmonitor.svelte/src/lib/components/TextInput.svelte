<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'class'> {
    /** Bindable. */
    value?: string;
    /** Monospace, for ids, filters and JSON fragments. */
    mono?: boolean;
    /** Called with the current value when Enter is pressed (filter fields apply on Enter). */
    onEnter?: (value: string) => void;
    class?: string;
  }

  let { value = $bindable(''), mono = false, onEnter, class: className, onkeydown, ...rest }: Props = $props();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      onEnter?.(value);
    }

    (onkeydown as ((event: KeyboardEvent) => void) | undefined)?.(event);
  }
</script>

<input bind:value class={cn('input', mono ? 'mono' : '', className)} onkeydown={handleKeydown} {...rest} />
