// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenInstance.dc.html L89-L98 as `/spans` reports it: four orchestrator episodes, three payment
// attempts with a retry backoff between two of them, the wait the raised event ended, and the
// sub-orchestration that is still running.
//
// Faithful to B2 rather than to the picture: the episodes come from the markers, the wait for
// `PaymentApproved` is the stretch before the row that named it, and the mockup's ninth lane - a
// wait for `ShipmentConfirmed` that has not arrived - has no span, because a history whose last row
// creates a sub-orchestration leaves nothing waiting and nothing to name.

import type { Span, SpansResponse, SpansTotals } from '$lib/api/types';

export function span(overrides: Partial<Span> = {}): Span {
  return {
    id: 'reserve',
    kind: 'activity',
    name: 'ReserveInventory',
    attempt: 1,
    start: '2026-09-04T14:02:12.004Z',
    end: '2026-09-04T14:02:13.917Z',
    status: 'completed',
    sequenceNumbers: [2, 5],
    durationMs: 1_913,
    ...overrides,
  };
}

/** One replay of the orchestrator, from the episode markers: no history row of its own. */
function episode(index: number, start: string, end: string, durationMs: number): Span {
  return span({
    id: `orch${index}`,
    kind: 'orchestrator',
    name: 'ProcessOrderOrchestrator',
    attempt: index,
    start,
    end,
    status: 'completed',
    sequenceNumbers: [],
    durationMs,
  });
}

export const spans: Span[] = [
  episode(1, '2026-09-04T14:02:11.913Z', '2026-09-04T14:02:12.004Z', 91),
  span(),
  span({
    id: 'charge1',
    name: 'ChargePayment',
    start: '2026-09-04T14:02:14.002Z',
    end: '2026-09-04T14:02:17.106Z',
    status: 'completed',
    sequenceNumbers: [6, 9],
    durationMs: 3_104,
  }),
  span({
    id: 'charge2',
    name: 'ChargePayment',
    attempt: 2,
    start: '2026-09-04T14:02:17.210Z',
    end: '2026-09-04T14:02:21.300Z',
    status: 'failed',
    sequenceNumbers: [10, 14],
    durationMs: 4_090,
  }),
  episode(2, '2026-09-04T14:02:21.300Z', '2026-09-04T14:02:21.402Z', 102),
  span({
    id: 'timer',
    kind: 'timer',
    name: '',
    start: '2026-09-04T14:02:21.402Z',
    end: '2026-09-04T14:02:24.410Z',
    status: 'fired',
    sequenceNumbers: [15, 18],
    durationMs: 3_008,
  }),
  episode(3, '2026-09-04T14:02:24.410Z', '2026-09-04T14:02:24.500Z', 90),
  span({
    id: 'wait-payment',
    kind: 'eventWait',
    name: 'PaymentApproved',
    start: '2026-09-04T14:02:24.410Z',
    end: '2026-09-04T14:02:24.913Z',
    status: 'waiting',
    sequenceNumbers: [27],
    durationMs: 503,
  }),
  span({
    id: 'event',
    kind: 'externalEvent',
    name: 'PaymentApproved',
    start: '2026-09-04T14:02:24.913Z',
    end: '2026-09-04T14:02:24.913Z',
    status: 'raised',
    sequenceNumbers: [27],
    durationMs: 0,
  }),
  span({
    id: 'charge3',
    name: 'ChargePayment',
    attempt: 3,
    start: '2026-09-04T14:02:25.001Z',
    end: '2026-09-04T14:02:28.114Z',
    status: 'completed',
    sequenceNumbers: [28, 30],
    durationMs: 3_113,
  }),
  episode(4, '2026-09-04T14:02:28.114Z', '2026-09-04T14:02:28.400Z', 286),
  span({
    id: 'sub',
    kind: 'subOrchestration',
    name: 'NotifyCustomer',
    start: '2026-09-04T14:02:28.400Z',
    end: null,
    status: 'running',
    sequenceNumbers: [31],
    subOrchestrationId: 'order-2026-09-04-000913:0',
    durationMs: null,
  }),
];

export function totals(overrides: Partial<SpansTotals> = {}): SpansTotals {
  return {
    activitiesMs: 12_220,
    subOrchestrationsMs: 0,
    timersMs: 3_008,
    externalEventWaitMs: 503,
    orchestratorMs: 569,
    totalMs: 47_000,
    ...overrides,
  };
}

export function spansResponse(overrides: Partial<SpansResponse> = {}): SpansResponse {
  return {
    instanceId: 'order-2026-09-04-000913',
    executionId: '3f7a9c1e8b2d4f60a1c5e7d9b3f10248',
    generation: 1,
    executionStartedAt: '2026-09-04T14:02:11.913Z',
    executionEndedAt: null,
    now: '2026-09-04T14:02:58Z',
    spans,
    totals: totals(),
    historyRows: 31,
    historyBytes: 18_636,
    largeMessageBlobs: 0,
    ...overrides,
  };
}
