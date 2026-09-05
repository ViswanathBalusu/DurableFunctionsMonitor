// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What each of the three input-event confirms says (design §9's table and ScreenInstance.dc.html
// L353-L355, verbatim). These dialogs are the last thing between an operator and a task hub that is
// about to be rewritten, so the wording tells them exactly what is about to be sent and with which
// input - the edited one or the stored one.

import type { InputEventOperation } from '$lib/api/types';
import type { InputCard } from '$lib/state/inputs.svelte';

/** How many lines of the payload the dialog quotes back (design §9). */
export const PREVIEW_LINES = 6;

export const TERMINATE_LABEL = 'Terminate the running instance first (waits up to 30 seconds)';

export const TERMINATE_NOTE = 'Late messages from the previous run can still reach the replayed instance.';

export interface InputOpCopy {
  title: string;
  body: string;
  /** The hazard stripe: the two Dangerous operations wear it, the Write one does not. */
  band: boolean;
  confirm: string;
  variant: 'primary' | 'danger';
  /** The reason field, which is written to the audit log. */
  reason: boolean;
  /** The required "terminate first" checkbox: replay of an instance that is still running. */
  terminate: boolean;
  /** The first six lines of what is about to be sent, when it is not what is stored. */
  preview: string | null;
}

/** The first six lines of the payload, so the operator confirms what is about to be sent. */
export function previewOf(text: string): string {
  return text.split('\n').slice(0, PREVIEW_LINES).join('\n');
}

export function inputOpCopy(op: InputEventOperation, card: InputCard): InputOpCopy {
  const n = card.sequenceNumber ?? '?';
  const name = card.event.name;

  // The one phrase every body turns on: what the operator is actually about to send
  const withInput = card.edited ? 'with your edited input' : 'with the stored input';
  const preview = card.edited ? previewOf(card.text) : null;

  switch (op) {
    case 'update-input-and-rewind':
      return {
        title: 'Update input and rewind',
        body:
          `Replaces the input of event #${n} (${name}) and rewinds the instance ${withInput}. ` +
          'Only the failed steps run again and see the new input. Completed steps keep their results.',
        band: false,
        confirm: 'Update and rewind',
        variant: 'primary',
        reason: true,
        terminate: false,
        preview,
      };

    case 'replay':
      return {
        title: `Replay from event #${n}`,
        body:
          `Deletes history from event #${n} onward, reopens the instance and raises ${name} again ${withInput}. ` +
          'Every step after the event runs again, including activities that already completed.',
        band: true,
        confirm: `Replay from #${n}`,
        variant: 'danger',
        reason: false,
        // The button does not change; the dialog does (design §9)
        terminate: !!card.event.operations?.replay?.requiresTerminate,
        preview,
      };

    case 'restart-in-place':
      return {
        title: 'Purge and restart in place',
        body:
          'Purges this instance, its history and its large-message blobs, then starts a new instance ' +
          'with the same id and the input shown. Sub-orchestrations of the old run are not purged.',
        band: true,
        confirm: 'Purge and restart',
        variant: 'danger',
        reason: false,
        terminate: false,
        preview,
      };
  }
}
