// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { InputEventsResponse, ReplayRequest, UpdateInputAndRewindRequest } from '$lib/api/types';
import { InputCard } from '$lib/state/inputs.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instance from '../../routes/Instance.svelte';
import { inputOpCopy, previewOf, TERMINATE_LABEL, TERMINATE_NOTE } from './input-op-copy';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import {
  eventRaised,
  executionStarted,
  inputEvents,
  runningInputEvents,
} from '../../../tests/unit/fixtures/input-events';

const INSTANCE_ID = 'order-2026-09-04-000913';

function card(event = eventRaised()) {
  return new InputCard(event, { readOnly: false });
}

interface Calls {
  updates: UpdateInputAndRewindRequest[];
  replays: ReplayRequest[];
  restarts: unknown[];
}

function mount(options: { response?: InputEventsResponse } = {}) {
  const calls: Calls = { updates: [], replays: [], restarts: [] };

  const rendered = render(ScreenHarness, {
    props: {
      screen: Instance,
      path: `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs`,
      dangerous: true,
      endpoints: {
        getOrchestration: async () => detailsFixture(),
        getHistory: async () => ({ history: [] }),
        inputEvents: async () => options.response ?? inputEvents(),
        updateInputAndRewind: async (_id: string, request: UpdateInputAndRewindRequest) => {
          calls.updates.push(request);
          return { sequenceNumber: request.sequenceNumber, inputUpdated: true, rewound: true };
        },
        replay: async (_id: string, request: ReplayRequest) => {
          calls.replays.push(request);
          return {
            sequenceNumber: request.sequenceNumber,
            deletedRows: 14,
            raised: true,
            eventName: 'PaymentApproved',
          };
        },
        restartInPlace: async (_id: string, request: unknown) => {
          calls.restarts.push(request);
          return { instanceId: INSTANCE_ID, purged: true, input: {} };
        },
      } as unknown as Endpoints,
    },
  });

  return { ...rendered, calls };
}

function dialog(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

async function openOp(label: string): Promise<void> {
  await waitFor(() => expect(document.querySelectorAll('.card.icard').length).toBeGreaterThan(0));

  // The same label appears on every card that carries the operation; the enabled one is the point
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.op .btn')).find(
    (candidate) => candidate.textContent?.trim() === label && !candidate.disabled,
  ) as HTMLButtonElement;

  await fireEvent.click(button);
  await waitFor(() => expect(dialog()).not.toBeNull());
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs`);
});

describe('inputOpCopy', () => {
  it('says what the rewind replaces, and with which input', () => {
    const stored = inputOpCopy('update-input-and-rewind', card());

    expect(stored).toMatchObject({
      title: 'Update input and rewind',
      band: false,
      confirm: 'Update and rewind',
      variant: 'primary',
      reason: true,
      terminate: false,
      preview: null,
    });

    expect(stored.body).toBe(
      'Replaces the input of event #27 (PaymentApproved) and rewinds the instance with the stored input. ' +
        'Only the failed steps run again and see the new input. Completed steps keep their results.',
    );

    const edited = card();
    edited.text = '{\n  "approved": false\n}';

    expect(inputOpCopy('update-input-and-rewind', edited).body).toContain('with your edited input');
  });

  it('says what the replay deletes, behind the band', () => {
    const copy = inputOpCopy('replay', card());

    expect(copy).toMatchObject({
      title: 'Replay from event #27',
      band: true,
      confirm: 'Replay from #27',
      variant: 'danger',
      reason: false,
      terminate: false,
    });

    expect(copy.body).toBe(
      'Deletes history from event #27 onward, reopens the instance and raises PaymentApproved again ' +
        'with the stored input. Every step after the event runs again, including activities that already completed.',
    );

    // The button does not change when the instance is still running; the dialog does (design §9)
    expect(inputOpCopy('replay', card(runningInputEvents().events[1])).terminate).toBe(true);
  });

  it('says what the restart purges before it starts again', () => {
    const copy = inputOpCopy('restart-in-place', card(executionStarted()));

    expect(copy).toMatchObject({
      title: 'Purge and restart in place',
      band: true,
      confirm: 'Purge and restart',
      variant: 'danger',
      reason: false,
      terminate: false,
    });

    expect(copy.body).toBe(
      'Purges this instance, its history and its large-message blobs, then starts a new instance ' +
        'with the same id and the input shown. Sub-orchestrations of the old run are not purged.',
    );
  });

  it('quotes back the first six lines of an edited payload, and nothing when it is stored', () => {
    const edited = card();
    edited.text = ['{', '  "a": 1,', '  "b": 2,', '  "c": 3,', '  "d": 4,', '  "e": 5,', '  "f": 6', '}'].join('\n');

    expect(previewOf(edited.text).split('\n')).toHaveLength(6);
    expect(inputOpCopy('replay', edited).preview).toBe(previewOf(edited.text));
    expect(inputOpCopy('replay', card()).preview).toBeNull();
  });
});

describe('InputOpDialog', () => {
  it('confirms the rewind with the reason that was typed', async () => {
    const { calls } = mount();

    await openOp('Update input and rewind');

    expect(within(dialog()).getByText('Update input and rewind', { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).toBeNull();
    expect(dialog().querySelector('.ed')).toBeNull();

    await fireEvent.input(screen.getByLabelText('Reason (optional)'), { target: { value: 'wrong approver' } });
    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Update and rewind' }));

    await waitFor(() => expect(calls.updates[0]).toMatchObject({ sequenceNumber: 27, reason: 'wrong approver' }));

    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
  });

  it('will not replay a running instance until the terminate box is ticked', async () => {
    const { calls } = mount({ response: runningInputEvents() });

    await openOp('Replay from #27');

    expect(dialog().querySelector('.warn')).not.toBeNull();
    expect(dialog().textContent).toContain(TERMINATE_NOTE);

    const confirm = within(dialog()).getByRole('button', { name: 'Replay from #27' });

    expect(confirm).toBeDisabled();

    await fireEvent.click(within(dialog()).getByRole('checkbox', { name: TERMINATE_LABEL }));

    await waitFor(() => expect(confirm).toBeEnabled());

    await fireEvent.click(confirm);

    await waitFor(() => expect(calls.replays[0]).toEqual({ sequenceNumber: 27, terminateIfRunning: true }));
  });

  it('replays a terminal instance without asking to terminate it first', async () => {
    const { calls } = mount();

    await openOp('Replay from #27');

    expect(screen.queryByRole('checkbox', { name: TERMINATE_LABEL })).toBeNull();

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Replay from #27' }));

    await waitFor(() => expect(calls.replays[0]).toEqual({ sequenceNumber: 27 }));
  });

  it('restarts in place from the initial input, behind the band', async () => {
    const { calls } = mount({
      response: inputEvents({ events: [executionStarted({ isLast: true, operations: eventRaisedRestartAllowed() })] }),
    });

    await openOp('Restart in place');

    expect(within(dialog()).getByText('Purge and restart in place', { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).not.toBeNull();

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Purge and restart' }));

    await waitFor(() => expect(calls.restarts).toEqual([{}]));
  });

  it('cancels without sending anything', async () => {
    const { calls } = mount();

    await openOp('Replay from #27');

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
    expect(calls.replays).toEqual([]);
  });
});

/** A failed instance with no raised events: the one case where restart-in-place is offered. */
function eventRaisedRestartAllowed() {
  return {
    'restart-in-place': { allowed: true },
    'update-input-and-rewind': { allowed: true },
    replay: { allowed: false, reason: 'Use restart-in-place to re-run the whole instance from its initial input.' },
  };
}
