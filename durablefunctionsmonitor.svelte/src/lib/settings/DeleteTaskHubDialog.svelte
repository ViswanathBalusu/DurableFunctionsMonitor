<script lang="ts" module>
  /** ScreenSettings.dc.html L153: everything this drops, said before it is dropped. */
  export const DELETE_TASK_HUB_BODY =
    'Drops the Instances, History and Partitions tables, all control and work-item queues and the large-message ' +
    'container. Running orchestrations are lost.';

  /**
   * What the webview says instead of navigating. VS Code has no login screen to go back to - the
   * hub was chosen when the view was opened - so the honest thing is to say the hub is gone.
   */
  export const DELETE_TASK_HUB_VSCODE_NOTE =
    'This task hub no longer exists. Close this view and open another task hub.';
</script>

<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Field from '$lib/components/Field.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const hub = $derived(app.about?.hubName || app.hub);

  let typed = $state('');
  let busy = $state(false);
  let deleted = $state(false);

  // Every opening starts from an empty field: a hub name left in it from last time would let the
  // most destructive button in the app be reached in one click.
  $effect(() => {
    if (open) {
      untrack(() => {
        typed = '';
        deleted = false;
      });
    }
  });

  async function run(): Promise<void> {
    busy = true;

    try {
      await app.track(() => app.endpoints.deleteTaskHub());

      app.toast.ok(`Deleted task hub ${hub}`);

      if (app.host.kind === 'vscode') {
        // Nothing to navigate to, so the dialog stays and says what happened
        deleted = true;
        return;
      }

      open = false;
      app.router.navigate({ name: 'login' });
    } catch (error) {
      app.toast.fromError('Failed to delete task hub', error);
    } finally {
      busy = false;
    }
  }
</script>

<!--
  ScreenSettings.dc.html L107 and L153. The one dialog in the app that asks for the name to be
  typed: it is the only action that takes the whole hub with it.
-->
<ConfirmDialog
  bind:open
  band
  title={`Delete task hub ${hub}`}
  body={DELETE_TASK_HUB_BODY}
  confirmLabel="Delete task hub"
  confirmVariant="destructive"
  confirmDisabled={typed.trim() !== hub || deleted}
  {busy}
  onConfirm={() => void run()}
>
  <Field label="Type the task hub name to confirm" for="dfm-delete-hub">
    <TextInput id="dfm-delete-hub" mono bind:value={typed} placeholder={hub} disabled={deleted} />
  </Field>

  {#if deleted}
    <p class="meta">{DELETE_TASK_HUB_VSCODE_NOTE}</p>
  {/if}
</ConfirmDialog>
