// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type {
  InputEventOperation,
  InputEventsResponse,
  ReplayRequest,
  UpdateInputAndRewindRequest,
} from '$lib/api/types';
import { MAX_INLINE_BYTES } from '$lib/format/bytes';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { InputCard, Inputs, OPERATION_DESCRIPTIONS, OVER_SIZE_REASON, READ_ONLY_REASON } from './inputs.svelte';
import { Prefs } from './prefs.svelte';
import {
  ELIGIBILITY_ROWS,
  RESTART_INITIAL_ONLY_REASON,
  SUB_ORCHESTRATION_WARNING,
} from '../../../tests/unit/fixtures/input-eligibility';
import {
  eventRaised,
  executionStarted,
  inputEvents,
  runningInputEvents,
} from '../../../tests/unit/fixtures/input-events';
import { storedInput } from '../../../tests/unit/fixtures/details';

const INSTANCE_ID = 'order-2026-09-04-000913';

interface Calls {
  restarts: unknown[];
  updates: UpdateInputAndRewindRequest[];
  replays: ReplayRequest[];
}

function makeInputs(
  options: {
    response?: InputEventsResponse;
    readOnly?: boolean;
    fail?: InputEventOperation;
  } = {},
) {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);

  const calls: Calls = { restarts: [], updates: [], replays: [] };

  const raise = (op: InputEventOperation) => {
    if (options.fail === op) {
      throw new Error('409 Conflict');
    }
  };

  const endpoints = {
    inputEvents: async () => options.response ?? inputEvents(),
    restartInPlace: async (_id: string, request: unknown) => {
      raise('restart-in-place');
      calls.restarts.push(request);
      return { instanceId: INSTANCE_ID, purged: true, input: storedInput };
    },
    updateInputAndRewind: async (_id: string, request: UpdateInputAndRewindRequest) => {
      raise('update-input-and-rewind');
      calls.updates.push(request);
      return { sequenceNumber: request.sequenceNumber, inputUpdated: true, rewound: true };
    },
    replay: async (_id: string, request: ReplayRequest) => {
      raise('replay');
      calls.replays.push(request);
      return { sequenceNumber: request.sequenceNumber, deletedRows: 14, raised: true, eventName: 'PaymentApproved' };
    },
  } as unknown as Endpoints;

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({
    hubName: 'DurableFunctionsHub',
    readOnly: options.readOnly ?? false,
    permissions: options.readOnly ? [] : ['DurableFunctionsMonitor.ReadWrite'],
  });

  return { app, calls, inputs: new Inputs({ app, instanceId: INSTANCE_ID }) };
}

function card(index = 0, readOnly = false) {
  const events = [executionStarted(), eventRaised()];

  return new InputCard(events[index], { readOnly });
}

describe('the eligibility matrix', () => {
  it.each(ELIGIBILITY_ROWS)('$name', (row) => {
    const buttons = new InputCard(row.event, { readOnly: false }).buttons;

    // Every operation the backend answered for gets a button; none is ever hidden (design §9)
    expect(buttons.map((button) => button.op)).toEqual(['restart-in-place', 'update-input-and-rewind', 'replay']);

    expect(buttons.filter((button) => !button.disabled).map((button) => button.op)).toEqual(row.allowed);

    for (const button of buttons) {
      // A refused operation says the backend's reason verbatim; an allowed one says what it does
      expect(button.why).toBe(row.why[button.op] ?? OPERATION_DESCRIPTIONS[button.op]);
    }
  });

  it('labels and colours the buttons as the mockup does', () => {
    const buttons = card(1).buttons;

    expect(buttons.map((button) => [button.label, button.variant])).toEqual([
      ['Restart in place', 'danger'],
      ['Update input and rewind', 'default'],
      ['Replay from #27', 'danger'],
    ]);
  });

  it('carries the terminate flag the replay of a running instance needs', () => {
    const running = new InputCard(runningInputEvents().events[1], { readOnly: false });

    expect(running.buttons.find((button) => button.op === 'replay')?.requiresTerminate).toBe(true);

    // A failed instance is terminal, so there is nothing to terminate first
    expect(card(1).buttons.find((button) => button.op === 'replay')?.requiresTerminate).toBe(false);
  });
});

describe('InputCard', () => {
  it('opens on the stored input, pretty-printed, and knows when it has been edited', () => {
    const first = card();

    expect(first.text).toBe(JSON.stringify(storedInput, null, 2));
    expect(first.edited).toBe(false);

    // The initial input of an instance that has received an event can no longer be acted on
    expect(first.editable).toBe(false);

    const last = card(1);

    expect(last.editable).toBe(true);

    last.text = '{ "approved": false }';

    expect(last.edited).toBe(true);

    last.reset();

    expect(last.edited).toBe(false);
  });

  it('disables everything once the editor holds more than the backend stores inline', () => {
    const big = card(1);

    big.text = `"${'x'.repeat(MAX_INLINE_BYTES / 2)}"`;

    expect(big.bytes).toBeGreaterThan(MAX_INLINE_BYTES);
    expect(big.over).toBe(true);

    for (const button of big.buttons) {
      expect(button.disabled).toBe(true);
    }

    // The size is the reason for the ones that were allowed; the rest keep the backend's own
    expect(big.buttons.find((button) => button.op === 'update-input-and-rewind')?.why).toBe(OVER_SIZE_REASON);
    expect(big.buttons.find((button) => button.op === 'restart-in-place')?.why).toBe(RESTART_INITIAL_ONLY_REASON);
  });

  it('says Read-only mode before anything else, and takes the editor with it', () => {
    const locked = card(1, true);

    expect(locked.editable).toBe(false);

    for (const button of locked.buttons) {
      expect(button.disabled).toBe(true);
      expect(button.why).toBe(READ_ONLY_REASON);
    }
  });
});

