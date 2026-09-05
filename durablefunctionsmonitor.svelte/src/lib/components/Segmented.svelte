<script lang="ts" module>
  export interface SegmentedOption<T extends string = string> {
    value: T;
    label: string;
  }
</script>

<script lang="ts" generics="T extends string">
  import { cn } from '$lib/utils';

  interface Props {
    options: SegmentedOption<T>[];
    /** Bindable: the chosen value. */
    value: T;
    ariaLabel: string;
    size?: 'md' | 'sm';
    class?: string;
    onchange?: (value: T) => void;
  }

  let { options, value = $bindable(), ariaLabel, size = 'md', class: className, onchange }: Props = $props();

  let buttons = $state<HTMLButtonElement[]>([]);

  function choose(next: T): void {
    if (next === value) {
      return;
    }

    value = next;
    onchange?.(next);
  }

  /**
   * Arrow keys move between the segments and choose as they go, which is what a radio group does -
   * and this is a radio group wearing the `.seg` clothes (dfm-ui.css L106-L111).
   */
  function onkeydown(event: KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;

    if (step === 0) {
      return;
    }

    event.preventDefault();

    const next = (index + step + options.length) % options.length;
    choose(options[next].value);
    buttons[next]?.focus();
  }
</script>

<div class={cn('seg', size === 'sm' ? 'sm' : '', className)} role="group" aria-label={ariaLabel}>
  {#each options as option, index (option.value)}
    <button
      bind:this={buttons[index]}
      type="button"
      aria-pressed={option.value === value}
      onclick={() => choose(option.value)}
      onkeydown={(event) => onkeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>
