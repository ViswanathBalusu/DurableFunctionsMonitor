// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What happens after one of the three input-event operations ran (design §9, "Outcomes").
//
// The interesting half is the failures. A 409 means the history moved under the tab, so the list is
// reloaded before anything is said about it. A 500 from these endpoints is not an error message: it
// is a half-finished operation with a payload saying what is left to do by hand, and it is rendered
// as a dialog rather than a toast, because a toast that goes away takes the recovery with it.

import { BackendError } from '$lib/api/client';
import type {
  InputEventOperation,
  ReplayRecovery,
  ReplayResult,
  RestartInPlaceRecovery,
  UpdateInputRecovery,
} from '$lib/api/types';
import type { InputOpOutcome, InputOpResult } from '$lib/state/inputs.svelte';

export const OVER_SIZE_MESSAGE = 'Input is larger than 60 KB. Shorten it and try again.';

export const REFRESHED_PREFIX = 'The list was refreshed.';

/** The recovery payload of a failed run, and which of the three half-finished states it describes. */
export type Recovery =
  | { kind: 'restart-in-place'; body: RestartInPlaceRecovery }
  | { kind: 'replay'; body: ReplayRecovery }
  | { kind: 'update-input-and-rewind'; body: UpdateInputRecovery };

/** What the caller has to do about an outcome. */
export type OutcomeAction =
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string; reloadInputs: boolean }
  | { kind: 'recovery'; recovery: Recovery };

/** The toast of a run that worked, with the backend's own numbers in it. */
export function successMessage(op: InputEventOperation, result: InputOpResult): string {
  switch (op) {
    case 'update-input-and-rewind':
      return 'Rewound with the updated input. Details, history and inputs reloaded.';

    case 'replay': {
      const replay = result as ReplayResult;

      return (
        `Replayed from #${replay.sequenceNumber}, ${replay.deletedRows} history rows removed. ` +
        `${replay.eventName} raised again.`
      );
    }

    case 'restart-in-place':
      return 'Restarted in place. New ExecutionId; history is short again.';
  }
}

/**
 * An error body is a recovery payload when it says what did happen before it stopped: the instance
 * was purged and could not be re-created, the history was cut but the event was not raised, or the
 * input was updated but the rewind failed. Detected by shape, which is what the three bodies have
 * in common - and by shape rather than by status, because the failed rewind comes back as a 409
 * when the runtime refuses it and as a 500 when it throws, and it is the same half-finished
 * operation either way.
 */
export function recoveryOf(op: InputEventOperation, body: unknown): Recovery | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const shape = body as Record<string, unknown>;

  if (!shape.error) {
    return null;
  }

  // The restart's recovery is the only one with a name to start again with; `purged` belongs to the
  // 200 body, not to this one
  if (op === 'restart-in-place' && typeof shape.orchestratorName === 'string') {
    return { kind: 'restart-in-place', body: body as RestartInPlaceRecovery };
  }

  if (op === 'replay' && shape.raised === false) {
    return { kind: 'replay', body: body as ReplayRecovery };
  }

  if (op === 'update-input-and-rewind' && shape.inputUpdated === true && shape.rewound === false) {
    return { kind: 'update-input-and-rewind', body: body as UpdateInputRecovery };
  }

  return null;
}

/** Maps one run's outcome to the one thing the screen should do about it. */
export function outcomeAction(outcome: InputOpOutcome): OutcomeAction {
  if (outcome.ok) {
    return { kind: 'ok', message: successMessage(outcome.op, outcome.result) };
  }

  const error = outcome.error;
  const status = error instanceof BackendError ? error.status : 0;
  const message = error instanceof Error ? error.message : String(error ?? '');

  // A half-finished operation first, whatever status it arrived under: what is left to do by hand
  // matters more than which code the runtime chose to report it with
  const recovery = recoveryOf(outcome.op, error instanceof BackendError ? error.body : undefined);

  if (recovery) {
    return { kind: 'recovery', recovery };
  }

  if (status === 409) {
    // The sequence numbers moved: the list is reloaded first, and only then is anything said
    return { kind: 'error', message: `${REFRESHED_PREFIX} ${message}`, reloadInputs: true };
  }

  if (status === 413) {
    // The meter blocks this; if it arrives anyway the wording is the meter's, not the server's
    return { kind: 'error', message: OVER_SIZE_MESSAGE, reloadInputs: false };
  }

  return { kind: 'error', message, reloadInputs: false };
}
