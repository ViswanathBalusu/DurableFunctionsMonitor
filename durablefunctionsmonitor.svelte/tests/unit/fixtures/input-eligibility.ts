// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The eligibility matrix the backend answers with, row for row from
// `tests/durablefunctionsmonitor.dotnetisolated.core.tests/InputEventEligibilityTests.cs` and the
// rules in `Common/InputEventEligibility.cs`. The reasons are the backend's own words: the tab shows
// them verbatim, so a fixture that paraphrased them would be testing nothing.

import type { InputEvent, InputEventOperation, OperationEligibility } from '$lib/api/types';

export const DANGEROUS_OFF_REASON =
  'Dangerous operations are disabled for this deployment (DFM_DANGEROUS_OPERATIONS_ENABLED).';

export const STORAGE_PROVIDER_REASON = 'The configured storage provider does not support this operation.';

export const NO_SEQUENCE_NUMBERS_REASON =
  'The storage provider does not report sequence numbers, so this event cannot be addressed.';

export const NOT_LAST_REASON = 'Only the last input-bearing event can be edited or replayed.';

export const RESTART_INITIAL_ONLY_REASON = 'Restart in place applies to the initial input only.';

export const REPLAY_USE_RESTART_REASON = 'Use restart-in-place to re-run the whole instance from its initial input.';

export const RESTART_EXTERNAL_EVENTS_REASON =
  'The instance has received external events. Use replay or update-input-and-rewind on the last one instead.';

export const UPDATE_EXTERNAL_EVENTS_REASON =
  'Only the last input-bearing event can be edited, and this instance has received external events since it started.';

export const SUB_ORCHESTRATION_RESTART_REASON =
  'Sub-orchestrations cannot be restarted in place, because the parent would never receive their result.';

export const SUB_ORCHESTRATION_WARNING = 'This is a sub-orchestration. Its parent will not be re-run.';

export function notFailedReason(verb: 'restarted in place' | 'rewound', status: string): string {
  return `Only failed instances can be ${verb}, and this one is ${status}.`;
}

const ok: OperationEligibility = { allowed: true };

function no(reason: string): OperationEligibility {
  return { allowed: false, reason };
}

function event(
  overrides: Partial<InputEvent>,
  operations: Record<InputEventOperation, OperationEligibility>,
): InputEvent {
  return {
    sequenceNumber: 10,
    eventType: 'ExecutionStarted',
    name: 'ProcessOrderOrchestrator',
    timestamp: '2026-09-04T14:02:11.913Z',
    input: { orderId: 'A-1043' },
    isLast: true,
    operations,
    ...overrides,
  };
}

export interface EligibilityRow {
  /** What the backend test calls this case. */
  name: string;
  event: InputEvent;
  /** Which operations may be run, in the order the tab offers them. */
  allowed: InputEventOperation[];
  /** The line under each button, keyed by operation - the backend's reason, or the description. */
  why: Partial<Record<InputEventOperation, string>>;
}

/**
 * One row per case the backend test covers. `allowed` and `why` are what the button model has to
 * come out as - the tab never decides eligibility, it renders the answer.
 */
