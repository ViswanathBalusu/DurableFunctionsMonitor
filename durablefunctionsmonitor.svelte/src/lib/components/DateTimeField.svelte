<script lang="ts">
  import { fromDate, getLocalTimeZone, type DateValue, type ZonedDateTime } from '@internationalized/date';
  import * as DateFieldPrimitive from '$lib/components/ui/date-field/index.js';
  import { cn } from '$lib/utils';
  import Checkbox from './Checkbox.svelte';

  interface Props {
    /** ISO 8601 UTC, or null for "not set". Bindable. */
    value?: string | null;
    /** Which clock the segments show, and therefore what the user is typing (contracts §8). */
    showTimeAs?: 'UTC' | 'Local';
    /** 'minute' by default; the history filter wants seconds. */
    granularity?: 'minute' | 'second';
    ariaLabel: string;
    /** Shown in place of the segments when there is no value. */
    placeholder?: string;
    /**
     * The React "till" checkbox: when the caller passes a boolean, an inline checkbox is rendered and
     * the field is disabled while it is off. Leave undefined for a field that is always on.
     */
    enabled?: boolean;
    enabledLabel?: string;
    disabled?: boolean;
    class?: string;
    onchange?: (value: string | null) => void;
    onEnabledChange?: (enabled: boolean) => void;
  }

  let {
    value = $bindable(null),
    showTimeAs = 'UTC',
    granularity = 'minute',
    ariaLabel,
    placeholder = 'now',
    enabled = $bindable<boolean | undefined>(undefined),
    enabledLabel = 'Set',
    disabled = false,
    class: className,
    onchange,
    onEnabledChange,
  }: Props = $props();

  const timeZone = $derived(showTimeAs === 'Local' ? getLocalTimeZone() : 'UTC');

  /** The value the segments show: the same instant, in the zone the user is reading. */
  const zoned = $derived.by<ZonedDateTime | undefined>(() => {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : fromDate(date, timeZone);
  });

  const isDisabled = $derived(disabled || enabled === false);

  function onValueChange(next: DateValue | undefined): void {
    // toDate() resolves the value back to the instant it names - the field is always fed a
    // ZonedDateTime, so the zone is the one the segments were showing - and what leaves this
    // component is therefore always UTC.
    const iso = next ? next.toDate(timeZone).toISOString() : null;

    if (iso === value) {
      return;
    }

    value = iso;
    onchange?.(iso);
  }

  function onEnabledToggle(next: boolean): void {
    enabled = next;
    onEnabledChange?.(next);
  }
</script>

<!--
  A segmented date field rather than a text box: every segment is separately typeable and arrow-keyable,
  and there is no format to get wrong. Presented as an `.input.mono` 190px wide (ScreenInstance.dc.html
  L122-L123, ScreenSettings.dc.html L101). An unparsable entry cannot leave the field - bits-ui only
  reports a complete, valid date - so the last good value stands, which is the React behaviour.
-->
<span class="row" style="gap:8px">
  {#if enabled !== undefined}
    <Checkbox label={enabledLabel} checked={enabled} onchange={onEnabledToggle} />
  {/if}

  <DateFieldPrimitive.Root
    value={zoned}
    {onValueChange}
    {granularity}
    hourCycle={24}
    disabled={isDisabled}
    locale="en-GB"
  >
    <DateFieldPrimitive.Input aria-label={ariaLabel} class={cn('input mono', className)} style="width:190px">
      {#snippet children({ segments })}
        {#if zoned}
          <!-- Keyed by index: the separators between segments all report part 'literal'. -->
          {#each segments as segment, index (index)}
            <DateFieldPrimitive.Segment part={segment.part}>{segment.value}</DateFieldPrimitive.Segment>
          {/each}
        {:else}
          <span class="muted">{placeholder}</span>
        {/if}
      {/snippet}
    </DateFieldPrimitive.Input>
  </DateFieldPrimitive.Root>
</span>
