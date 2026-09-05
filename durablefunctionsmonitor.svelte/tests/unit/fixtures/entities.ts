// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenEntities.dc.html: the counters of the mockup, their parsed state and the one-line summary
// the table shows before the full value is opened.
//
// Faithful to what B4 answers (checked against the host on 2026-09-05): the name is the `@name@` part
// of the id and is therefore lower case, `runtimeStatus` is Running for every entity - the framework
// has no other status for one - and `stateSummary` is the state with no whitespace at all, which is
// what `EntityState.Summarize` writes.

import type { EntitiesResponse, EntityRow } from '$lib/api/types';

export function entityRow(overrides: Partial<EntityRow> = {}): EntityRow {
  return {
    instanceId: '@counter@warehouse-07',
    entityName: 'counter',
    key: 'warehouse-07',
    state: { value: 1284, lastSku: 'SKU-4471' },
    stateSummary: '{"value":1284,"lastSku":"SKU-4471"}',
    stateError: null,
    lastUpdatedTime: '2026-09-04T14:01:47Z',
    runtimeStatus: 'Running',
    ...overrides,
  };
}

export function entities(overrides: Partial<EntitiesResponse> = {}): EntitiesResponse {
  return {
    entities: [
      entityRow(),
      entityRow({
        instanceId: '@counter@warehouse-12',
        key: 'warehouse-12',
        state: { value: 312, lastSku: 'SKU-1180' },
        stateSummary: '{"value":312,"lastSku":"SKU-1180"}',
        lastUpdatedTime: '2026-09-04T13:20:09Z',
      }),
      // A state the backend could not parse is reported as such, never guessed at
      entityRow({
        instanceId: '@ledger@main',
        entityName: 'ledger',
        key: 'main',
        state: null,
        stateSummary: null,
        stateError: 'Unexpected character at position 0',
        lastUpdatedTime: '2026-09-04T11:00:00Z',
      }),
    ],
    hasMore: false,
    ...overrides,
  };
}
