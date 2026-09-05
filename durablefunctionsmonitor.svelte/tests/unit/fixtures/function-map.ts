// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The hub of ScreenFunctions.dc.html L83-L96: three triggers, two orchestrators, one
// sub-orchestrator, one entity and five activities - twelve nodes and ten edges, which is what the
// graph model has to come out with.

import type { FunctionMapNode, FunctionMapResponse } from '$lib/api/types';

function fn(trigger: string, overrides: Partial<FunctionMapNode> = {}): FunctionMapNode {
  return { bindings: [{ type: trigger, direction: 'in' }], ...overrides };
}

export function functionMap(overrides: Partial<FunctionMapResponse> = {}): FunctionMapResponse {
  return {
    functions: {
      StartOrder: fn('httpTrigger', { filePath: 'src/StartOrder.cs' }),
      NightlyReconcile: fn('timerTrigger'),
      OnPaymentSettled: fn('serviceBusTrigger'),

      // Started by two triggers, and an orchestrator all the same
      ProcessOrderOrchestrator: fn('orchestrationTrigger', { isCalledBy: ['StartOrder', 'OnPaymentSettled'] }),
      ReconcileLedgerOrchestrator: fn('orchestrationTrigger', { isCalledBy: ['NightlyReconcile'] }),

      // Called by an orchestration, which is what makes it a sub-orchestration
      NotifyCustomer: fn('orchestrationTrigger', { isCalledBy: ['ProcessOrderOrchestrator'] }),

      ReserveInventory: fn('activityTrigger', { isCalledBy: ['ProcessOrderOrchestrator'] }),
      ChargePayment: fn('activityTrigger', { isCalledBy: ['ProcessOrderOrchestrator'] }),
      SendConfirmation: fn('activityTrigger', { isCalledBy: ['ProcessOrderOrchestrator'] }),
      ExportReport: fn('activityTrigger', { isCalledBy: ['ReconcileLedgerOrchestrator'] }),
      ArchiveBlob: fn('activityTrigger', { isCalledBy: ['ReconcileLedgerOrchestrator'] }),

      Counter: fn('entityTrigger', {
        isSignalledBy: [{ name: 'ProcessOrderOrchestrator', signalName: 'add' }],
      }),
    },
    proxies: {},
    ...overrides,
  };
}

/** The twelve node names, in the order the map lists them. */
export const FUNCTION_NAMES = Object.keys(functionMap().functions);
