// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Inputs tab (docs/plans/input-events-restart-rewind-replay.md §4): the two inputs an
// orchestration ever received - what it was started with, and the event that unblocked it.

import type { InputEvent, InputEventsResponse, OperationEligibility } from '$lib/api/types';
import { storedInput } from './details';

const allowed: OperationEligibility = { allowed: true };

function blocked(reason: string): OperationEligibility {
  return { allowed: false, reason };
}

export function executionStarted(overrides: Partial<InputEvent> = {}): InputEvent {
  return {
    sequenceNumber: 1,
    eventType: 'ExecutionStarted',
    name: 'ProcessOrderOrchestrator',
    timestamp: '2026-09-04T14:02:11.913Z',
    input: storedInput,
    isLast: false,
    operations: {
      'restart-in-place': allowed,
      'update-input-and-rewind': allowed,
      replay: blocked('ExecutionStarted is replayed by restart-in-place, not by replay'),
    },
    ...overrides,
  };
}

export function eventRaised(overrides: Partial<InputEvent> = {}): InputEvent {
  return {
    sequenceNumber: 27,
    eventType: 'EventRaised',
    name: 'PaymentApproved',
    timestamp: '2026-09-04T14:02:24.913Z',
    input: { approved: true, approver: 'ops@contoso.com', amount: 129.5 },
    isLast: true,
    operations: {
      'restart-in-place': blocked('restart-in-place applies to the orchestration, not to one event'),
      'update-input-and-rewind': allowed,
      replay: {
        allowed: true,
        requiresTerminate: true,
        warning: 'The instance is Running and will be terminated first',
      },
    },
    ...overrides,
  };
}

export function inputEvents(overrides: Partial<InputEventsResponse> = {}): InputEventsResponse {
  return {
    instanceId: 'order-2026-09-04-000913',
    runtimeStatus: 'Running',
    parentInstanceId: null,
    dangerousOperationsEnabled: true,
    storageSupports: { updateInput: true, truncateHistory: true },
    events: [executionStarted(), eventRaised()],
    ...overrides,
  };
}
