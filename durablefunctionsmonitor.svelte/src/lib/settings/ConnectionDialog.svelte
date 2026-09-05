<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import type { ConnectionInfo } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let info = $state<ConnectionInfo | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Loaded every time it opens rather than once: the connection is the backend's, and the backend
  // may have been pointed somewhere else since the app started.
  //
  // `open` is the only thing this effect may depend on. `app.track` reads the progress counter it
  // then raises, so a request started inside the tracked part of an effect would re-run that effect
  // for as long as anything is in flight - hence untrack.
  $effect(() => {
    if (open) {
      untrack(() => void load());
    }
  });

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      info = await app.track(() => app.endpoints.manageConnection());
    } catch (failure) {
      // Said here rather than in a toast: the dialog is what the user is looking at, and an empty
      // dialog with a toast behind it does not explain itself
      error = failure instanceof Error ? failure.message : String(failure);
      info = null;
    } finally {
      loading = false;
    }
  }
</script>

<!--
  ScreenSettings.dc.html L108-L112. Read-only throughout: the isolated backend exposes
  `/manage-connection` as a GET and has no endpoint that writes it back, so the mockup's Save button
  is not here (README D11) - and the string it does send is masked before it leaves the host.
-->
<Dialog bind:open title="Connection settings">
  {#if loading}
    <div class="progress" role="progressbar" aria-label="Loading the connection"></div>
  {/if}

  {#if error}
    <p class="meta">Could not read the connection. {error}</p>
  {/if}

  <Field label="Storage connection string" for="dfm-conn-string">
    <input
      id="dfm-conn-string"
      class="input mono"
      readonly
      value={info?.connectionString ?? ''}
      placeholder={loading ? 'loading…' : ''}
    />
  </Field>

  <Field label="Task hub name" for="dfm-conn-hub">
    <input id="dfm-conn-hub" class="input mono" readonly value={info?.hubName ?? ''} />
  </Field>

  <p class="meta">
    The storage connection this backend uses. Keys are never sent to the browser. This backend exposes the connection
    read-only.
  </p>

  {#snippet footer()}
    <Button variant="primary" onclick={() => (open = false)}>Close</Button>
  {/snippet}
</Dialog>
