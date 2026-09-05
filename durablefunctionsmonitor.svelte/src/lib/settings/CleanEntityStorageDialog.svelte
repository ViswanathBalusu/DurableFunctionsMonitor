<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  // React's defaults, both on. The mockup draws them off, but that is one of its demo states: a
  // clean that does neither of the two things it can do is a request that does nothing.
  let removeEmptyEntities = $state(true);
  let releaseOrphanedLocks = $state(true);
  let busy = $state(false);

  // React reset both boxes every time the dialog opened; so does this
  $effect(() => {
    if (open) {
      untrack(() => {
        removeEmptyEntities = true;
        releaseOrphanedLocks = true;
      });
    }
  });

  async function run(): Promise<void> {
    busy = true;

    try {
      const result = await app.track(() =>
        app.endpoints.cleanEntityStorage({ removeEmptyEntities, releaseOrphanedLocks }),
      );

      open = false;
      app.toast.ok(
        `Cleaned entity storage: ${result.numberOfEmptyEntitiesRemoved} empty entities removed, ` +
          `${result.numberOfOrphanedLocksRemoved} locks released`,
      );

      // Whatever list is on screen counted entities that are no longer there
      app.refresh();
    } catch (error) {
      // The dialog stays open with both boxes as they were, so it can be sent again
      app.toast.fromError('Failed to clean entity storage', error);
    } finally {
      busy = false;
    }
  }
</script>

<!--
  ScreenEntities.dc.html L68-L72, opened from Settings (E6-S2-T1) and from the Entities screen
  (E10) alike - it is the same operation on the same hub, so it is the same dialog.
-->
<ConfirmDialog
  bind:open
  band
  title="Clean entity storage"
  body="Scans the Instances table for entities that hold no state or an orphaned lock and removes them. Running orchestrations are not touched."
  confirmLabel="Clean entity storage"
  confirmVariant="destructive"
  confirmDisabled={!removeEmptyEntities && !releaseOrphanedLocks}
  {busy}
  hint="POST /clean-entity-storage · the response says how many entities and locks were touched."
  onConfirm={() => void run()}
>
  <Checkbox label="Remove empty entities (no state)" bind:checked={removeEmptyEntities} />
  <Checkbox label="Release orphaned locks" bind:checked={releaseOrphanedLocks} />
</ConfirmDialog>
