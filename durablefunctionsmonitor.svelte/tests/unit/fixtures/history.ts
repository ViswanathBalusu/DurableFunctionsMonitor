// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenInstance.dc.html L311-L325: the 31 history rows of order-2026-09-04-000913, of which the
// screen lists the thirteen that matter - including EventRaised #27 PaymentApproved.

import type { HistoryEvent, HistoryResponse } from '$lib/api/types';

function at(time: string): string {
  return `2026-09-04T${time}Z`;
}

export function historyEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    SequenceNumber: 1,
    Timestamp: at('14:02:11.913'),
    EventType: 'ExecutionStarted',
    EventId: -1,
    Name: 'ProcessOrderOrchestrator',
    ScheduledTime: null,
    DurationInMs: null,
    SubOrchestrationId: null,
    Input: null,
    Result: null,
    Details: null,
    ...overrides,
  };
}

export const history: HistoryEvent[] = [
  historyEvent({ Input: { orderId: 'A-1043', customerId: 88214 } }),
  historyEvent({
    SequenceNumber: 2,
    Timestamp: at('14:02:12.004'),
    EventType: 'TaskScheduled',
    Name: 'ReserveInventory',
  }),
  historyEvent({
    SequenceNumber: 5,
    Timestamp: at('14:02:13.917'),
    EventType: 'TaskCompleted',
    Name: 'ReserveInventory',
    DurationInMs: 1_900,
    Result: { sku: 'SKU-4471', reserved: 2 },
  }),
  historyEvent({ SequenceNumber: 6, Timestamp: at('14:02:14.002'), EventType: 'TaskScheduled', Name: 'ChargePayment' }),
  historyEvent({
    SequenceNumber: 9,
    Timestamp: at('14:02:17.106'),
    EventType: 'TaskCompleted',
    Name: 'ChargePayment',
    DurationInMs: 3_100,
    Result: { transactionId: 'tx_8f3a1b2c', amount: 129.5, currency: 'USD' },
  }),
  historyEvent({
    SequenceNumber: 10,
    Timestamp: at('14:02:17.210'),
    EventType: 'TaskScheduled',
    Name: 'ChargePayment',
  }),
  historyEvent({
    SequenceNumber: 14,
    Timestamp: at('14:02:21.300'),
    EventType: 'TaskFailed',
    Name: 'ChargePayment',
    DurationInMs: 4_000,
    Result: 'TimeoutException: payment gateway did not answer within 4 s',
    Details: 'at ChargePayment(PaymentGateway.cs:118)',
  }),
  historyEvent({
    SequenceNumber: 15,
    Timestamp: at('14:02:21.402'),
    EventType: 'TimerCreated',
    Name: null,
    ScheduledTime: at('14:02:24.402'),
    FireAt: at('14:02:24.402'),
    TimerId: 3,
  }),
  historyEvent({
    SequenceNumber: 18,
    Timestamp: at('14:02:24.410'),
    EventType: 'TimerFired',
    Name: null,
    DurationInMs: 3_000,
    TimerId: 3,
  }),
  historyEvent({
    SequenceNumber: 27,
    Timestamp: at('14:02:24.913'),
    EventType: 'EventRaised',
    Name: 'PaymentApproved',
    Input: { approved: true, approver: 'ops@contoso.com', amount: 129.5 },
  }),
  historyEvent({
    SequenceNumber: 28,
    Timestamp: at('14:02:25.001'),
    EventType: 'TaskScheduled',
    Name: 'ChargePayment',
  }),
  historyEvent({
    SequenceNumber: 30,
    Timestamp: at('14:02:28.114'),
    EventType: 'TaskCompleted',
    Name: 'ChargePayment',
    DurationInMs: 3_100,
    Result: { transactionId: 'tx_9c2d', amount: 129.5, currency: 'USD' },
  }),
  historyEvent({
    SequenceNumber: 31,
    Timestamp: at('14:02:28.400'),
    EventType: 'SubOrchestrationInstanceCreated',
    Name: 'NotifyCustomer',
    SubOrchestrationId: 'order-2026-09-04-000913:0',
    Result: 'order-2026-09-04-000913:0',
  }),
];

export function historyResponse(overrides: Partial<HistoryResponse> = {}): HistoryResponse {
  return { history, ...overrides };
}
