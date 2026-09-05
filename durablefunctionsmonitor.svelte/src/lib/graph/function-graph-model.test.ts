// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { FunctionMapResponse } from '$lib/api/types';
import { NODE_HEIGHT, NODE_HEIGHT_WITH_METRICS, NODE_WIDTH, layout } from './layout';
import { bindingText, buildFunctionGraph, triggerOf } from './function-graph-model';
import { functionMap } from '../../../tests/unit/fixtures/function-map';

function kinds(map: FunctionMapResponse = functionMap()): Record<string, string> {
  const graph = buildFunctionGraph(map);

  return Object.fromEntries(graph.nodes.map((node) => [node.id, node.kind]));
}

describe('buildFunctionGraph', () => {
  it('gives the mockup hub its twelve nodes and ten edges', () => {
    const graph = buildFunctionGraph(functionMap());

    expect(graph.nodes).toHaveLength(12);
    expect(graph.edges).toHaveLength(10);
  });

  it('reads the kind of each function off its trigger', () => {
    expect(kinds()).toEqual({
      StartOrder: 'http',
      NightlyReconcile: 'timer',
      OnPaymentSettled: 'queue',
      ProcessOrderOrchestrator: 'orchestrator',
      ReconcileLedgerOrchestrator: 'orchestrator',
      NotifyCustomer: 'suborchestrator',
      ReserveInventory: 'activity',
      ChargePayment: 'activity',
      SendConfirmation: 'activity',
      ExportReport: 'activity',
      ArchiveBlob: 'activity',
      Counter: 'entity',
    });
  });

  it('calls each trigger what the mockup calls it', () => {
    const graph = buildFunctionGraph(functionMap());
    const labels = Object.fromEntries(graph.nodes.map((node) => [node.id, node.kindLabel]));

    expect(labels.StartOrder).toBe('HTTP trigger');
    expect(labels.NightlyReconcile).toBe('Timer trigger');
    expect(labels.OnPaymentSettled).toBe('Service Bus trigger');
    expect(labels.ProcessOrderOrchestrator).toBe('Orchestrator');
    expect(labels.NotifyCustomer).toBe('Sub-orchestrator');
    expect(labels.ReserveInventory).toBe('Activity');
    expect(labels.Counter).toBe('Entity');
  });

  it('is a sub-orchestration only when an orchestration calls it', () => {
    // An orchestration started by an HTTP trigger is still an orchestration
    expect(kinds().ProcessOrderOrchestrator).toBe('orchestrator');
    expect(kinds().NotifyCustomer).toBe('suborchestrator');
  });

  it('calls a function with a trigger nobody knows a Function', () => {
    const map = functionMap({
      functions: { Mystery: { bindings: [{ type: 'signalRTrigger', direction: 'in' }] } },
    });

    const graph = buildFunctionGraph(map);

    expect(graph.nodes[0]).toMatchObject({ kind: 'other', kindLabel: 'Function' });
  });

  it('draws a call, a signal and a ContinueAsNew loop', () => {
    const graph = buildFunctionGraph(functionMap());

    expect(graph.edges).toContainEqual({
      id: 'ProcessOrderOrchestrator->ReserveInventory',
      from: 'ProcessOrderOrchestrator',
      to: 'ReserveInventory',
      arrow: true,
    });

    expect(graph.edges).toContainEqual({
      id: 'ProcessOrderOrchestrator->Counter:add',
      from: 'ProcessOrderOrchestrator',
      to: 'Counter',
      label: 'add',
      arrow: true,
    });

    const looping = buildFunctionGraph(
      functionMap({
        functions: {
          ReconcileLedgerOrchestrator: {
            bindings: [{ type: 'orchestrationTrigger', direction: 'in' }],
            isCalledByItself: true,
          },
        },
      }),
    );

    expect(looping.edges).toContainEqual({
      id: 'ReconcileLedgerOrchestrator->ReconcileLedgerOrchestrator',
      from: 'ReconcileLedgerOrchestrator',
      to: 'ReconcileLedgerOrchestrator',
      label: 'ContinueAsNew',
      arrow: true,
    });
  });

  it('gives every non-trigger binding a node of its own, dashed to its function', () => {
    const graph = buildFunctionGraph(
      functionMap({
        functions: {
          ArchiveBlob: {
            bindings: [
              { type: 'activityTrigger', direction: 'in' },
              { type: 'blob', direction: 'in', path: 'invoices/{name}' },
              { type: 'queue', direction: 'out', queueName: 'archived' },
              { type: 'table', direction: undefined, tableName: 'Audit' },
            ],
          },
        },
      }),
    );

    expect(graph.nodes.map((node) => [node.id, node.name, node.binding])).toEqual([
      ['ArchiveBlob', 'ArchiveBlob', undefined],
      ['ArchiveBlob.binding1', 'blob:invoices/{name}', true],
      ['ArchiveBlob.binding2', 'queue:archived', true],
      ['ArchiveBlob.binding3', 'table:Audit', true],
    ]);

    // In points at the function, out points away from it, and the third is attached to it
    expect(graph.edges).toEqual([
      {
        id: 'ArchiveBlob.binding1->ArchiveBlob',
        from: 'ArchiveBlob.binding1',
        to: 'ArchiveBlob',
        dashed: true,
        arrow: true,
      },
      {
        id: 'ArchiveBlob->ArchiveBlob.binding2',
        from: 'ArchiveBlob',
        to: 'ArchiveBlob.binding2',
        dashed: true,
        arrow: true,
      },
      {
        id: 'ArchiveBlob-ArchiveBlob.binding3',
        from: 'ArchiveBlob',
        to: 'ArchiveBlob.binding3',
        dashed: true,
        arrow: false,
      },
    ]);
  });

  it('names a binding the way az-func-as-a-graph did, without its mermaid spacer', () => {
    expect(bindingText({ type: 'table', tableName: 'Audit' })).toBe('table:Audit');
    expect(bindingText({ type: 'blob', blobPath: 'in/{name}' })).toBe('blob:in/{name}');
    expect(bindingText({ type: 'cosmosDB', databaseName: 'orders', collectionName: 'lines' })).toBe(
      'cosmosDB:orders:lines',
    );
    expect(bindingText({ type: 'serviceBus', topicName: 'payments', subscriptionName: 'dfm' })).toBe(
      'serviceBus:payments:dfm',
    );
    expect(bindingText({ type: 'eventHub', eventHubName: 'telemetry' })).toBe('eventHub:telemetry');
    expect(bindingText({ type: 'signalR' })).toBe('signalR');
  });

  it('finds the trigger among the bindings, and copes with a function that has none', () => {
    expect(triggerOf({ bindings: [{ type: 'blob' }, { type: 'timerTrigger' }] })?.type).toBe('timerTrigger');
    expect(triggerOf({ bindings: [] })).toBeUndefined();
    expect(triggerOf({})).toBeUndefined();
  });

  it('renders a proxy by its route', () => {
    const graph = buildFunctionGraph({
      functions: {},
      proxies: { 'Order proxy': { matchCondition: { route: '/api/orders/{id}' } } },
    });

    expect(graph.nodes).toEqual([
      { id: 'proxy.Order proxy', name: '/api/orders/{id}', kind: 'other', kindLabel: 'Proxy', binding: true },
    ]);
  });

  it('is empty for a map that is not there', () => {
    expect(buildFunctionGraph(null)).toEqual({ nodes: [], edges: [] });
  });
});

