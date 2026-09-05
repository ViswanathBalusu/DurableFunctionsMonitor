// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenOverview.dc.html and ScreenFunctions.dc.html: the totals, the histogram bins and the
// per-orchestrator table of GET /stats over the last 24 hours.

import type { StatsBin, StatsByName, StatsResponse } from '$lib/api/types';

const FROM = '2026-09-03T14:00:00Z';
const TO = '2026-09-04T14:00:00Z';

/** Twenty-four hourly bins; the last few carry the failures the Overview chart points at. */
export function bins(count = 24): StatsBin[] {
  const start = new Date(FROM).getTime();

  return Array.from({ length: count }, (_, index) => ({
    start: new Date(start + index * 3_600_000).toISOString(),
    end: new Date(start + (index + 1) * 3_600_000).toISOString(),
    counts: {
      Completed: 40 + (index % 5) * 3,
      Failed: index >= count - 3 ? 4 : index % 7 === 0 ? 1 : 0,
      Running: index === count - 1 ? 2 : 0,
    },
  }));
}

export function byName(overrides: Partial<StatsByName> = {}): StatsByName {
  return {
    name: 'ProcessOrderOrchestrator',
    started: 1_102,
    completed: 1_080,
    failed: 19,
    running: 3,
    failureRate: 0.017,
    p50Ms: 24_000,
    p95Ms: 51_000,
    lastFailedAt: '2026-09-04T13:51:19Z',
    ...overrides,
  };
}

export function stats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    from: FROM,
    to: TO,
    binCount: 24,
    totals: { all: 1_229, entities: 2, Completed: 1_180, Failed: 24, Running: 3, Pending: 1, Suspended: 1 },
    bins: bins(),
    byName: [
      byName(),
      byName({
        name: 'ReconcileLedgerOrchestrator',
        started: 24,
        completed: 22,
        failed: 1,
        running: 0,
        failureRate: 0.042,
        p50Ms: 2_400_000,
        p95Ms: 2_900_000,
        lastFailedAt: '2026-09-03T02:42:13Z',
      }),
      byName({
        name: 'OnboardTenantOrchestrator',
        started: 7,
        completed: 7,
        failed: 0,
        running: 0,
        failureRate: 0,
        p50Ms: 141_000,
        p95Ms: 168_000,
        lastFailedAt: null,
      }),
      byName({
        name: 'NotifyCustomer',
        started: 1_096,
        completed: 1_096,
        failed: 0,
        running: 0,
        failureRate: 0,
        p50Ms: 900,
        p95Ms: 1_400,
        lastFailedAt: null,
      }),
    ],
    entitiesByName: [{ name: 'Counter', count: 2 }],
    stuck: { count: 1, sampleIds: ['order-2026-09-03-004411'], oldestLastUpdatedAt: '2026-09-04T00:00:02Z' },
    oldestPending: { count: 1, sampleIds: ['order-2026-09-04-000899'], oldestCreatedAt: '2026-09-04T12:10:04Z' },
    suspended: { count: 1, sampleIds: ['order-2026-09-03-004411'], oldestLastUpdatedAt: '2026-09-04T00:00:02Z' },
    scanned: 1_229,
    partial: false,
    cap: 20_000,
    elapsedMs: 412,
    generatedAt: TO,
    cached: false,
    ...overrides,
  };
}

/** What a hub too big to scan answers: the same shape, with `partial` telling the truth about it. */
export function partialStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return stats({ partial: true, scanned: 20_000, cap: 20_000, ...overrides });
}
