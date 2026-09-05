// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenStorage.dc.html: what GET /storage reports about the hub - its taskhub.json, its four
// control queues and the partitions their leases belong to.

import type { StoragePartition, StorageQueue, StorageResponse } from '$lib/api/types';

export function queue(overrides: Partial<StorageQueue> = {}): StorageQueue {
  return {
    name: 'durablefunctionshub-control-00',
    kind: 'control',
    partition: 0,
    approximateMessageCount: 3,
    ...overrides,
  };
}

export function partition(overrides: Partial<StoragePartition> = {}): StoragePartition {
  return {
    name: 'durablefunctionshub-control-00',
    owner: 'dfm-orders-prod_ffe2',
    ownedSince: '2026-09-04T09:14:02Z',
    isDraining: false,
    nextOwner: null,
    source: 'table',
    ...overrides,
  };
}

export function storage(overrides: Partial<StorageResponse> = {}): StorageResponse {
  return {
    provider: 'AzureStorage',
    accountName: 'dfmstorage001',
    taskHub: {
      name: 'DurableFunctionsHub',
      partitionCount: 4,
      createdAt: '2026-08-12T10:41:00Z',
      source: 'taskhub.json',
    },
    queues: [
      queue(),
      queue({ name: 'durablefunctionshub-control-01', partition: 1, approximateMessageCount: 0 }),
      queue({ name: 'durablefunctionshub-control-02', partition: 2, approximateMessageCount: 0 }),
      queue({ name: 'durablefunctionshub-control-03', partition: 3, approximateMessageCount: 1 }),
      queue({ name: 'durablefunctionshub-workitems', kind: 'workitems', partition: null, approximateMessageCount: 2 }),
    ],
    partitions: [
      partition(),
      partition({ name: 'durablefunctionshub-control-01' }),
      partition({ name: 'durablefunctionshub-control-02', owner: 'dfm-orders-prod_a10c' }),
      partition({
        name: 'durablefunctionshub-control-03',
        owner: 'dfm-orders-prod_a10c',
        isDraining: true,
        nextOwner: 'dfm-orders-prod_ffe2',
      }),
    ],
    tables: {
      instances: 'DurableFunctionsHubInstances',
      history: 'DurableFunctionsHubHistory',
      partitions: 'DurableFunctionsHubPartitions',
      audit: 'DurableFunctionsHubDfmAudit',
    },
    largeMessages: {
      container: 'durablefunctionshub-largemessages',
      exists: true,
      blobCount: 12,
      totalBytes: 4_718_592,
    },
    counts: { instancesRows: 1_229, historyRows: 38_104, partial: false },
    generatedAt: '2026-09-04T14:00:00Z',
    elapsedMs: 214,
    cached: false,
    ...overrides,
  };
}