describe('layout', () => {
  it('puts triggers, orchestrators and activities in that order, left to right', () => {
    const positioned = layout(buildFunctionGraph(functionMap()));
    const x = Object.fromEntries(positioned.map((node) => [node.id, node.x]));

    expect(x.StartOrder).toBeLessThan(x.ProcessOrderOrchestrator);
    expect(x.ProcessOrderOrchestrator).toBeLessThan(x.ReserveInventory);
    expect(x.ProcessOrderOrchestrator).toBeLessThan(x.NotifyCustomer);
    expect(x.NightlyReconcile).toBeLessThan(x.ReconcileLedgerOrchestrator);

    // Rank 0 is one column: every trigger starts at the same x
    expect(x.NightlyReconcile).toBe(x.StartOrder);
    expect(x.OnPaymentSettled).toBe(x.StartOrder);
  });

  it('sizes a card by whether it carries counters', () => {
    const positioned = layout(buildFunctionGraph(functionMap()), {
      hasMetrics: (node) => node.kind === 'orchestrator',
    });

    const orchestrator = positioned.find((node) => node.id === 'ProcessOrderOrchestrator');
    const activity = positioned.find((node) => node.id === 'ReserveInventory');

    expect(orchestrator).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT_WITH_METRICS });
    expect(activity).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  it('positions by the top-left corner, which is what the renderer places nodes by', () => {
    const positioned = layout({
      nodes: [{ id: 'One', name: 'One', kind: 'activity', kindLabel: 'Activity' }],
      edges: [],
    });

    // dagre puts a lone node at half its own size; the corner is therefore the origin
    expect(positioned[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('lays out a self loop without pushing its node out of its rank', () => {
    const graph = buildFunctionGraph(
      functionMap({
        functions: {
          Reconcile: { bindings: [{ type: 'orchestrationTrigger', direction: 'in' }], isCalledByItself: true },
        },
      }),
    );

    const positioned = layout(graph);

    expect(positioned).toHaveLength(1);
    expect(positioned[0]).toMatchObject({ x: 0, y: 0 });
  });
});
