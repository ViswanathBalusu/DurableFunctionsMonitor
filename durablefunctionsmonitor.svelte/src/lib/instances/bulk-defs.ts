// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What each bulk confirm says, word for word from ScreenInstances.dc.html L243-L248. The wording is
// the product: it is what tells the user whether an action can be undone, what it skips and where
// the reason ends up - so it lives here, next to the dialog, and not inside it.

import type { BatchAction, BatchRequest } from '$lib/api/types';

/** The six actions the bulk bar offers. Dangerous operations are never among them (design §3). */
export type BulkAction = Extract<BatchAction, 'terminate' | 'suspend' | 'resume' | 'rewind' | 'raise-event' | 'purge'>;

export type BulkPayload = NonNullable<BatchRequest['payload']>;

export interface BulkDef {
  title: string;
  body: string;
  /** The confirm button. */
  confirm: string;
  variant: 'primary' | 'destructive';
  /** The hazard stripe: everything that cannot be undone, and the rewind. */
  band: boolean;
  /** The action takes a reason, which is written to the audit log. */
  reason?: boolean;
  /** The action takes an event name and payload. */
  event?: boolean;
}

/** The line under the controls; E9 swaps it for the batch endpoint's own wording. */
export const BULK_FANOUT_NOTE = 'Runs one request per instance · the result lists ok and failed ids.';

export function bulkDef(action: BulkAction, n: number): BulkDef {
  switch (action) {
    case 'terminate':
      return {
        title: `Terminate ${n} instances`,
        body:
          'Stops these instances where they are. Running activities finish but their results are ignored. ' +
          'This cannot be undone.',
        confirm: `Terminate ${n} instances`,
        variant: 'destructive',
        band: true,
        reason: true,
      };

    case 'suspend':
      return {
        title: `Suspend ${n} instances`,
        body: 'Pauses these instances. Timers and external events are held until you resume.',
        confirm: `Suspend ${n}`,
        variant: 'primary',
        band: false,
        reason: true,
      };

    case 'resume':
      return {
        title: `Resume ${n} instances`,
        body: 'Resumes suspended instances. Instances that are not suspended are reported as skipped.',
        confirm: `Resume ${n}`,
        variant: 'primary',
        band: false,
      };

    case 'rewind':
      return {
        title: `Rewind ${n} instances`,
        body:
          'Re-runs only the failed steps of each failed instance. Completed steps keep their results. ' +
          'Instances that are not failed are skipped.',
        confirm: `Rewind ${n}`,
        variant: 'primary',
        band: true,
        reason: true,
      };

    case 'raise-event':
      return {
        title: `Raise event on ${n} instances`,
        body: 'Sends the same event with the same payload to every selected instance.',
        confirm: 'Raise event',
        variant: 'primary',
        band: false,
        event: true,
      };

    case 'purge':
      return {
        title: `Purge ${n} instances`,
        body: 'Removes the instances, their history and their large-message blobs. This cannot be undone.',
        confirm: `Purge ${n} instances`,
        variant: 'destructive',
        band: true,
      };
  }
}
