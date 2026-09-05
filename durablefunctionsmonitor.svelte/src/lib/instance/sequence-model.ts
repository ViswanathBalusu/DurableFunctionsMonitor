// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The sequence diagram of one orchestration, as data (E5-S5-T1). A port of React's
// `SequenceDiagramTabState.getSequenceForOrchestration`, with one difference that is the whole point
// of the rewrite: React handed mermaid a string and let it draw, so activities had to be self-calls
// on the orchestrator lane. Here the diagram is HTML we draw ourselves (ScreenInstance.dc.html
// L192-L198), so every activity and sub-orchestration gets a lane of its own and the arrows go
// where the calls actually went.

import type { HistoryEvent } from '$lib/api/types';
import { fmtDuration } from '$lib/format/duration';

/** The lane an external actor gets, and React's name for it. */
export const EXTERNAL_ACTOR = '.';

/** How deep the sub-orchestration recursion goes before it stops asking for more history. */
export const MAX_NESTED_LOADS = 10;

export type SequenceMessageKind = 'call' | 'return' | 'failed' | 'external' | 'self' | 'terminated';

export interface SequenceMessage {
  /** ISO timestamp of the event this message is; the row's own clock column. */
  t: string;
  from: string;
  to: string;
  label: string;
  kind: SequenceMessageKind;
  /** The duration, or the reason a failure gives - whatever the arrow can say about itself. */
  note?: string;
  /** `par n calls`: how many identical calls were sent at the same moment (React's aggregation). */
  parallel?: number;
}

export interface SequenceModel {
  /** The lanes, left to right. The external actor comes first, when anything needs one. */
  participants: string[];
  messages: SequenceMessage[];
}

export interface BuildSequenceOptions {
  orchestratorName: string;
  history: HistoryEvent[];
  /** True when the instance itself failed: its ExecutionCompleted is a failure, not a return. */
  isFailed?: boolean;
  /** Loads a sub-orchestration's history, so its calls can be drawn inside this diagram. */
  loadHistory?: (instanceId: string) => Promise<HistoryEvent[]>;
  maxNested?: number;
}

/** ScheduledTime when there is one, the timestamp otherwise, to the millisecond (React parity). */
function scheduledKey(event: HistoryEvent): string {
  return (event.ScheduledTime ?? event.Timestamp ?? '').slice(0, 23);
}

/** The one line a failure can say about itself, when the runtime wrote one. */
function reasonOf(event: HistoryEvent): string | undefined {
  const reason = event.Result ?? event.Details;

  return typeof reason === 'string' && reason ? reason : undefined;
}

/**
 * Builds the diagram. Async because a sub-orchestration's own calls are only in its own history,
 * which is a second request - and a bounded number of them, because a deep tree of children would
 * otherwise fetch the whole hub to draw one diagram.
 */
