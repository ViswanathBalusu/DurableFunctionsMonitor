// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// GET /children of order-2026-09-04-000913: the NotifyCustomer sub-orchestration the history's
// last row created. Azure Storage matches generated ids, so `complete` is false there.

import type { ChildInstance, ChildrenResponse } from '$lib/api/types';

export function child(overrides: Partial<ChildInstance> = {}): ChildInstance {
  return {
    instanceId: 'order-2026-09-04-000913:0',
    name: 'NotifyCustomer',
    runtimeStatus: 'Running',
    createdTime: '2026-09-04T14:02:28.400Z',
    lastUpdatedTime: '2026-09-04T14:02:28.400Z',
    ...overrides,
  };
}

export function children(overrides: Partial<ChildrenResponse> = {}): ChildrenResponse {
  return {
    children: [
      child(),
      child({
        instanceId: 'order-2026-09-04-000913:1',
        name: 'ArchiveOrder',
        runtimeStatus: 'Completed',
        createdTime: '2026-09-04T14:02:29.100Z',
        lastUpdatedTime: '2026-09-04T14:02:30.050Z',
      }),
    ],
    complete: false,
    ...overrides,
  };
}
