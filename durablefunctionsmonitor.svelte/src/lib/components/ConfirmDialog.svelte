<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
    title: string;
    /** The sentence under the title; the stylesheet keeps it under 70ch. */
    body?: string;
    /** The hazard stripe: destructive and Dangerous operations wear it. */
    band?: boolean;
    confirmLabel: string;
    confirmVariant?: 'primary' | 'destructive' | 'danger';
    cancelLabel?: string;
    /** A third button between Cancel and the confirm ("Terminate and replay", ...). */
    secondaryLabel?: string;
    confirmDisabled?: boolean;
    /** While the operation runs: the progress bar shows and every button is disabled. */
    busy?: boolean;
    /** A last note under the controls, in `.meta`. */
    hint?: string;
    width?: number;
    /** Extra controls: a reason field, an ids preview, checkboxes. */
    children?: Snippet;
    onConfirm?: () => void;
    onSecondary?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    title,
    body,
    band = false,
    confirmLabel,
    confirmVariant = 'primary',
    cancelLabel = 'Cancel',
    secondaryLabel,
    confirmDisabled = false,
    busy = false,
    hint,
    width = 560,
    children,
    onConfirm,
    onSecondary,
    onCancel,
  }: Props = $props();

  function cancel(): void {
    open = false;
    onCancel?.();
  }
</script>

<Dialog bind:open {title} {band} {width}>
  {#if body}
    <p>{body}</p>
  {/if}

  {@render children?.()}

  {#if hint}
    <p class="meta">{hint}</p>
  {/if}

  {#if busy}
    <!-- The striped bar of dfm-ui.css L238: something is running, and nothing else may be pressed. -->
    <div class="progress" role="progressbar" aria-label="Working"></div>
  {/if}

  {#snippet footer()}
    <!-- Footer order of ScreenInstance.dc.html L271: cancel, secondary, confirm. -->
    <Button onclick={cancel} disabled={busy}>{cancelLabel}</Button>
    {#if secondaryLabel}
      <Button onclick={() => onSecondary?.()} disabled={busy}>{secondaryLabel}</Button>
    {/if}
    <Button variant={confirmVariant} onclick={() => onConfirm?.()} disabled={confirmDisabled || busy}>
      {confirmLabel}
    </Button>
  {/snippet}
</Dialog>