export async function buildSequence(options: BuildSequenceOptions): Promise<SequenceModel> {
  const participants: string[] = [];
  const messages: SequenceMessage[] = [];

  const add = (name: string): string => {
    if (!participants.includes(name)) {
      // The external actor is a lane like any other, but it belongs on the left of everything
      if (name === EXTERNAL_ACTOR) {
        participants.unshift(name);
      } else {
        participants.push(name);
      }
    }

    return name;
  };

  let budget = options.maxNested ?? MAX_NESTED_LOADS;

  async function walk(orchestrator: string, history: HistoryEvent[], isFailed: boolean): Promise<void> {
    add(orchestrator);

    for (let index = 0; index < history.length; index++) {
      const event = history[index];

      switch (event.EventType) {
        case 'TaskScheduled':
        case 'TaskCompleted': {
          // React's aggregation: consecutive identical calls sent at the same millisecond are one
          // `par n calls` block rather than n arrows nobody can tell apart
          let last = index;
          let longest = event.DurationInMs ?? 0;

          while (
            last + 1 < history.length &&
            history[last + 1].EventType === event.EventType &&
            history[last + 1].Name === event.Name &&
            scheduledKey(history[last + 1]) === scheduledKey(event)
          ) {
            last += 1;
            longest = Math.max(longest, history[last].DurationInMs ?? 0);
          }

          const name = add(event.Name ?? '');
          const completed = event.EventType === 'TaskCompleted';
          const count = last - index + 1;

          messages.push({
            t: event.Timestamp,
            from: completed ? name : orchestrator,
            to: completed ? orchestrator : name,
            label: event.Name ?? '',
            kind: completed ? 'return' : 'call',
            note: completed ? fmtDuration(longest || event.DurationInMs) : undefined,
            ...(count > 1 ? { parallel: count } : {}),
          });

          index = last;
          break;
        }

        case 'TaskFailed': {
          const name = add(event.Name ?? '');

          messages.push({
            t: event.Timestamp,
            from: name,
            to: orchestrator,
            label: event.Name ?? '',
            kind: 'failed',
            note: reasonOf(event) ?? fmtDuration(event.DurationInMs),
          });
          break;
        }

        case 'SubOrchestrationInstanceCreated': {
          const name = add(event.Name ?? '');

          messages.push({
            t: event.Timestamp,
            from: orchestrator,
            to: name,
            label: event.Name ?? '',
            kind: 'call',
          });
          break;
        }

        case 'SubOrchestrationInstanceCompleted':
        case 'SubOrchestrationInstanceFailed': {
          const failedSub = event.EventType === 'SubOrchestrationInstanceFailed';
          const name = add(event.Name ?? '');

          messages.push({
            t: event.Timestamp,
            from: name,
            to: orchestrator,
            label: event.Name ?? '',
            kind: failedSub ? 'failed' : 'return',
            note: failedSub ? reasonOf(event) : fmtDuration(event.DurationInMs),
          });

          // What the child itself did is only in the child's own history
          if (event.SubOrchestrationId && options.loadHistory && budget > 0) {
            budget -= 1;

            try {
              const nested = await options.loadHistory(event.SubOrchestrationId);

              await walk(name, nested, failedSub);
            } catch {
              // React drew the same thing: the diagram says what it could not read rather than
              // pretending the child did nothing
              messages.push({
                t: event.Timestamp,
                from: orchestrator,
                to: name,
                label: '[FailedToLoad]',
                kind: 'failed',
              });
            }
          }

          break;
        }

        case 'EventRaised':
          // The mockup draws an external event as a loop on the orchestrator's own lane (L333):
          // what matters is that the orchestration received it, not who sent it
          messages.push({
            t: event.Timestamp,
            from: orchestrator,
            to: orchestrator,
            label: `EventRaised ${event.Name ?? ''}`.trim(),
            kind: 'self',
          });
          break;

        case 'ExecutionTerminated':
          messages.push({
            t: event.Timestamp,
            from: add(EXTERNAL_ACTOR),
            to: orchestrator,
            label: '[ExecutionTerminated]',
            kind: 'terminated',
            note: reasonOf(event),
          });
          break;

        case 'ExecutionCompleted':
          messages.push({
            t: event.Timestamp,
            from: orchestrator,
            to: add(EXTERNAL_ACTOR),
            label: isFailed ? '[ExecutionFailed]' : '[ExecutionCompleted]',
            kind: isFailed ? 'failed' : 'return',
            note: fmtDuration(event.DurationInMs),
          });
          break;

        // ExecutionStarted, OrchestratorStarted, TimerCreated and TimerFired are not messages: the
        // orchestrator's lane starting is the diagram, and a timer is time passing on it
        default:
          break;
      }
    }
  }

  await walk(options.orchestratorName, options.history, options.isFailed ?? false);

  return { participants, messages };
}

/** The arrow of each kind, in mermaid's own notation. */
const ARROWS: Readonly<Record<SequenceMessageKind, string>> = {
  call: '->>',
  return: '-->>',
  failed: '-x',
  external: '->>',
  self: '->>',
  terminated: '->>',
};

/**
 * The same diagram as mermaid source, which is what "Copy diagram code to clipboard" copies. React
 * generated this text and handed it to mermaid; here it is generated from the model, so what is
 * copied is what is on screen.
 */
export function toMermaid(model: SequenceModel): string {
  const lines: string[] = ['sequenceDiagram'];

  for (const participant of model.participants) {
    lines.push(`participant ${participant}`);
  }

  for (const message of model.messages) {
    const arrow = `${message.from}${ARROWS[message.kind]}${message.to}:${message.label}`;

    if (message.parallel && message.parallel > 1) {
      lines.push(`par ${message.parallel} calls`, arrow, 'end');
    } else {
      lines.push(arrow);
    }

    if (message.note) {
      lines.push(`Note over ${message.from},${message.to}: ${message.note}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
