<script lang="ts">
  import { getContext } from 'svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const toast = $derived(app.toast.current);

  function retry(): void {
    const current = toast;
    app.toast.dismiss();
    current?.retry?.();
  }
</script>

<!--
  A plain conditional render rather than `svelte-sonner`, which E2-S6-T1 allows and this stylesheet
  calls for: `.toast` is already `position:fixed` at the bottom right (dfm-ui.css L251-L253), and
  the app shows exactly one toast at a time - sonner would contribute a stacking, positioning and
  animation layer that this design does not use, and then have to be told to stop doing all three.
-->
{#if toast}
  {#key toast.id}
    <Toast
      kind={toast.kind}
      message={toast.message}
      onRetry={toast.retry ? retry : undefined}
      onClose={() => app.toast.dismiss()}
    />
  {/key}
{/if}
