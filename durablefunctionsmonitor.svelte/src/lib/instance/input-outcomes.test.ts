// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, PayloadTooLargeError, ServerError } from '$lib/api/client';
import type { Endpoints } from '$lib/api/endpoints';
import type { InputEventOperation, InputEventsResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import type { InputCard, InputOpOutcome } from '$lib/state/inputs.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instance from '../../routes/Instance.svelte';
import { OVER_SIZE_MESSAGE, outcomeAction, recoveryOf, successMessage } from './input-outcomes';
import { details as detailsFixture, storedInput } from '../../../tests/unit/fixtures/details';
import { executionStarted, inputEvents } from '../../../tests/unit/fixtures/input-events';

const INSTANCE_ID = 'order-2026-09-04-000913';

/** The three 500 bodies of contracts §6: a half-finished operation, not an error message. */
const restartRecovery = {
  error: 'The instance was purged but could not be restarted',
  orchestratorName: 'ProcessOrderOrchestrator',
  instanceId: INSTANCE_ID,
  input: storedInput,
};

const replayRecovery = {
  error: 'History was cut but the event was not raised',
  sequenceNumber: 27,
  eventName: 'PaymentApproved',
  deletedRows: 14,
  raised: false as const,
  input: { approved: true },
};

const updateRecovery = {
  error: 'The input was updated but the rewind failed',
  sequenceNumber: 27,
  inputUpdated: true as const,
  rewound: false as const,
};

function failed(op: InputEventOperation, error: unknown): InputOpOutcome {
  return { ok: false, op, card: {} as InputCard, error };
}

function mount(options: { response?: InputEventsResponse; endpoints?: Partial<Endpoints> } = {}) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Instance,
      path: `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs`,
      dangerous: true,
      endpoints: {
        getOrchestration: async () => detailsFixture(),
        getHistory: async () => ({ history: [] }),
        inputEvents: async () => options.response ?? inputEvents(),
        replay: async () => ({ sequenceNumber: 27, deletedRows: 14, raised: true, eventName: 'PaymentApproved' }),
        updateInputAndRewind: async () => ({ sequenceNumber: 27, inputUpdated: true, rewound: true }),
        restartInPlace: async () => ({ instanceId: INSTANCE_ID, purged: true, input: storedInput }),
        ...options.endpoints,
      } as unknown as Endpoints,
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

/** Opens the confirm of one operation and confirms it. */
async function runOp(button: string, confirm: string): Promise<void> {
  await waitFor(() => expect(document.querySelectorAll('.card.icard').length).toBeGreaterThan(0));

  const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('.op .btn')).find(
    (candidate) => candidate.textContent?.trim() === button && !candidate.disabled,
  ) as HTMLButtonElement;

  await fireEvent.click(trigger);
  await waitFor(() => expect(dialog()).not.toBeNull());
  await fireEvent.click(within(dialog()).getByRole('button', { name: confirm }));
}

