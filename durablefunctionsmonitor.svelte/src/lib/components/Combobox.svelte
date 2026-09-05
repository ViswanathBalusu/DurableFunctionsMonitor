<script lang="ts">
  import * as ComboboxPrimitive from '$lib/components/ui/combobox/index.js';
  import { cn } from '$lib/utils';

  interface Props {
    /** What the user typed. Bindable. */
    value?: string;
    /** The suggestions, already filtered by the owner (the backend does the filtering). */
    items?: string[];
    placeholder?: string;
    ariaLabel: string;
    emptyText?: string;
    /** How many characters before suggestions are offered at all (React asks the backend at 2). */
    minChars?: number;
    disabled?: boolean;
    class?: string;
    /** The input element, so a screen can focus it (the palette and the id filter both do). */
    ref?: HTMLInputElement | null;
    onSelect?: (item: string) => void;
    /** Enter with nothing highlighted: apply what was typed. */
    onEnter?: (typed: string) => void;
    oninput?: (value: string) => void;
  }

  let {
    value = $bindable(''),
    items = [],
    placeholder,
    ariaLabel,
    emptyText = 'No instance id starts with that.',
    minChars = 2,
    disabled = false,
    class: className,
    ref = $bindable(null),
    onSelect,
    onEnter,
    oninput,
  }: Props = $props();

  let open = $state(false);

  const suggestions = $derived(value.length >= minChars ? items : []);

  function onInput(event: Event): void {
    value = (event.currentTarget as HTMLInputElement).value;
    open = value.length >= minChars;
    oninput?.(value);
  }

  function onValueChange(next: string): void {
    if (!next) {
      return;
    }

    value = next;
    open = false;
    onSelect?.(next);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      ref?.blur();
      return;
    }

    // Enter applies what was typed when there is nothing to choose instead: either the list is shut,
    // or it is open with no suggestions in it. bits-ui handles Enter on a highlighted option itself.
    if (event.key === 'Enter' && (!open || suggestions.length === 0)) {
      onEnter?.(value);
    }
  }
</script>

<!-- The id suggestion box of `DFM App.dc.html` L57-L67: an `.input.mono` with a `.pop` of `.mi.mono` rows. -->
<ComboboxPrimitive.Root type="single" bind:open {onValueChange} {disabled}>
  <!-- `defaultValue` seeds the input; what the user types afterwards is read from the event. -->
  <ComboboxPrimitive.Input
    bind:ref
    {placeholder}
    aria-label={ariaLabel}
    class={cn('input mono', className)}
    defaultValue={value}
    oninput={onInput}
    {onkeydown}
  />
  <ComboboxPrimitive.Portal>
    <ComboboxPrimitive.Content class="pop">
      {#each suggestions as item (item)}
        <ComboboxPrimitive.Item value={item} label={item} class="mi mono">{item}</ComboboxPrimitive.Item>
      {:else}
        <div class="grp">{emptyText}</div>
      {/each}
    </ComboboxPrimitive.Content>
  </ComboboxPrimitive.Portal>
</ComboboxPrimitive.Root>
