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
import { InstancesTimeline, TIMELINE_TOP, laneLabel, orderLanes, tickLabels } from './instances-timeline.svelte';
import { Instances, type InstancesViewState } from './instances.svelte';
import { Prefs } from './prefs.svelte';
import { entityInstances, instances as fixtures } from '../../../tests/unit/fixtures/instances';

/** The moment the mockup was drawn at, so the domain is fixed and the percentages are checkable. */
const NOW = new Date('2026-09-04T14:03:00.000Z').getTime();

const noStorage: ITypedLocalStorage<InstancesViewState> = {
  getItem: () => null,
  setItem: () => {},
  setItems: () => {},
  removeItem: () => {},
};

/** As the backend answers `$orderby=createdTime asc`. */
function byCreated(rows: OrchestrationStatus[]): OrchestrationStatus[] {
  return [...rows].sort((a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime());
}

function setup(rows: OrchestrationStatus[] = byCreated(fixtures)) {
  window.history.replaceState({}, '', '/DurableFunctionsHub/instances');

  const queries: OrchestrationsQuery[] = [];

  const endpoints = {
    listOrchestrations: async (query: OrchestrationsQuery) => {
      queries.push(query);
      return rows;
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
  const timeline = new InstancesTimeline({ app, instances, now: () => NOW });

  return { app, instances, timeline, queries };
}

describe('orderLanes', () => {
  it('groups by orchestrator name in the order the names first appear', () => {
    const ordered = orderLanes(byCreated(fixtures));

    expect(ordered.map((row) => row.name)).toEqual([
      'ReconcileLedgerOrchestrator',
      'ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator',
      'OnboardTenantOrchestrator',
    ]);
  });

  it('leaves a list of one name exactly as it came, which is created ascending', () => {
    const rows = byCreated(fixtures).filter((row) => row.name === 'ProcessOrderOrchestrator');

    expect(orderLanes(rows).map((row) => row.instanceId)).toEqual(rows.map((row) => row.instanceId));
  });
});

describe('laneLabel', () => {
  it('labels an entity by its key and an orchestration by its id', () => {
    expect(laneLabel(entityInstances[0])).toBe('warehouse-07');
    expect(laneLabel(fixtures[0])).toBe('order-2026-09-04-000913');
  });
});

describe('tickLabels', () => {
  it('carries the day on the first tick and again when the day turns over', () => {
    const labels = tickLabels(
      { from: new Date('2026-09-03T23:50:00Z'), to: new Date('2026-09-04T14:03:00Z') },
      6,
      'UTC',
    );

    expect(labels[0]).toBe('Sep 3 23:50');
    expect(labels[1]).toBe('Sep 4 02:40');
    expect(labels.slice(2)).toEqual(['05:31', '08:21', '11:12', '14:03']);
  });
});

describe('InstancesTimeline', () => {
  it('asks for one page of 500 in created order, filtered as the table is', async () => {
    const { timeline, instances, queries } = setup();

    instances.statuses = ['Failed'];
    await timeline.load();

    expect(queries).toHaveLength(1);
    expect(queries[0].top).toBe(TIMELINE_TOP);
    expect(queries[0].skip).toBe(0);
    expect(queries[0].orderBy).toBe('createdTime asc');
    expect(queries[0].filter).toContain("runtimeStatus in ('Failed')");

    // The payloads are not drawn, so the backend need not send them
    expect(queries[0].hiddenColumns).toEqual(['input', 'output', 'customStatus']);
  });

  it('runs the domain from the earliest creation to the moment it loaded', async () => {
    const { timeline } = setup();

    await timeline.load();

    expect(timeline.domain.from.toISOString()).toBe('2026-09-03T02:00:00.000Z');
    expect(timeline.domain.to.getTime()).toBe(NOW);
  });

  it('draws one lane per instance, the last one carrying the now line', async () => {
    const { timeline } = setup();

    await timeline.load();

    expect(timeline.lanes).toHaveLength(9);
    expect(timeline.lanes[0].label).toBe('nightly-reconcile-20260903');
    expect(timeline.lanes.at(-1)?.now).toBe(100);
    expect(timeline.lanes.slice(0, -1).every((lane) => lane.now === undefined)).toBe(true);
  });

  it('runs a still-running bar to the right edge, and stops a finished one where it finished', async () => {
    const { timeline } = setup();

    await timeline.load();

    const running = timeline.lanes.find((lane) => lane.key === 'order-2026-09-04-000913');
    const [runningBar] = running?.bars ?? [];

    expect(runningBar.cls).toBe('st-running');
    expect(runningBar.left + runningBar.width).toBe(100);

    const completed = timeline.lanes.find((lane) => lane.key === '8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8');
    const [completedBar] = completed?.bars ?? [];

    expect(completedBar.cls).toBe('st-completed');
    expect(completedBar.left + completedBar.width).toBeLessThan(100);
  });

  it('puts the duration beside a bar too narrow to hold it', async () => {
    const { timeline } = setup();

    await timeline.load();

    // 25 seconds of a 36-hour window
    const lane = timeline.lanes.find((item) => item.key === 'order-2026-09-04-000912');

    expect(lane?.bars[0].width).toBeLessThan(6);
    expect(lane?.bars[0].text).toBeUndefined();
    expect(lane?.lbl).toBe('25 s');
    expect(lane?.lblLeft).toBeGreaterThan(lane?.bars[0].left ?? 0);
  });

  it('links every lane to its instance', async () => {
    const { timeline } = setup();

    await timeline.load();

    expect(timeline.lanes[0].href).toBe('/DurableFunctionsHub/instances/nightly-reconcile-20260903');
  });

  it('measures an entity from its creation to its last update, under its key', async () => {
    const { timeline } = setup(entityInstances);

    await timeline.load();

    expect(timeline.lanes.map((lane) => lane.label)).toEqual(['warehouse-07', 'warehouse-12']);
    expect(timeline.rowOf('@counter@warehouse-07')?.entityId?.key).toBe('warehouse-07');
  });

  it('toasts a failure with a retry and keeps the rows it had', async () => {
    const { app, timeline } = setup();

    await timeline.load();

    app.endpoints.listOrchestrations = async () => {
      throw new Error('500 Internal Server Error');
    };

    await timeline.load();

    expect(timeline.rows).toHaveLength(9);
    expect(timeline.error).toBe('500 Internal Server Error');
    expect(app.toast.current?.message).toBe('Load failed. 500 Internal Server Error');
    expect(app.toast.current?.retry).toBeTypeOf('function');
  });
});
