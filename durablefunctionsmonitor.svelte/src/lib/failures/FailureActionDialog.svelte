<script lang="ts" module>
  /** The two recoveries a Failures row or group offers; the other two open the instance instead. */
  export type FailureActionKind = 'rewind' | 'purge';

  export interface FailureActionDef {
    title: string;
    body: string;
    confirm: string;
    variant: 'primary' | 'destructive';
    /** The hazard stripe: purge cannot be undone. */
    band: boolean;
    /** The action takes a reason, which is written to the audit log. */
    reason: boolean;
  }

  /**
   * What each confirm says, word for word from ScreenFailures.dc.html L97-L102. One instance and
   * many are the same dialog wearing different sentences: naming the id when there is one is what
   * makes a single purge readable without counting anything.
   */
  export function failureActionDef(kind: FailureActionKind, ids: string[]): FailureActionDef {
    const n = ids.length;
    const many = n > 1;

    if (kind === 'rewind') {
      return {
        title: many ? `Rewind ${n} instances` : `Rewind ${ids[0] ?? ''}`,
        body: `Re-runs only the failed steps${many ? ' of each instance' : ''}. Completed steps keep their results.`,
        confirm: many ? `Rewind all ${n}` : 'Rewind',
        variant: 'primary',
        band: false,
        reason: true,
      };
    }

    return {
      title: many ? `Purge ${n} instances` : `Purge ${ids[0] ?? ''}`,
      body: `Removes ${many ? 'these instances' : 'the instance'}, the history and the large-message blobs. This cannot be undone.`,
      confirm: many ? `Purge all ${n}` : 'Purge instance',
      variant: 'destructive',
      band: true,
      reason: false,
    };
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { BatchResultItem } from '$lib/api/types';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import IdsPreview from '$lib/components/IdsPreview.svelte';
  import ReasonField from '$lib/components/ReasonField.svelte';
  import { bulkToast, runBulk } from '$lib/instances/bulk';
  import { BULK_FANOUT_NOTE } from '$lib/instances/bulk-defs';
  import BulkResultDialog from '$lib/instances/BulkResultDialog.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    /** Bindable. */
    open?: boolean;
    kind: FailureActionKind;
    /** What is about to be acted on: one row, or every row of a group. */
    ids: string[];
    /** Reloads the screen once the action has run, because what it shows is now out of date. */
    onDone?: () => void | Promise<void>;
  }

  let { open = $bindable(false), kind, ids, onDone }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const def = $derived(failureActionDef(kind, ids));

  let reason = $state('');
  let busy = $state(false);

  /** The outcome, shown only when something failed: the rest is said by the toast. */
  let result = $state<{ title: string; results: BatchResultItem[] } | null>(null);

  let wasOpen = false;

  /** One dialog serves both actions and every group, so it starts empty every time it opens. */
  $effect(() => {
    if (open && !wasOpen) {
      reason = '';
    }

    wasOpen = open;
  });

  /**
   * One request per instance, or one batch request where the backend has that (E9-S3-T1). Every id's
   * outcome is reported either way, and the screen is reloaded because a rewound instance is running
   * again and a purged one is gone.
   */
  async function run(): Promise<void> {
    const label = def.confirm;

    busy = true;

    try {
      const response = await runBulk(app, { action: kind, ids, payload: def.reason ? { reason } : {} });

      open = false;
      bulkToast(app, label, response);

      if (response.failedCount > 0) {
        result = { title: label, results: response.results };
      }

      await onDone?.();
    } catch (error) {
      // Only the batch endpoint can fail as a whole; the fan-out reports per id
      app.toast.fromError(label, error);
    } finally {
      busy = false;
    }
  }
</script>

<!-- ScreenFailures.dc.html L61-L74: one confirm for a row and for a whole group alike. -->
<ConfirmDialog
  bind:open
  title={def.title}
  body={def.body}
  band={def.band}
  confirmLabel={def.confirm}
  confirmVariant={def.variant}
  hint={BULK_FANOUT_NOTE}
  {busy}
  onConfirm={() => void run()}
>
  <IdsPreview {ids} />

  {#if def.reason}
    <ReasonField bind:value={reason} id="failure-reason" />
  {/if}
</ConfirmDialog>

{#if result}
  <BulkResultDialog
    bind:open={
      () => result !== null,
      (next) => {
        if (!next) {
          result = null;
        }
      }
    }
    title={result.title}
    results={result.results}
  />
{/if}
