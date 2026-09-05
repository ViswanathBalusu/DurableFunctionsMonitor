// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '$lib/api/types';
import { EXTERNAL_ACTOR, buildSequence, toMermaid } from './sequence-model';
import { history as historyFixture, historyEvent } from '../../../tests/unit/fixtures/history';

const ORCHESTRATOR = 'ProcessOrderOrchestrator';

function build(history: HistoryEvent[], options: Parameters<typeof buildSequence>[0] | object = {}) {
  return buildSequence({ orchestratorName: ORCHESTRATOR, history, ...options });
}

describe('buildSequence', () => {
  it('gives every activity and sub-orchestration a lane, in the order they were first called', async () => {
    const model = await build(historyFixture);

    // ScreenInstance.dc.html L193: the orchestrator, then what it called
    expect(model.participants).toEqual([ORCHESTRATOR, 'ReserveInventory', 'ChargePayment', 'NotifyCustomer']);
  });

  it('turns the fixture history into the ten messages of the mockup, in order', async () => {
    const model = await build(historyFixture);

    expect(model.messages.map((message) => [message.from, message.to, message.label, message.kind])).toEqual([
      [ORCHESTRATOR, 'ReserveInventory', 'ReserveInventory', 'call'],
      ['ReserveInventory', ORCHESTRATOR, 'ReserveInventory', 'return'],
      [ORCHESTRATOR, 'ChargePayment', 'ChargePayment', 'call'],
      ['ChargePayment', ORCHESTRATOR, 'ChargePayment', 'return'],
      [ORCHESTRATOR, 'ChargePayment', 'ChargePayment', 'call'],
      ['ChargePayment', ORCHESTRATOR, 'ChargePayment', 'failed'],
      [ORCHESTRATOR, ORCHESTRATOR, 'EventRaised PaymentApproved', 'self'],
      [ORCHESTRATOR, 'ChargePayment', 'ChargePayment', 'call'],
      ['ChargePayment', ORCHESTRATOR, 'ChargePayment', 'return'],
      [ORCHESTRATOR, 'NotifyCustomer', 'NotifyCustomer', 'call'],
    ]);

    // Every message carries the moment it happened, which is the diagram's left-hand column
    expect(model.messages[0].t).toBe('2026-09-04T14:02:12.004Z');
    expect(model.messages[1].note).toBe('2 s');
  });

  it('says what a failure said, when the runtime wrote a reason', async () => {
    const model = await build(historyFixture);
    const failure = model.messages.find((message) => message.kind === 'failed');

    expect(failure?.note).toContain('TimeoutException');
  });

  it('does not draw a message for the events that are not one', async () => {
    const model = await build([
      historyEvent({ SequenceNumber: 1, EventType: 'ExecutionStarted' }),
      historyEvent({ SequenceNumber: 2, EventType: 'OrchestratorStarted', Name: null }),
      historyEvent({ SequenceNumber: 3, EventType: 'TimerCreated', Name: null }),
      historyEvent({ SequenceNumber: 4, EventType: 'TimerFired', Name: null }),
    ]);

    // The orchestrator's lane starting is the diagram, and a timer is time passing on it
    expect(model.messages).toEqual([]);
    expect(model.participants).toEqual([ORCHESTRATOR]);
  });

  it('aggregates the identical calls of one moment into one par block', async () => {
    const at = '2026-09-04T14:02:14.002Z';

    const model = await build([
      historyEvent({ SequenceNumber: 6, EventType: 'TaskScheduled', Name: 'ChargePayment', Timestamp: at }),
      historyEvent({ SequenceNumber: 7, EventType: 'TaskScheduled', Name: 'ChargePayment', Timestamp: at }),
      historyEvent({
        SequenceNumber: 9,
        EventType: 'TaskCompleted',
        Name: 'ChargePayment',
        ScheduledTime: at,
        DurationInMs: 3_100,
      }),
      historyEvent({
        SequenceNumber: 10,
        EventType: 'TaskCompleted',
        Name: 'ChargePayment',
        ScheduledTime: at,
        DurationInMs: 4_200,
      }),
    ]);

    expect(model.messages).toHaveLength(2);
    expect(model.messages[0]).toMatchObject({ kind: 'call', parallel: 2 });

    // The block is as long as its slowest call, which is what React reported too
    expect(model.messages[1]).toMatchObject({ kind: 'return', parallel: 2, note: '4 s' });
  });

  it('draws the call a collapsed history only implies', async () => {
    // What the backend actually returns: no TaskScheduled row, the scheduled moment on the answer
    const model = await build([
      historyEvent({
        SequenceNumber: 2,
        EventType: 'TaskCompleted',
        Name: 'ReserveInventory',
        Timestamp: '2026-09-04T14:02:13.917Z',
        ScheduledTime: '2026-09-04T14:02:12.004Z',
        DurationInMs: 1_900,
      }),
      historyEvent({
        SequenceNumber: 10,
        EventType: 'TaskFailed',
        Name: 'ChargePayment',
        Timestamp: '2026-09-04T14:02:21.300Z',
        ScheduledTime: '2026-09-04T14:02:17.210Z',
        Details: 'TimeoutException',
      }),
    ]);

    expect(model.messages.map((message) => [message.t, message.from, message.to, message.kind])).toEqual([
      ['2026-09-04T14:02:12.004Z', ORCHESTRATOR, 'ReserveInventory', 'call'],
      ['2026-09-04T14:02:13.917Z', 'ReserveInventory', ORCHESTRATOR, 'return'],
      ['2026-09-04T14:02:17.210Z', ORCHESTRATOR, 'ChargePayment', 'call'],
      ['2026-09-04T14:02:21.300Z', 'ChargePayment', ORCHESTRATOR, 'failed'],
    ]);
  });

  it('does not draw the call twice when the provider sent the TaskScheduled row too', async () => {
    const model = await build([
      historyEvent({ EventType: 'TaskScheduled', Name: 'ReserveInventory', Timestamp: '2026-09-04T14:02:12.004Z' }),
      historyEvent({
        EventType: 'TaskCompleted',
        Name: 'ReserveInventory',
        Timestamp: '2026-09-04T14:02:13.917Z',
        ScheduledTime: '2026-09-04T14:02:12.004Z',
      }),
    ]);

    expect(model.messages.map((message) => message.kind)).toEqual(['call', 'return']);
  });

  it('does not aggregate calls that were not sent at the same moment', async () => {
    const model = await build([
      historyEvent({ EventType: 'TaskScheduled', Name: 'ChargePayment', Timestamp: '2026-09-04T14:02:14.002Z' }),
      historyEvent({ EventType: 'TaskScheduled', Name: 'ChargePayment', Timestamp: '2026-09-04T14:02:17.210Z' }),
    ]);

    expect(model.messages).toHaveLength(2);
    expect(model.messages.every((message) => message.parallel === undefined)).toBe(true);
  });

  it('draws what a sub-orchestration did, from its own history', async () => {
    const child = [
      historyEvent({ EventType: 'TaskScheduled', Name: 'SendEmail', Timestamp: '2026-09-04T14:02:29.000Z' }),
      historyEvent({
        EventType: 'TaskCompleted',
        Name: 'SendEmail',
        Timestamp: '2026-09-04T14:02:29.900Z',
        DurationInMs: 900,
      }),
    ];

    const model = await build(
      [
        historyEvent({
          EventType: 'SubOrchestrationInstanceCompleted',
          Name: 'NotifyCustomer',
          SubOrchestrationId: 'order-2026-09-04-000913:0',
          DurationInMs: 1_400,
        }),
      ],
      { loadHistory: async () => child },
    );

    expect(model.participants).toEqual([ORCHESTRATOR, 'NotifyCustomer', 'SendEmail']);
    expect(model.messages.map((message) => [message.from, message.to, message.kind])).toEqual([
      ['NotifyCustomer', ORCHESTRATOR, 'return'],
      ['NotifyCustomer', 'SendEmail', 'call'],
      ['SendEmail', 'NotifyCustomer', 'return'],
    ]);
  });

  it('says so when a child history cannot be read', async () => {
    const model = await build(
      [
        historyEvent({
          EventType: 'SubOrchestrationInstanceCompleted',
          Name: 'NotifyCustomer',
          SubOrchestrationId: 'order-2026-09-04-000913:0',
        }),
      ],
      {
        loadHistory: async () => {
          throw new Error('404');
        },
      },
    );

    expect(model.messages.map((message) => message.label)).toEqual(['NotifyCustomer', '[FailedToLoad]']);
  });

  it('stops asking for children once it has asked enough times', async () => {
    let loads = 0;

    // A child that says it has a child, for ever
    const forever = (): HistoryEvent[] => [
      historyEvent({
        EventType: 'SubOrchestrationInstanceCompleted',
        Name: `Child${loads}`,
        SubOrchestrationId: `child-${loads}`,
      }),
    ];

    await build(forever(), {
      maxNested: 3,
      loadHistory: async () => {
        loads += 1;
        return forever();
      },
    });

    expect(loads).toBe(3);
  });

  it('puts the external actor first, and only when something needs one', async () => {
    const model = await build([
      historyEvent({ EventType: 'TaskScheduled', Name: 'ReserveInventory' }),
      historyEvent({ EventType: 'ExecutionTerminated', Name: null, Details: 'cancelled by the customer' }),
    ]);

    expect(model.participants).toEqual([EXTERNAL_ACTOR, ORCHESTRATOR, 'ReserveInventory']);
    expect(model.messages.at(-1)).toMatchObject({
      from: EXTERNAL_ACTOR,
      to: ORCHESTRATOR,
      kind: 'terminated',
      note: 'cancelled by the customer',
    });
  });

  it('reads the last ExecutionCompleted as the instance ended, failed or not', async () => {
    const completed = await build([
      historyEvent({ EventType: 'ExecutionCompleted', Name: null, DurationInMs: 47_000 }),
    ]);

    expect(completed.messages[0]).toMatchObject({ label: '[ExecutionCompleted]', kind: 'return', note: '47 s' });

    const failed = await build([historyEvent({ EventType: 'ExecutionCompleted', Name: null })], { isFailed: true });

    expect(failed.messages[0]).toMatchObject({ label: '[ExecutionFailed]', kind: 'failed' });
  });
});

describe('toMermaid', () => {
  it('writes the same diagram as mermaid source', async () => {
    const model = await build(historyFixture);
    const text = toMermaid(model);

    expect(text.startsWith('sequenceDiagram\n')).toBe(true);
    expect(text).toContain(`participant ${ORCHESTRATOR}`);
    expect(text).toContain(`${ORCHESTRATOR}->>ReserveInventory:ReserveInventory`);
    expect(text).toContain(`ReserveInventory-->>${ORCHESTRATOR}:ReserveInventory`);
    expect(text).toContain(`ChargePayment-x${ORCHESTRATOR}:ChargePayment`);
    expect(text).toContain(`Note over ReserveInventory,${ORCHESTRATOR}: 2 s`);
  });

  it('wraps the aggregated calls in a par block', async () => {
    const at = '2026-09-04T14:02:14.002Z';

    const model = await build([
      historyEvent({ EventType: 'TaskScheduled', Name: 'ChargePayment', Timestamp: at }),
      historyEvent({ EventType: 'TaskScheduled', Name: 'ChargePayment', Timestamp: at }),
    ]);

    const text = toMermaid(model);

    expect(text).toContain('par 2 calls');
    expect(text).toContain('end');
  });
});