export const ELIGIBILITY_ROWS: EligibilityRow[] = [
  {
    name: 'failed, no raised events: the initial input can be restarted or rewound',
    event: event(
      {},
      {
        'restart-in-place': ok,
        'update-input-and-rewind': ok,
        replay: no(REPLAY_USE_RESTART_REASON),
      },
    ),
    allowed: ['restart-in-place', 'update-input-and-rewind'],
    why: { replay: REPLAY_USE_RESTART_REASON },
  },
  {
    name: 'failed with raised events: ExecutionStarted can do nothing',
    event: event(
      { isLast: false },
      {
        'restart-in-place': no(RESTART_EXTERNAL_EVENTS_REASON),
        'update-input-and-rewind': no(UPDATE_EXTERNAL_EVENTS_REASON),
        replay: no(REPLAY_USE_RESTART_REASON),
      },
    ),
    allowed: [],
    why: {
      'restart-in-place': RESTART_EXTERNAL_EVENTS_REASON,
      'update-input-and-rewind': UPDATE_EXTERNAL_EVENTS_REASON,
      replay: REPLAY_USE_RESTART_REASON,
    },
  },
  {
    name: 'failed with raised events: the last one can be rewound and replayed',
    event: event(
      { sequenceNumber: 27, eventType: 'EventRaised', name: 'PaymentApproved' },
      {
        'restart-in-place': no(RESTART_INITIAL_ONLY_REASON),
        'update-input-and-rewind': ok,
        replay: { allowed: true, requiresTerminate: false },
      },
    ),
    allowed: ['update-input-and-rewind', 'replay'],
    why: { 'restart-in-place': RESTART_INITIAL_ONLY_REASON },
  },
  {
    name: 'a running instance can be neither restarted nor rewound',
    event: event(
      {},
      {
        'restart-in-place': no(notFailedReason('restarted in place', 'Running')),
        'update-input-and-rewind': no(notFailedReason('rewound', 'Running')),
        replay: no(REPLAY_USE_RESTART_REASON),
      },
    ),
    allowed: [],
    why: {
      'restart-in-place': notFailedReason('restarted in place', 'Running'),
      'update-input-and-rewind': notFailedReason('rewound', 'Running'),
      replay: REPLAY_USE_RESTART_REASON,
    },
  },
  {
    name: 'a sub-orchestration cannot be restarted in place, and says why',
    event: event(
      {},
      {
        'restart-in-place': no(SUB_ORCHESTRATION_RESTART_REASON),
        'update-input-and-rewind': { allowed: true, warning: SUB_ORCHESTRATION_WARNING },
        replay: no(REPLAY_USE_RESTART_REASON),
      },
    ),
    allowed: ['update-input-and-rewind'],
    why: { 'restart-in-place': SUB_ORCHESTRATION_RESTART_REASON, replay: REPLAY_USE_RESTART_REASON },
  },
  {
    name: 'with dangerous operations off, only the rewind is left',
    event: event(
      { sequenceNumber: 27, eventType: 'EventRaised', name: 'PaymentApproved' },
      {
        'restart-in-place': no(DANGEROUS_OFF_REASON),
        'update-input-and-rewind': ok,
        replay: no(DANGEROUS_OFF_REASON),
      },
    ),
    allowed: ['update-input-and-rewind'],
    why: { 'restart-in-place': DANGEROUS_OFF_REASON, replay: DANGEROUS_OFF_REASON },
  },
  {
    name: 'replaying a running instance terminates it first',
    event: event(
      { sequenceNumber: 27, eventType: 'EventRaised', name: 'PaymentApproved' },
      {
        'restart-in-place': no(RESTART_INITIAL_ONLY_REASON),
        'update-input-and-rewind': no(notFailedReason('rewound', 'Running')),
        replay: { allowed: true, requiresTerminate: true },
      },
    ),
    allowed: ['replay'],
    why: {
      'restart-in-place': RESTART_INITIAL_ONLY_REASON,
      'update-input-and-rewind': notFailedReason('rewound', 'Running'),
    },
  },
  {
    name: 'a storage provider without the two operations refuses both',
    event: event(
      { sequenceNumber: 27, eventType: 'EventRaised', name: 'PaymentApproved' },
      {
        'restart-in-place': no(RESTART_INITIAL_ONLY_REASON),
        'update-input-and-rewind': no(STORAGE_PROVIDER_REASON),
        replay: no(STORAGE_PROVIDER_REASON),
      },
    ),
    allowed: [],
    why: {
      'restart-in-place': RESTART_INITIAL_ONLY_REASON,
      'update-input-and-rewind': STORAGE_PROVIDER_REASON,
      replay: STORAGE_PROVIDER_REASON,
    },
  },
  {
    name: 'an event with no sequence number cannot be addressed at all',
    event: event(
      { sequenceNumber: null },
      {
        'restart-in-place': no(NO_SEQUENCE_NUMBERS_REASON),
        'update-input-and-rewind': no(NO_SEQUENCE_NUMBERS_REASON),
        replay: no(NO_SEQUENCE_NUMBERS_REASON),
      },
    ),
    allowed: [],
    why: {
      'restart-in-place': NO_SEQUENCE_NUMBERS_REASON,
      'update-input-and-rewind': NO_SEQUENCE_NUMBERS_REASON,
      replay: NO_SEQUENCE_NUMBERS_REASON,
    },
  },
  {
    name: 'an event that is not the last one can be neither edited nor replayed',
    event: event(
      { sequenceNumber: 12, eventType: 'EventRaised', name: 'RateCardUpdated', isLast: false },
      {
        'restart-in-place': no(NOT_LAST_REASON),
        'update-input-and-rewind': no(NOT_LAST_REASON),
        replay: no(NOT_LAST_REASON),
      },
    ),
    allowed: [],
    why: {
      'restart-in-place': NOT_LAST_REASON,
      'update-input-and-rewind': NOT_LAST_REASON,
      replay: NOT_LAST_REASON,
    },
  },
];
