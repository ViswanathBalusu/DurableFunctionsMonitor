<script lang="ts">
  import { cn } from '$lib/utils';

  interface Props {
    kind?: 'ok' | 'error';
    message: string;
    /** Rendered only when the caller can actually retry the thing that failed. */
    onRetry?: () => void;
    onClose?: () => void;
    class?: string;
  }

  let { kind = 'error', message, onRetry, onClose, class: className }: Props = $props();
</script>

<!-- DFM App.dc.html L216. role="status" rather than alert: it is a report, not an interruption. -->
<div class={cn('toast', kind === 'ok' ? 'ok' : '', className)} role="status">
  <span class="grow">{message}</span>
  {#if onRetry}
    <button class="btn" type="button" onclick={onRetry}>Retry</button>
  {/if}
  <button class="btn ghost" type="button" style="height:28px;padding:0 8px" aria-label="Dismiss" onclick={onClose}>
    ×
  </button>
</div>