describe('Inputs', () => {
  it('loads the events into cards and keeps the answer', async () => {
    const { inputs } = makeInputs();

    await inputs.load();

    expect(inputs.cards).toHaveLength(2);
    expect(inputs.cards[0].event.eventType).toBe('ExecutionStarted');
    expect(inputs.cards[1].event.isLast).toBe(true);
    expect(inputs.response?.dangerousOperationsEnabled).toBe(true);
    expect(inputs.loaded).toBe(true);
    expect(inputs.isEmpty).toBe(false);
  });

  it('renders one warning, whichever operation carried it', async () => {
    const { inputs } = makeInputs({
      response: inputEvents({
        parentInstanceId: 'order-2026-09-04-000900',
        events: [
          executionStarted({
            operations: {
              'restart-in-place': { allowed: false, reason: 'no' },
              'update-input-and-rewind': { allowed: true, warning: SUB_ORCHESTRATION_WARNING },
              replay: { allowed: false, reason: 'no' },
            },
          }),
        ],
      }),
    });

    await inputs.load();

    expect(inputs.warning).toBe(SUB_ORCHESTRATION_WARNING);
  });

  it('knows a provider that numbers nothing, so the tab can say it once', async () => {
    const { inputs } = makeInputs({
      response: inputEvents({ events: [executionStarted({ sequenceNumber: null })] }),
    });

    await inputs.load();

    expect(inputs.noSequenceNumbers).toBe(true);
  });

  it('is empty rather than broken when the execution recorded no inputs', async () => {
    const { inputs } = makeInputs({ response: inputEvents({ events: [] }) });

    await inputs.load();

    expect(inputs.isEmpty).toBe(true);
    expect(inputs.noSequenceNumbers).toBe(false);
  });

  it('says why it could not load, and offers to try again', async () => {
    const { app, inputs } = makeInputs();

    Object.defineProperty(app, 'endpoints', {
      value: {
        inputEvents: async () => {
          throw new Error('400 Bad Request');
        },
      } as unknown as Endpoints,
      configurable: true,
    });

    await inputs.load();

    expect(inputs.error).toBe('400 Bad Request');
    expect(app.toast.current?.message).toBe('Failed to load the inputs. 400 Bad Request');
    expect(app.toast.current?.retry).toBeTypeOf('function');
  });

  it('reloads only once the tab has been opened', async () => {
    const { inputs } = makeInputs();

    await inputs.reloadIfLoaded();
    expect(inputs.cards).toHaveLength(0);

    await inputs.load();
    inputs.cards[0].text = 'edited';

    await inputs.reloadIfLoaded();

    // A reload is a new set of cards: the sequence numbers may have moved under them
    expect(inputs.cards[0].edited).toBe(false);
  });
});

describe('running an operation', () => {
  it('restarts in place with the edit, and without one when nothing was edited', async () => {
    const { inputs, calls } = makeInputs();

    await inputs.load();

    const outcome = await inputs.run('restart-in-place', inputs.cards[0]);

    expect(outcome.ok).toBe(true);
    expect(calls.restarts).toEqual([{}]);

    inputs.cards[0].text = '{ "orderId": "A-1044" }';
    await inputs.run('restart-in-place', inputs.cards[0]);

    expect(calls.restarts[1]).toEqual({ input: { orderId: 'A-1044' } });
  });

  it('always sends an input with the rewind: the edit, or what is stored', async () => {
    const { inputs, calls } = makeInputs();

    await inputs.load();

    await inputs.run('update-input-and-rewind', inputs.cards[1], { reason: 'wrong approver' });

    expect(calls.updates[0]).toEqual({
      sequenceNumber: 27,
      input: inputs.cards[1].event.input,
      reason: 'wrong approver',
    });

    inputs.cards[1].text = '{ "approved": false }';
    await inputs.run('update-input-and-rewind', inputs.cards[1]);

    expect(calls.updates[1]).toEqual({ sequenceNumber: 27, input: { approved: false } });
  });

  it('replays from the sequence number it was given, and terminates first when asked', async () => {
    const { inputs, calls } = makeInputs();

    await inputs.load();

    await inputs.run('replay', inputs.cards[1], { terminateIfRunning: true });

    expect(calls.replays[0]).toEqual({ sequenceNumber: 27, terminateIfRunning: true });

    inputs.cards[1].text = '{ "approved": false }';
    await inputs.run('replay', inputs.cards[1]);

    expect(calls.replays[1]).toEqual({ sequenceNumber: 27, input: { approved: false } });
  });

  it('hands the failure back rather than swallowing it', async () => {
    const { inputs } = makeInputs({ fail: 'replay' });

    await inputs.load();

    const outcome = await inputs.run('replay', inputs.cards[1]);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && (outcome.error as Error).message).toBe('409 Conflict');
    expect(inputs.busy).toBe(false);
  });
});
