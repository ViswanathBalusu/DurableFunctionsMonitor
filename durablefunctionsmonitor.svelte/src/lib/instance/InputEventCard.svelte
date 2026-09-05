<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import JsonEditor from '$lib/components/json/JsonEditor.svelte';
  import SizeMeter from '$lib/components/json/SizeMeter.svelte';
  import { fmtBytes } from '$lib/format/bytes';
  import { fmtDateTimeMs } from '$lib/format/time';
  import type { ShowTimeAs } from '$lib/state/prefs.svelte';
  import type { InputCard, OperationButton } from '$lib/state/inputs.svelte';

  interface Props {
    card: InputCard;
    showTimeAs?: ShowTimeAs;
    /** While an operation is running: nothing on the tab may be pressed. */
    busy?: boolean;
    /** The card `?seq=` asked for: scrolled to and focused when the tab opens (contracts §4). */
    focused?: boolean;
    /** Every button is dead and no reason is offered: the provider numbers nothing (E5-S4-T1). */
    buttonsHidden?: boolean;
    onRun?: (button: OperationButton) => void;
  }

  let { card, showTimeAs = 'UTC', busy = false, focused = false, buttonsHidden = false, onRun }: Props = $props();

  let element = $state<HTMLDivElement | null>(null);

  const event = $derived(card.event);

  $effect(() => {
    if (!focused || !element) {
      return;
    }

    element.scrollIntoView({ block: 'center' });
    element.querySelector<HTMLElement>('.jse-theme-dfm')?.focus();
  });
</script>

<!--
  ScreenInstance.dc.html L158-L188: one card per input event - what it was, when, and the editor over
  it with the operations beside it. A disabled button keeps its place and says why underneath, which
  is the whole point of the tab: the backend's verdict is the content.
-->
<div class="card icard" bind:this={element} data-seq={event.sequenceNumber ?? ''}>
  <div class="head">
    <span class="seq">#{event.sequenceNumber ?? '?'}</span>
    <span class="ev">{event.eventType}</span>
    <span class="mono">{event.name}</span>
    {#if event.isLast}
      <Chip size="sm" style="background:var(--accent);color:var(--accent-foreground)">last</Chip>
    {/if}
    <span class="when">{fmtDateTimeMs(event.timestamp, showTimeAs)}</span>
  </div>

  <div class="bodyrow">
    <JsonEditor
      bind:text={card.text}
      readOnly={!card.editable}
      rows={7}
      ariaLabel={`Input of event #${event.sequenceNumber ?? '?'}`}
    >
      {#snippet footer()}
        {#if card.edited}
          <Chip size="sm" class="st-running">edited</Chip>
        {:else if card.editable}
          <span>stored input</span>
        {:else}
          <span>read only · {fmtBytes(card.bytes)}</span>
        {/if}

        <SizeMeter bytes={card.bytes} />

        {#if card.edited}
          <Button
            variant="ghost"
            style="height:24px;padding:0 8px;margin-left:auto;font-size:12px"
            onclick={() => card.reset()}
          >
            Reset to stored
          </Button>
        {/if}
      {/snippet}
    </JsonEditor>

    {#if !buttonsHidden}
      <div class="ops">
        {#each card.buttons as button (button.op)}
          <div class="op">
            <Button
              variant={button.variant === 'danger' ? 'danger' : 'default'}
              disabled={button.disabled || busy}
              onclick={() => onRun?.(button)}
            >
              {button.label}
            </Button>
            <div class="why">{button.why}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