function dialog(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

async function runReplay(): Promise<void> {
  await runOp('Replay from #27', 'Replay from #27');
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs`);
});

describe('successMessage', () => {
  it('says what happened, with the backend numbers', () => {
    expect(successMessage('update-input-and-rewind', { sequenceNumber: 27, inputUpdated: true, rewound: true })).toBe(
      'Rewound with the updated input. Details, history and inputs reloaded.',
    );

    expect(
      successMessage('replay', { sequenceNumber: 27, deletedRows: 14, raised: true, eventName: 'PaymentApproved' }),
    ).toBe('Replayed from #27, 14 history rows removed. PaymentApproved raised again.');

    expect(successMessage('restart-in-place', { instanceId: INSTANCE_ID, purged: true, input: null })).toBe(
      'Restarted in place. New ExecutionId; history is short again.',
    );
  });
});

describe('recoveryOf', () => {
  it('knows a recovery payload by its shape, and only for the operation it belongs to', () => {
    expect(recoveryOf('restart-in-place', restartRecovery)).toEqual({
      kind: 'restart-in-place',
      body: restartRecovery,
    });
    expect(recoveryOf('replay', replayRecovery)).toEqual({ kind: 'replay', body: replayRecovery });
    expect(recoveryOf('update-input-and-rewind', updateRecovery)).toEqual({
      kind: 'update-input-and-rewind',
      body: updateRecovery,
    });

    // A body that belongs to another operation, and a plain error body, are not recoveries
    expect(recoveryOf('replay', restartRecovery)).toBeNull();
    expect(recoveryOf('replay', { error: 'boom' })).toBeNull();
    expect(recoveryOf('replay', 'Internal Server Error')).toBeNull();
    expect(recoveryOf('update-input-and-rewind', { error: 'boom', inputUpdated: true, rewound: true })).toBeNull();

    // The 200 body of a restart is not a recovery either, however much it looks like one
    expect(recoveryOf('restart-in-place', { instanceId: INSTANCE_ID, purged: true, input: {} })).toBeNull();
  });
});

describe('outcomeAction', () => {
  it('maps the five paths of design §9', () => {
    expect(
      outcomeAction({
        ok: true,
        op: 'replay',
        card: {} as InputCard,
        result: { sequenceNumber: 27, deletedRows: 14, raised: true, eventName: 'PaymentApproved' },
      }),
    ).toEqual({ kind: 'ok', message: 'Replayed from #27, 14 history rows removed. PaymentApproved raised again.' });

    // 409: the history moved, so the list is reloaded before anything is said about it
    expect(outcomeAction(failed('replay', new ConflictError('Event #27 is now #29.')))).toEqual({
      kind: 'error',
      message: 'The list was refreshed. Event #27 is now #29.',
      reloadInputs: true,
    });

    expect(outcomeAction(failed('replay', new PayloadTooLargeError('too big')))).toEqual({
      kind: 'error',
      message: OVER_SIZE_MESSAGE,
      reloadInputs: false,
    });

    expect(outcomeAction(failed('replay', new ForbiddenError('Dangerous operations are disabled')))).toEqual({
      kind: 'error',
      message: 'Dangerous operations are disabled',
      reloadInputs: false,
    });

    expect(outcomeAction(failed('replay', new ServerError(500, 'boom', replayRecovery)))).toEqual({
      kind: 'recovery',
      recovery: { kind: 'replay', body: replayRecovery },
    });

    // The backend answers 409 when the runtime refuses the rewind and 500 when it throws; both are
    // the same half-finished operation, and the recovery wins over the status
    expect(outcomeAction(failed('update-input-and-rewind', new ConflictError('refused', updateRecovery)))).toEqual({
      kind: 'recovery',
      recovery: { kind: 'update-input-and-rewind', body: updateRecovery },
    });

    // A 500 without a recovery payload is just a failure
    expect(outcomeAction(failed('replay', new ServerError(500, 'boom')))).toEqual({
      kind: 'error',
      message: 'boom',
      reloadInputs: false,
    });
  });
});

describe('the outcome paths on screen', () => {
  it('toasts what the backend reported and reloads the workspace', async () => {
    const { app } = mount();

    await runReplay();

    await waitFor(() =>
      expect(app.toast.current?.message).toBe(
        'Replayed from #27, 14 history rows removed. PaymentApproved raised again.',
      ),
    );
  });

  it('reloads the list before it says the list was refreshed', async () => {
    const { app } = mount({
      endpoints: {
        replay: async () => {
          throw new ConflictError('History changed since you read it: event #27 is now #29.');
        },
      } as Partial<Endpoints>,
    });

    await waitFor(() => expect(document.querySelectorAll('.card.icard').length).toBe(2));

    await runReplay();

    await waitFor(() =>
      expect(app.toast.current?.message).toBe(
        'The list was refreshed. History changed since you read it: event #27 is now #29.',
      ),
    );
    expect(app.toast.current?.kind).toBe('error');
  });

  it('says the meter’s own words when a 413 arrives anyway', async () => {
    const { app } = mount({
      endpoints: {
        replay: async () => {
          throw new PayloadTooLargeError('Payload too large');
        },
      } as Partial<Endpoints>,
    });

    await runReplay();

    await waitFor(() => expect(app.toast.current?.message).toBe(OVER_SIZE_MESSAGE));
  });

  it('opens a dialog, not a toast, when the replay stopped half way', async () => {
    const { app } = mount({
      endpoints: {
        replay: async () => {
          throw new ServerError(500, 'The event could not be raised', replayRecovery);
        },
      } as Partial<Endpoints>,
    });

    await runReplay();

    await waitFor(() =>
      expect(
        screen.getByText('History was cut and the instance reopened, but PaymentApproved was not raised', {
          selector: 'h3',
        }),
      ).toBeInTheDocument(),
    );

    expect(dialog().textContent).toContain('14 rows were removed after event #27');
    expect(dialog().querySelector('.warn')).not.toBeNull();
    expect(app.toast.current).toBeNull();

    // Raising it is the existing action, prefilled with what the response handed back
    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Raise event now' }));

    await waitFor(() => expect(app.actions.kind).toBe('raise'));
    expect(app.actions.prefill).toEqual({ name: 'PaymentApproved', data: { approved: true } });
  });

  it('offers to start the instance again when the restart purged it and stopped', async () => {
    const { app } = mount({
      response: inputEvents({
        events: [
          executionStarted({
            isLast: true,
            operations: {
              'restart-in-place': { allowed: true },
              'update-input-and-rewind': { allowed: true },
              replay: { allowed: false, reason: 'no' },
            },
          }),
        ],
      }),
      endpoints: {
        restartInPlace: async () => {
          throw new ServerError(500, 'Could not start it again', restartRecovery);
        },
      } as Partial<Endpoints>,
    });

    await runOp('Restart in place', 'Purge and restart');

    await waitFor(() =>
      expect(
        screen.getByText('The instance was purged but could not be restarted', { selector: 'h3' }),
      ).toBeInTheDocument(),
    );

    expect(dialog().textContent).toContain(`large-message blobs of ${INSTANCE_ID}`);
    expect(dialog().querySelector('.ed pre')?.textContent).toContain('orderId');

    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Copy input' }));
    await waitFor(() => expect(app.toast.current?.message).toBe('Copied the input to the clipboard'));

    // The workspace holds a Start new instance dialog of its own, prefilled from the recovery
    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Start new instance with this input' }));

    await waitFor(() => expect(screen.getByText('Start new instance', { selector: 'h3' })).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Leave empty for a generated GUID')).toHaveValue(INSTANCE_ID);
    expect(screen.getByLabelText('Orchestrator')).toHaveValue('ProcessOrderOrchestrator');
  });

  it('offers the rewind when the input was updated but the rewind failed', async () => {
    const { app } = mount({
      endpoints: {
        updateInputAndRewind: async () => {
          throw new ServerError(500, 'The rewind failed', updateRecovery);
        },
      } as Partial<Endpoints>,
    });

    await runOp('Update input and rewind', 'Update and rewind');

    await waitFor(() =>
      expect(screen.getByText('The input was updated but the rewind failed', { selector: 'h3' })).toBeInTheDocument(),
    );

    expect(dialog().textContent).toContain('Event #27 now carries the new input');

    // The recovery hands off to the action that already exists; it does nothing of its own
    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Rewind' }));

    await waitFor(() => expect(app.actions.kind).toBe('rewind'));
  });
});
