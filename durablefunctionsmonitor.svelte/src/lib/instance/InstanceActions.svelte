<script lang="ts">
  import { getContext } from 'svelte';
  import Button, { type ButtonVariant } from '$lib/components/Button.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import { entityKey, type ActionKind, type ActionTarget } from './actions.svelte';

  interface Props {
    instance: InstanceState;
  }

  interface ActionButton {
    kind: ActionKind;
    label: string;
    variant?: ButtonVariant;
    disabled: boolean;
    /** Why it is dead, or what it does; the mockup puts both in `title` (L37). */
    title?: string;
  }

  let { instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const details = $derived(instance.details);
  const status = $derived(details?.runtimeStatus ?? '');

  /** A suspended instance is resumed; everything else can be suspended (React parity). */
  const suspended = $derived(status === 'Suspended');

  /** Rewind re-runs the failed steps, so it only means anything for a failed instance. */
  const canRewind = $derived(status === 'Failed');

  const readOnly = $derived(app.readOnly);
  const readOnlyTitle = $derived(readOnly ? 'Read-only mode' : undefined);

  /**
   * What the dialogs are told about this instance. The history count is passed on only once the
   * whole history is loaded: the purge dialog says how many rows it is about to remove, and half a
   * page is not that number.
   */
  const target = $derived<ActionTarget>({
    id: instance.instanceId,
    name: instance.functionName,
    status,
    isEntity: instance.isEntity,
    key: entityKey(instance.instanceId),
    customStatus: details?.customStatus,
    historyRows: instance.history.rows.length > 0 && !instance.history.hasMore ? instance.history.rows.length : null,
  });

  const buttons = $derived.by<ActionButton[]>(() => {
    // Entities have two of the seven: everything else is about an orchestration's history
    if (instance.isEntity) {
      return [
        { kind: 'signal', label: 'Send signal', disabled: readOnly, title: readOnlyTitle },
        { kind: 'purge', label: 'Purge', variant: 'destructive', disabled: readOnly, title: readOnlyTitle },
      ];
    }

    return [
      {
        kind: suspended ? 'resume' : 'suspend',
        label: suspended ? 'Resume' : 'Suspend',
        disabled: readOnly,
        title: readOnlyTitle,
      },
      { kind: 'raise', label: 'Raise event', disabled: readOnly, title: readOnlyTitle },
      { kind: 'custom', label: 'Set customStatus', disabled: readOnly, title: readOnlyTitle },
      { kind: 'restart', label: 'Restart', disabled: readOnly, title: readOnlyTitle },
      {
        kind: 'rewind',
        label: 'Rewind',
        disabled: readOnly || !canRewind,
        title: readOnly
          ? 'Read-only mode'
          : canRewind
            ? 'Re-run the failed steps'
            : 'Rewind is available for failed instances',
      },
      { kind: 'terminate', label: 'Terminate', variant: 'destructive', disabled: readOnly, title: readOnlyTitle },
      { kind: 'purge', label: 'Purge', variant: 'destructive', disabled: readOnly, title: readOnlyTitle },
    ];
  });
</script>

<!--
  ScreenInstance.dc.html L33-L39. Every button opens a confirm and none of them acts on its own; in
  a read-only hub every one of them is dead, because it would only ever answer 403.
-->
{#each buttons as button (button.label)}
  <Button
    variant={button.variant ?? 'default'}
    disabled={button.disabled}
    title={button.title}
    onclick={() => app.actions.open(button.kind, target)}
  >
    {button.label}
  </Button>
{/each}
