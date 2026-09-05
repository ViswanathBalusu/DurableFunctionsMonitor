// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenInstance.dc.html L89-L98: the swimlane of order-2026-09-04-000913 - two payment attempts
// with a timer between them, and the sub-orchestration at the end.

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

export const spans: Span[] = [
  span({
    id: 'orch',
    kind: 'orchestrator',
    name: 'ProcessOrderOrchestrator',
    start: '2026-09-04T14:02:11.913Z',
    end: null,
    status: 'running',
    sequenceNumbers: [1],
    durationMs: null,
  }),
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
  span({
    id: 'timer',
    kind: 'timer',
    name: 'Timer',
    start: '2026-09-04T14:02:21.402Z',
    end: '2026-09-04T14:02:24.410Z',
    status: 'fired',
    sequenceNumbers: [15, 18],
    durationMs: 3_008,
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
    orchestratorMs: null,
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
