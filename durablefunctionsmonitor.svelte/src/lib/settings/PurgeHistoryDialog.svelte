<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import CheckRow from '$lib/components/CheckRow.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import DateTimeField from '$lib/components/DateTimeField.svelte';
  import Field from '$lib/components/Field.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { PURGE_STATUSES, PurgeHistory } from '$lib/state/purge-history.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
  }

  let { open = $bindable(false) }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const purge = new PurgeHistory({ app });

  // React reset the filter every time the dialog opened, and so does this: a range worked out when
  // the app started is not the last 24 hours by the time somebody opens this on a screen left open
  // overnight. Untracked, so the effect depends on `open` and on nothing the reset writes.
  $effect(() => {
    if (open) {
      untrack(() => purge.reset());
    }
  });

  /** Entities are the backend's to support: this one answers 400 for them, and says so in /about. */
  const entitiesSupported = $derived(app.capabilities.purgeEntities);
</script>

<!--
  ScreenSettings.dc.html L100-L105. No "n instances match" line above the button: the backend purges
  and counts in one call and has no way to count without purging, so a number here would be one this
  app made up (contracts §9).
-->
<ConfirmDialog
  bind:open
  band
  title="Purge instance history"
  body="Removes history for every instance matching the filter. This cannot be undone."
  confirmLabel="Purge"
  confirmVariant="destructive"
  cancelLabel={purge.result === null ? 'Cancel' : 'Close'}
  confirmDisabled={!purge.valid}
  busy={purge.busy}
  onConfirm={() => void purge.run()}
>
  <div class="row">
    <Field label="Created from">
      <DateTimeField bind:value={purge.timeFrom} showTimeAs={app.prefs.showTimeAs} ariaLabel="Created from" />
    </Field>
    <Field label="Created till">
      <DateTimeField bind:value={purge.timeTill} showTimeAs={app.prefs.showTimeAs} ariaLabel="Created till" />
    </Field>
  </div>

  <div class="row">
    {#each PURGE_STATUSES as status (status)}
      <!-- role="checkbox" rather than the filter popover's menuitemcheckbox: this is a form, not a menu -->
      <CheckRow
        {status}
        role="checkbox"
        style="height:30px"
        checked={purge.has(status)}
        onchange={(checked) => purge.toggle(status, checked)}
      />
    {/each}
  </div>

  <div class="row">
    <Checkbox
      label="Include durable entities"
      checked={purge.includeEntities}
      disabled={!entitiesSupported}
      title={entitiesSupported ? undefined : 'Not supported by this backend'}
      onchange={(checked) => (purge.includeEntities = checked)}
    />
  </div>

  {#if purge.result !== null}
    <p class="meta">Purged {purge.result} instances</p>
  {/if}
</ConfirmDialog>
