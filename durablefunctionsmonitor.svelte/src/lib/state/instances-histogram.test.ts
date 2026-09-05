// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { OrchestrationStatus, OrchestrationsQuery } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import type { ITypedLocalStorage } from '$lib/storage/typed-local-storage';
import { AppState } from './app.svelte';
import { HISTOGRAM_BINS, HISTOGRAM_PAGE_SIZE, InstancesHistogram, OTHER_SERIES } from './instances-histogram.svelte';
import { Instances, type InstancesViewState } from './instances.svelte';
import { Prefs } from './prefs.svelte';
import { instance, page } from '../../../tests/unit/fixtures/instances';

/** Two in the afternoon, so a 24-hour range starts at two the day before. */
const NOW = new Date('2026-09-04T14:00:00.000Z').getTime();

const noStorage: ITypedLocalStorage<InstancesViewState> = {
  getItem: () => null,
  setItem: () => {},
  setItems: () => {},
  removeItem: () => {},
};

function setup(pages: OrchestrationStatus[][], path = '/DurableFunctionsHub/instances') {
  window.history.replaceState({}, '', path);

  const queries: OrchestrationsQuery[] = [];
  let call = 0;

  const endpoints = {
    listOrchestrations: async (query: OrchestrationsQuery) => {
      queries.push(query);
      return pages[Math.min(call++, pages.length - 1)] ?? [];
    },
  } as unknown as Endpoints;

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub' });

  const instances = new Instances({ app, storage: noStorage, now: () => NOW });
  const histogram = new InstancesHistogram({ app, instances, now: () => NOW });

  return { app, histogram, queries };
}

/** Rows per name, all created inside the window - the first a minute back, since `to` is its edge. */
function named(names: string[], perName: number): OrchestrationStatus[] {
  return names.flatMap((name, nameIndex) =>
    Array.from({ length: perName }, (_, index) =>
      instance({
        instanceId: `${name}-${index}`,
        name,
        createdTime: new Date(NOW - (nameIndex * 60 + index + 1) * 60_000).toISOString(),
      }),
    ),
  );
}

describe('InstancesHistogram', () => {
  it('walks the filtered list a thousand at a time and stops on a short page', async () => {
    const { histogram, queries } = setup([page(HISTOGRAM_PAGE_SIZE), page(3)]);

    await histogram.load();

    expect(histogram.scanned).toBe(1003);
    expect(queries).toHaveLength(2);
    expect(queries.map((query) => query.skip)).toEqual([0, 1000]);
    expect(queries.every((query) => query.top === HISTOGRAM_PAGE_SIZE)).toBe(true);
    expect(queries[0].hiddenColumns).toEqual(['input', 'output', 'customStatus']);
  });

  it('asks every page for the same window, so the list cannot move under it', async () => {
    const { queries, histogram } = setup([page(HISTOGRAM_PAGE_SIZE), page(1)]);

    await histogram.load();

    expect(queries[1].filter).toBe(queries[0].filter);
  });

  it('cuts the range into 48 bins and says how long one is', async () => {
    const { histogram } = setup([[]]);

    await histogram.load();

    expect(histogram.bins).toHaveLength(HISTOGRAM_BINS);
    expect(histogram.binMs).toBe(30 * 60_000);
    expect(histogram.ariaLabel).toBe('Instances per 30 min by orchestrator');
    expect(histogram.bins[0].start.toISOString()).toBe('2026-09-03T14:00:00.000Z');
    expect(histogram.bins.at(-1)?.end.toISOString()).toBe('2026-09-04T14:00:00.000Z');
  });

  it('counts each instance into the bin it was created in', async () => {
    const rows = [
      instance({ instanceId: 'a', createdTime: '2026-09-04T13:59:00Z' }),
      instance({ instanceId: 'b', createdTime: '2026-09-04T13:29:00Z' }),
      instance({ instanceId: 'c', name: 'OnboardTenantOrchestrator', createdTime: '2026-09-04T13:59:30Z' }),
      // Before the window the bins were cut from: counted by the backend, not by the chart
      instance({ instanceId: 'd', createdTime: '2026-09-01T10:00:00Z' }),
    ];

    const { histogram } = setup([rows]);

    await histogram.load();

    const last = histogram.bins.at(-1);

    expect(last?.values).toEqual({ ProcessOrderOrchestrator: 1, OnboardTenantOrchestrator: 1 });
    expect(histogram.bins.at(-2)?.values).toEqual({ ProcessOrderOrchestrator: 1 });
    expect(histogram.scanned).toBe(4);
  });

  it('keeps the five biggest orchestrators and adds the rest up as other', async () => {
    // Seven orchestrators of decreasing size, so the ranking is by count and not by name
    const rows = [
      ...named(['one'], 6),
      ...named(['two'], 5),
      ...named(['three'], 4),
      ...named(['four'], 3),
      ...named(['five'], 2),
      ...named(['six', 'seven'], 1),
    ];

    const { histogram } = setup([rows]);

    await histogram.load();

    expect(histogram.series.map((series) => series.key)).toEqual(['one', 'two', 'three', 'four', 'five', OTHER_SERIES]);
    expect(histogram.series.map((series) => series.color)).toEqual([
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
      'muted',
    ]);

    // 'six' and 'seven' are one instance each, and they are counted together
    const other = histogram.bins.reduce((sum, bin) => sum + (bin.values[OTHER_SERIES] ?? 0), 0);
    expect(other).toBe(2);
  });

  it('zooms to the brushed window rounded to whole seconds, and puts the range back', async () => {
    const { app, histogram } = setup([[]]);

    await histogram.load();

    expect(app.timeRange).toEqual({ preset: '24h' });

    histogram.zoom({ from: new Date('2026-09-04T10:00:00.400Z'), to: new Date('2026-09-04T11:00:00.100Z') });

    expect(app.timeRange).toEqual({ from: '2026-09-04T10:00:00.000Z', to: '2026-09-04T11:00:01.000Z' });
    expect(new URLSearchParams(window.location.search).get('from')).toBe('2026-09-04T10:00:00.000Z');
    expect(histogram.zoomedIn).toBe(true);

    // A second brush still goes back to where the user was before the first one
    histogram.zoom({ from: new Date('2026-09-04T10:30:00Z'), to: new Date('2026-09-04T10:45:00Z') });
    histogram.resetZoom();

    expect(app.timeRange).toEqual({ preset: '24h' });
    expect(histogram.zoomedIn).toBe(false);
  });

  it('toasts a failure with a retry', async () => {
    const { app, histogram } = setup([[]]);

    app.endpoints.listOrchestrations = async () => {
      throw new Error('502 Bad Gateway');
    };

    await histogram.load();

    expect(histogram.error).toBe('502 Bad Gateway');
    expect(app.toast.current?.message).toBe('Load failed. 502 Bad Gateway');
    expect(app.toast.current?.retry).toBeTypeOf('function');
  });
});
