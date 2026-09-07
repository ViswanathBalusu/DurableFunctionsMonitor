// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '$lib/api/types';
import { DURABLE_TIMER, EXTERNAL_EVENTS, buildHistoryGraph } from './history-graph';
import { history as historyFixture, historyEvent } from '../../../tests/unit/fixtures/history';

const ORCHESTRATOR = 'ProcessOrderOrchestrator';

function build(history: HistoryEvent[] = historyFixture) {
  return buildHistoryGraph(ORCHESTRATOR, history);
}

function names(graph: ReturnType<typeof build>): string[] {
  return graph.nodes.map((node) => node.name);
}

describe('buildHistoryGraph', () => {
  it('puts the orchestrator first and everything it called after it, once each', () => {
    const graph = build();

    // ChargePayment is scheduled three times in the fixture and is one card, not three
    expect(names(graph)).toEqual([
      ORCHESTRATOR,
      'ReserveInventory',
      'ChargePayment',
      'NotifyCustomer',
      EXTERNAL_EVENTS,
      DURABLE_TIMER,
    ]);
  });

  it('calls an activity an activity and a sub-orchestration a sub-orchestrator', () => {
    const kinds = Object.fromEntries(build().nodes.map((node) => [node.name, node.kind]));

    expect(kinds).toMatchObject({
      [ORCHESTRATOR]: 'orchestrator',
      ReserveInventory: 'activity',
      ChargePayment: 'activity',
      // SubOrchestrationInstanceCreated, so it runs inside this one
      NotifyCustomer: 'suborchestrator',
    });
  });

  it('draws one edge out of the orchestrator per function it called', () => {
    const graph = build();

    expect(graph.edges.filter((edge) => edge.from === ORCHESTRATOR && !edge.dashed).map((edge) => edge.to)).toEqual([
      'ReserveInventory',
      'ChargePayment',
      'NotifyCustomer',
    ]);
  });

  it('draws external events coming in and the timer hanging off, as bindings rather than functions', () => {
    const graph = build();

    const external = graph.edges.find((edge) => edge.from === EXTERNAL_EVENTS);
    const timer = graph.edges.find((edge) => edge.to === DURABLE_TIMER);

    // The outside talks to the orchestration; the orchestration only waits on its timer
    expect(external).toMatchObject({ to: ORCHESTRATOR, dashed: true, arrow: true });
    expect(timer).toMatchObject({ from: ORCHESTRATOR, dashed: true, arrow: false });

    expect(graph.nodes.filter((node) => node.binding).map((node) => node.name)).toEqual([
      EXTERNAL_EVENTS,
      DURABLE_TIMER,
    ]);
  });

  it('leaves out what did not happen', () => {
    const graph = build([historyEvent({ EventType: 'ExecutionStarted', Name: ORCHESTRATOR })]);

    // An orchestration that called nothing is one card and no edges - not a card per thing it might
    // have called, which is what only the published function map can know
    expect(names(graph)).toEqual([ORCHESTRATOR]);
    expect(graph.edges).toEqual([]);
  });

  it('never makes the orchestrator a card of its own twice, and draws ContinueAsNew as a self loop', () => {
    const graph = build([
      historyEvent({ EventType: 'ExecutionStarted', Name: ORCHESTRATOR }),
      historyEvent({ SequenceNumber: 2, EventType: 'TaskScheduled', Name: 'ReserveInventory' }),
      historyEvent({ SequenceNumber: 3, EventType: 'ContinueAsNew', Name: ORCHESTRATOR }),
    ]);

    expect(names(graph)).toEqual([ORCHESTRATOR, 'ReserveInventory']);
    expect(graph.edges.find((edge) => edge.from === ORCHESTRATOR && edge.to === ORCHESTRATOR)).toMatchObject({
      label: 'ContinueAsNew',
    });
  });

  it('is nothing at all without a function name to hang it on', () => {
    expect(buildHistoryGraph('', historyFixture)).toEqual({ nodes: [], edges: [] });
  });
});
