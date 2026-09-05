// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenInstances.dc.html L189-L203: the nine orchestrations and two entities the Instances table
// draws, with their real statuses, durations and custom statuses.

import type { EntityType, OrchestrationStatus, RuntimeStatus } from '$lib/api/types';

export function instance(overrides: Partial<OrchestrationStatus> = {}): OrchestrationStatus {
  return {
    instanceId: 'order-2026-09-04-000913',
    name: 'ProcessOrderOrchestrator',
    runtimeStatus: 'Running',
    entityType: 'Orchestration',
    createdTime: '2026-09-04T14:02:11Z',
    lastUpdatedTime: '2026-09-04T14:02:58Z',
    duration: 47_000,
    customStatus: { step: 'ChargePayment', attempt: 2 },
    lastEvent: 'SubOrchestrationInstanceCreated',
    ...overrides,
  };
}

export function entity(overrides: Partial<OrchestrationStatus> = {}): OrchestrationStatus {
  return instance({
    instanceId: '@counter@warehouse-07',
    name: 'Counter',
    runtimeStatus: 'Pending',
    entityType: 'DurableEntity',
    entityId: { name: 'counter', key: 'warehouse-07' },
    createdTime: '2026-09-01T08:00:00Z',
    lastUpdatedTime: '2026-09-04T14:01:47Z',
    duration: 280_907_000,
    customStatus: undefined,
    input: { value: 1284, lastSku: 'SKU-4471' },
    ...overrides,
  });
}

/** One row per status the vocabulary has, which is what the table's chips are drawn against. */
export const instances: OrchestrationStatus[] = [
  instance(),
  instance({
    instanceId: 'order-2026-09-04-000912',
    runtimeStatus: 'Completed',
    createdTime: '2026-09-04T13:58:40Z',
    lastUpdatedTime: '2026-09-04T13:59:05Z',
    duration: 25_000,
    customStatus: undefined,
  }),
  instance({
    instanceId: 'order-2026-09-04-000911',
    runtimeStatus: 'Failed',
    createdTime: '2026-09-04T13:51:02Z',
    lastUpdatedTime: '2026-09-04T13:51:19Z',
    duration: 17_000,
    customStatus: { error: 'InventoryUnavailable', sku: 'SKU-4471' },
    output: 'InventoryUnavailable: SKU-4471 is out of stock',
  }),
  instance({
    instanceId: 'order-2026-09-04-000907',
    runtimeStatus: 'Failed',
    createdTime: '2026-09-04T13:40:11Z',
    lastUpdatedTime: '2026-09-04T13:40:26Z',
    duration: 15_000,
    customStatus: { error: 'InventoryUnavailable', sku: 'SKU-2210' },
    output: 'InventoryUnavailable: SKU-2210 is out of stock',
  }),
  instance({
    instanceId: 'order-2026-09-04-000899',
    runtimeStatus: 'Pending',
    createdTime: '2026-09-04T12:10:04Z',
    lastUpdatedTime: '2026-09-04T12:10:04Z',
    duration: 0,
    customStatus: undefined,
  }),
  instance({
    instanceId: 'order-2026-09-04-000880',
    runtimeStatus: 'ContinuedAsNew',
    createdTime: '2026-09-04T11:02:00Z',
    lastUpdatedTime: '2026-09-04T11:02:31Z',
    duration: 31_000,
    customStatus: undefined,
  }),
  instance({
    instanceId: '8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8',
    name: 'OnboardTenantOrchestrator',
    runtimeStatus: 'Completed',
    createdTime: '2026-09-04T09:12:40Z',
    lastUpdatedTime: '2026-09-04T09:15:01Z',
    duration: 141_000,
    customStatus: { tenant: 'contoso', step: 'done' },
  }),
  instance({
    instanceId: 'nightly-reconcile-20260903',
    name: 'ReconcileLedgerOrchestrator',
    runtimeStatus: 'Terminated',
    createdTime: '2026-09-03T02:00:00Z',
    lastUpdatedTime: '2026-09-03T02:42:13Z',
    duration: 2_533_000,
    customStatus: { reason: 'operator' },
  }),
  instance({
    instanceId: 'order-2026-09-03-004411',
    runtimeStatus: 'Suspended',
    createdTime: '2026-09-03T23:58:10Z',
    // The mockup labels this row "14 h" against timestamps that are 112 seconds apart; the
    // contract says duration is lastUpdatedTime - createdTime, so the timestamps win
    lastUpdatedTime: '2026-09-04T00:00:02Z',
    duration: 112_000,
    customStatus: { step: 'ChargePayment', attempt: 3 },
  }),
];

export const entityInstances: OrchestrationStatus[] = [
  entity(),
  entity({
    instanceId: '@counter@warehouse-12',
    entityId: { name: 'counter', key: 'warehouse-12' },
    lastUpdatedTime: '2026-09-04T13:20:09Z',
    duration: 278_409_000,
    input: { value: 312, lastSku: 'SKU-1180' },
  }),
];

/** A page of rows, for the paging and virtualisation tests: ids run down from the newest. */
export function page(count: number, status: RuntimeStatus = 'Completed', kind: EntityType = 'Orchestration') {
  return Array.from({ length: count }, (_, index) =>
    instance({
      instanceId: `order-2026-09-04-${String(900 - index).padStart(6, '0')}`,
      runtimeStatus: status,
      entityType: kind,
      createdTime: new Date(Date.UTC(2026, 8, 4, 12, 0, 0) - index * 60_000).toISOString(),
      lastUpdatedTime: new Date(Date.UTC(2026, 8, 4, 12, 0, 30) - index * 60_000).toISOString(),
      duration: 30_000,
    }),
  );
}
