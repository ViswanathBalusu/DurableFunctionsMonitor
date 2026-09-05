// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Inputs tab (docs/plans/input-events-restart-rewind-replay.md §4): the two inputs an
// orchestration ever received - what it was started with, and the event that unblocked it.
//
// The default is the case the tab exists for: a *failed* instance that has received one external
// event. Every verdict below is what `Common/InputEventEligibility.cs` actually answers for that
// instance, reason for reason - see ./input-eligibility.ts, which is where the strings live.

import type { InputEvent, InputEventsResponse } from '$lib/api/types';
import {
  RESTART_EXTERNAL_EVENTS_REASON,
  RESTART_INITIAL_ONLY_REASON,
  REPLAY_USE_RESTART_REASON,
  UPDATE_EXTERNAL_EVENTS_REASON,
  notFailedReason,
} from './input-eligibility';
import { storedInput } from './details';

/**
 * The initial input of an instance that has since received an external event: nothing can be done
 * with it any more, which is what makes its card the read-only one.
 */
export function executionStarted(overrides: Partial<InputEvent> = {}): InputEvent {
  return {
    sequenceNumber: 1,
    eventType: 'ExecutionStarted',
    name: 'ProcessOrderOrchestrator',
    timestamp: '2026-09-04T14:02:11.913Z',
    input: storedInput,
    isLast: false,
    operations: {
      'restart-in-place': { allowed: false, reason: RESTART_EXTERNAL_EVENTS_REASON },
      'update-input-and-rewind': { allowed: false, reason: UPDATE_EXTERNAL_EVENTS_REASON },
      replay: { allowed: false, reason: REPLAY_USE_RESTART_REASON },
    },
    ...overrides,
  };
}

/** The last input-bearing event: the one that can be edited and rewound, or replayed from. */
export function eventRaised(overrides: Partial<InputEvent> = {}): InputEvent {
  return {
    sequenceNumber: 27,
    eventType: 'EventRaised',
    name: 'PaymentApproved',
    timestamp: '2026-09-04T14:02:24.913Z',
    input: { approved: true, approver: 'ops@contoso.com', amount: 129.5 },
    isLast: true,
    operations: {
      'restart-in-place': { allowed: false, reason: RESTART_INITIAL_ONLY_REASON },
      'update-input-and-rewind': { allowed: true },
      // Failed is terminal, so there is nothing to terminate before replaying
      replay: { allowed: true, requiresTerminate: false },
    },
    ...overrides,
  };
}

export function inputEvents(overrides: Partial<InputEventsResponse> = {}): InputEventsResponse {
  return {
    instanceId: 'order-2026-09-04-000913',
    runtimeStatus: 'Failed',
    parentInstanceId: null,
    dangerousOperationsEnabled: true,
    storageSupports: { updateInput: true, truncateHistory: true },
    events: [executionStarted(), eventRaised()],
    ...overrides,
  };
}

/**
 * The same instance while it is still running: the rewind is refused (only failed instances can be
 * rewound) and the replay has to terminate it first.
 */
export function runningInputEvents(overrides: Partial<InputEventsResponse> = {}): InputEventsResponse {
  return inputEvents({
    runtimeStatus: 'Running',
    events: [
      executionStarted({
        operations: {
          'restart-in-place': { allowed: false, reason: notFailedReason('restarted in place', 'Running') },
          'update-input-and-rewind': { allowed: false, reason: UPDATE_EXTERNAL_EVENTS_REASON },
          replay: { allowed: false, reason: REPLAY_USE_RESTART_REASON },
        },
      }),
      eventRaised({
        operations: {
          'restart-in-place': { allowed: false, reason: RESTART_INITIAL_ONLY_REASON },
          'update-input-and-rewind': { allowed: false, reason: notFailedReason('rewound', 'Running') },
          replay: { allowed: true, requiresTerminate: true },
        },
      }),
    ],
    ...overrides,
  });
}
