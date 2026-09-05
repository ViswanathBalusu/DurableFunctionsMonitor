// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenFailures.dc.html L79-L95: failures grouped by orchestrator and error signature, the largest
// group first - InventoryUnavailable, which is what six of the nine failed orders have in common.
//
// Faithful to B3's `FailuresAggregator`, which is what the screen is written against:
//   - `signature` is the *whole* reason with its numbers, GUIDs and quoted values replaced by `*`
//     (`FailureSignature.Normalize`), not the exception class on its own;
//   - `key` is `{name}|{signature}`;
//   - `count` is every instance that failed, and `instances` carries the newest fifty of them, so
//     the two are equal below (no group here is anywhere near the cap);
//   - `totalFailed` is the number of rows scanned that failed - the sum of the group counts - while
//     `scanned` counts every row the table returned, entities included.

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
  const instances = [
    failureInstance(),
    failureInstance({
      instanceId: 'order-2026-09-04-000907',
      createdTime: '2026-09-04T13:40:11Z',
      completedTime: '2026-09-04T13:40:26Z',
      durationMs: 15_000,
      reason: 'InventoryUnavailable: SKU-2210 is out of stock',
    }),
    failureInstance({
      instanceId: 'order-2026-09-04-000902',
      createdTime: '2026-09-04T13:22:48Z',
      completedTime: '2026-09-04T13:23:04Z',
      durationMs: 16_000,
    }),
    failureInstance({
      instanceId: 'order-2026-09-04-000897',
      createdTime: '2026-09-04T12:58:30Z',
      completedTime: '2026-09-04T12:58:48Z',
      durationMs: 18_000,
      reason: 'InventoryUnavailable: SKU-8804 is out of stock',
    }),
    failureInstance({
      instanceId: 'order-2026-09-04-000890',
      createdTime: '2026-09-04T12:31:07Z',
      completedTime: '2026-09-04T12:31:21Z',
      durationMs: 14_000,
    }),
    failureInstance({
      instanceId: 'order-2026-09-04-000884',
      createdTime: '2026-09-04T12:12:55Z',
      completedTime: '2026-09-04T12:13:12Z',
      durationMs: 17_000,
      reason: 'InventoryUnavailable: SKU-1190 is out of stock',
    }),
  ];

  return {
    key: 'ProcessOrderOrchestrator|InventoryUnavailable: SKU-* is out of stock',
    name: 'ProcessOrderOrchestrator',
    signature: 'InventoryUnavailable: SKU-* is out of stock',
    count: instances.length,
    lastSeenAt: '2026-09-04T13:51:19Z',

    // B3 carries the newest five ids as the group's sample
    sampleIds: instances.slice(0, 5).map((instance) => instance.instanceId),
    instances,
    ...overrides,
  };
}

export function failures(overrides: Partial<FailuresResponse> = {}): FailuresResponse {
  const timeout = 'TimeoutException: payment gateway did not answer within 4 s';

  return {
    groups: [
      failureGroup(),
      failureGroup({
        key: 'ProcessOrderOrchestrator|TimeoutException: payment gateway did not answer within * s',
        signature: 'TimeoutException: payment gateway did not answer within * s',
        count: 2,
        lastSeenAt: '2026-09-04T12:31:44Z',
        sampleIds: ['order-2026-09-04-000871', 'order-2026-09-04-000861'],
        instances: [
          failureInstance({
            instanceId: 'order-2026-09-04-000871',
            createdTime: '2026-09-04T12:31:20Z',
            completedTime: '2026-09-04T12:31:44Z',
            durationMs: 24_000,
            reason: timeout,
          }),
          failureInstance({
            instanceId: 'order-2026-09-04-000861',
            createdTime: '2026-09-04T10:44:12Z',
            completedTime: '2026-09-04T10:44:36Z',
            durationMs: 24_000,
            reason: timeout,
          }),
        ],
      }),
      failureGroup({
        key: 'ReconcileLedgerOrchestrator|LedgerOutOfBalance: * entries could not be matched',
        name: 'ReconcileLedgerOrchestrator',
        signature: 'LedgerOutOfBalance: * entries could not be matched',
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

    // Six, two and one: every failure of the range is in a group
    totalFailed: 9,
    scanned: 12_408,
    partial: false,
    cap: 20_000,
    elapsedMs: 388,
    generatedAt: '2026-09-04T14:00:00Z',
    cached: false,
    ...overrides,
  };
}
