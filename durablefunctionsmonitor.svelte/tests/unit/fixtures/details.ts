// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenInstance.dc.html: the workspace of order-2026-09-04-000913, its stored input and the
// sub-orchestration it created.

import type { OrchestrationDetails } from '$lib/api/types';
import { instance } from './instances';

/** The input the Inputs tab shows and the dialogs quote (ScreenInstance.dc.html STORED). */
export const storedInput = {
  orderId: 'A-1043',
  customerId: 88214,
  lines: [
    { sku: 'SKU-4471', qty: 2, unitPrice: 49.75 },
    { sku: 'SKU-2210', qty: 1, unitPrice: 30.0 },
  ],
  currency: 'USD',
  total: 129.5,
};

export function details(overrides: Partial<OrchestrationDetails> = {}): OrchestrationDetails {
  return {
    ...instance(),
    parentInstanceId: null,
    tabTemplateNames: ['Order summary'],
    input: storedInput,
    output: null,
    tags: { channel: 'web' },
    ...overrides,
  };
}

/** The failed one the Failures screen groups, opened on its own. */
export function failedDetails(overrides: Partial<OrchestrationDetails> = {}): OrchestrationDetails {
  return details({
    instanceId: 'order-2026-09-04-000911',
    runtimeStatus: 'Failed',
    createdTime: '2026-09-04T13:51:02Z',
    lastUpdatedTime: '2026-09-04T13:51:19Z',
    duration: 17_000,
    customStatus: { error: 'InventoryUnavailable', sku: 'SKU-4471' },
    output: 'InventoryUnavailable: SKU-4471 is out of stock',
    ...overrides,
  });
}

/** The child the workspace links to, whose parent is the order above. */
export function childDetails(overrides: Partial<OrchestrationDetails> = {}): OrchestrationDetails {
  return details({
    instanceId: 'order-2026-09-04-000913:0',
    name: 'NotifyCustomer',
    parentInstanceId: 'order-2026-09-04-000913',
    createdTime: '2026-09-04T14:02:28Z',
    lastUpdatedTime: '2026-09-04T14:02:29Z',
    duration: 1_000,
    tabTemplateNames: [],
    customStatus: undefined,
    ...overrides,
  });
}
