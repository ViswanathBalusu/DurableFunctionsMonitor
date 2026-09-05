// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Which colour a history row's spine gets (ScreenInstance.dc.html L133). The spine is the only thing
// that makes a history readable at a glance: a scheduled step is running, a completed one is green,
// a failure is red, and a rewind is the one row that says the history was cut and continued.

import type { HistoryEvent, RuntimeStatus } from '$lib/api/types';

/** What a rewound `GenericEvent` says in its `Details` or `Result` (backend `Rewound: {reason}`). */
export const REWOUND_PREFIX = 'Rewound:';

/**
 * The spine of one row, as a runtime status the stylesheet already colours, or `''` for the rows
 * that are neither - `ExecutionStarted`, `EventRaised`, `OrchestratorStarted` and the rest.
 *
 * `ExecutionCompleted` is the one row whose colour depends on the instance: the runtime writes it
 * for a failure too, and only the instance's own status says which it was.
 */
export function spineOf(event: HistoryEvent, instanceStatus?: RuntimeStatus | string | null): string {
  switch (event.EventType) {
    case 'TaskCompleted':
    case 'SubOrchestrationInstanceCompleted':
      return 'Completed';

    case 'ExecutionCompleted':
      return instanceStatus === 'Failed' ? 'Failed' : 'Completed';

    case 'TaskFailed':
    case 'SubOrchestrationInstanceFailed':
      return 'Failed';

    case 'TimerFired':
      // The instance was waiting, which is what the suspended colour reads as here
      return 'Suspended';

    case 'SubOrchestrationInstanceCreated':
    case 'TaskScheduled':
      return 'Running';

    case 'GenericEvent':
      return isRewound(event) ? 'ContinuedAsNew' : '';

    default:
      return '';
  }
}

/** A rewind row: the history was cut here and the instance carried on from it. */
export function isRewound(event: HistoryEvent): boolean {
  return [event.Details, event.Result].some(
    (value) => typeof value === 'string' && value.trimStart().startsWith(REWOUND_PREFIX),
  );
}

/** The two event types whose payload is an input the Inputs tab can act on (contracts §6). */
export function isInputEvent(event: HistoryEvent): boolean {
  return event.EventType === 'ExecutionStarted' || event.EventType === 'EventRaised';
}
