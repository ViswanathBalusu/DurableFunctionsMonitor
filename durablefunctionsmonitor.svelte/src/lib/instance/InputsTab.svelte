<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import DangerBadge from '$lib/components/DangerBadge.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import type { InputEventOperation } from '$lib/api/types';
  import type { InputCard, InputOpOutcome, Inputs, RunOptions } from '$lib/state/inputs.svelte';
  import InputEventCard from './InputEventCard.svelte';
  import InputOpDialog from './InputOpDialog.svelte';

  interface Props {
    instance: InstanceState;
    inputs: Inputs;
    /** What came back from a run; E5-S4-T4 turns it into a toast or a recovery dialog. */
    onOutcome?: (outcome: InputOpOutcome) => void;
  }

  let { instance, inputs, onOutcome }: Props = $props();

  /** The operation waiting to be confirmed, and the card it is about. */
  let pending = $state<{ op: InputEventOperation; card: InputCard } | null>(null);

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  /** `?seq=` (from the History tab's `input` tag): which card to scroll to and focus. */
  const seq = $derived(app.router.current.query.get('seq'));

  /**
   * Runs what was confirmed and reloads the list either way: a run that worked changed the history,
   * and a run that was refused was refused because the history is not what this tab was showing.
   */
  async function run(options: RunOptions): Promise<void> {
    const target = pending;

    if (!target) {
      return;
    }

    const outcome = await inputs.run(target.op, target.card, options);

    pending = null;
    onOutcome?.(outcome);

    await inputs.load();
  }

  onMount(() => {
    // The tab loads on activation, and every run reloads it: the sequence numbers move under it
    if (!inputs.loaded) {
      void inputs.load();
    }

    return instance.onReload(() => inputs.reloadIfLoaded());
  });
</script>

<!--
  ScreenInstance.dc.html L149-L188. What the tab says before the cards matters as much as the cards:
  a read-only hub, a provider that numbers nothing, or a sub-orchestration whose parent will not be
  re-run each change what the buttons mean, and each is said once, above them all.
-->
<div class="row" style="justify-content:space-between;align-items:flex-start">
  <div style="max-width:70ch">
    <h2 style="font-size:16px;font-weight:700">Inputs this instance received</h2>
    <p style="margin-top:4px">
      Instance is <StatusChip status={instance.status ?? ''} size="sm" />. Edit the last input and rewind, replay from
      it, or restart from the initial input. Sequence numbers are the concurrency token; the list reloads after each
      run.
    </p>
  </div>

  <div class="row" style="gap:10px">
    {#if app.dangerous}
      <DangerBadge />
    {:else}
      <Chip style="background:var(--muted)">Dangerous operations off</Chip>
    {/if}
  </div>
</div>

{#if app.readOnly}
  <div class="note">
    <Chip size="sm" style="background:var(--muted)">Read only</Chip>
    All three operations are disabled: /about does not list DurableFunctionsMonitor.ReadWrite.
  </div>
{/if}

{#if inputs.warning}
  <!-- The backend's own warning, verbatim: it knows what this instance is -->
  <div class="note">{inputs.warning}</div>
{/if}

{#if inputs.noSequenceNumbers}
  <div class="note">
    {inputs.cards[0]?.buttons[0]?.why}
  </div>
{/if}

{#if inputs.isEmpty}
  <p class="meta">No inputs recorded for this execution yet.</p>
{:else}
  {#each inputs.cards as card (card.event.sequenceNumber ?? card.event.timestamp)}
    <InputEventCard
      {card}
      {showTimeAs}
      busy={inputs.busy}
      focused={seq !== null && String(card.event.sequenceNumber) === seq}
      buttonsHidden={inputs.noSequenceNumbers}
      onRun={(button) => (pending = { op: button.op, card })}
    />
  {/each}
{/if}

{#if pending}
  <InputOpDialog
    bind:open={
      () => pending !== null,
      (next) => {
        if (!next) {
          pending = null;
        }
      }
    }
    op={pending.op}
    card={pending.card}
    busy={inputs.busy}
    onConfirm={(options) => void run(options)}
  />
{/if}
