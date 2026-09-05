<script lang="ts" module>
  export interface SelectOption<T extends string = string> {
    value: T;
    label: string;
  }
</script>

<script lang="ts" generics="T extends string">
  import * as SelectPrimitive from '$lib/components/ui/select/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    options: SelectOption<T>[];
    /** Bindable. */
    value: T;
    ariaLabel: string;
    /** Any CSS width; the mockups set explicit widths on the filter selects. */
    width?: string;
    size?: 'md' | 'sm';
    /** Renders as a filter chip (`.fchip`) instead of an input (ScreenInstances.dc.html L48). */
    chip?: boolean;
    mono?: boolean;
    disabled?: boolean;
    class?: string;
    onchange?: (value: T) => void;
  }

  let {
    options,
    value = $bindable(),
    ariaLabel,
    width,
    size = 'md',
    chip = false,
    mono = false,
    disabled = false,
    class: className,
    onchange,
  }: Props = $props();

  const selected = $derived(options.find((option) => option.value === value));

  function onValueChange(next: string): void {
    value = next as T;
    onchange?.(next as T);
  }
</script>

<!--
  The mockups keep the native-select look: a `.sel` wrapper (whose ::after draws the arrow) around a
  trigger that is styled as an `.input` - or as a `.fchip` inside a filter rail. The listbox itself is
  the restyled bits-ui Select, which brings the keyboard behaviour a native select would not give us
  inside a popover.
-->
<div class={cn('sel', className)} style={width ? `width:${width}` : undefined}>
  <SelectPrimitive.Root type="single" bind:value {onValueChange} {disabled}>
    <SelectPrimitive.Trigger
      aria-label={ariaLabel}
      class={cn(chip ? 'fchip' : 'input', mono ? 'mono' : '')}
      style={size === 'sm' ? 'height:30px' : undefined}
    >
      {selected?.label ?? ''}
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Content>
      {#each options as option (option.value)}
        <SelectPrimitive.Item value={option.value} label={option.label} class={mono ? 'mono' : undefined} />
      {/each}
    </SelectPrimitive.Content>
  </SelectPrimitive.Root>
</div>
