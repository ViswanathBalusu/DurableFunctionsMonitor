// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenFailures.dc.html: failures grouped by orchestrator and error signature, the largest group
// first - InventoryUnavailable, which is what the two failed orders of the mockup have in common.

import type { FailureGroup, FailureInstance, FailuresResponse } from '$lib/api/types';

export function failureInstance(overrides: Partial<FailureInstance> = {}): FailureInstance {
  return {
    instanceId: 'order-2026-09-04-000911',
    createdTime: '2026-09-04T13:51:02Z',
    completedTime: '2026-09-04T13:51:19Z',
    durationMs: 17_000,
    reason: 'InventoryUnavailable: SKU-4471 is out of stock',
    ...overrides,
  };
}

export function failureGroup(overrides: Partial<FailureGroup> = {}): FailureGroup {
  return {
    key: 'ProcessOrderOrchestrator|InventoryUnavailable',
    name: 'ProcessOrderOrchestrator',
    signature: 'InventoryUnavailable',
    count: 12,
    lastSeenAt: '2026-09-04T13:51:19Z',
    sampleIds: ['order-2026-09-04-000911', 'order-2026-09-04-000907'],
    instances: [
      failureInstance(),
      failureInstance({
        instanceId: 'order-2026-09-04-000907',
        createdTime: '2026-09-04T13:40:11Z',
        completedTime: '2026-09-04T13:40:26Z',
        durationMs: 15_000,
        reason: 'InventoryUnavailable: SKU-2210 is out of stock',
      }),
    ],
    ...overrides,
  };
}

export function failures(overrides: Partial<FailuresResponse> = {}): FailuresResponse {
  return {
    groups: [
      failureGroup(),
      failureGroup({
        key: 'ProcessOrderOrchestrator|TimeoutException',
        signature: 'TimeoutException',
        count: 5,
        lastSeenAt: '2026-09-04T12:31:44Z',
        sampleIds: ['order-2026-09-04-000871'],
        instances: [
          failureInstance({
            instanceId: 'order-2026-09-04-000871',
            createdTime: '2026-09-04T12:31:20Z',
            completedTime: '2026-09-04T12:31:44Z',
            durationMs: 24_000,
            reason: 'TimeoutException: payment gateway did not answer within 4 s',
          }),
        ],
      }),
      failureGroup({
        key: 'ReconcileLedgerOrchestrator|LedgerOutOfBalance',
        name: 'ReconcileLedgerOrchestrator',
        signature: 'LedgerOutOfBalance',
        count: 1,
        lastSeenAt: '2026-09-03T02:42:13Z',
        sampleIds: ['nightly-reconcile-20260903'],
        instances: [
          failureInstance({
            instanceId: 'nightly-reconcile-20260903',
            createdTime: '2026-09-03T02:00:00Z',
            completedTime: '2026-09-03T02:42:13Z',
            durationMs: 2_533_000,
            reason: 'LedgerOutOfBalance: 3 entries could not be matched',
          }),
        ],
      }),
    ],
    totalFailed: 18,
    scanned: 1_229,
    partial: false,
    cap: 20_000,
    elapsedMs: 388,
    generatedAt: '2026-09-04T14:00:00Z',
    cached: false,
    ...overrides,
  };
}
