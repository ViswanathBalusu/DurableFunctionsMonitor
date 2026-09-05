// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { OrchestrationStatus, OrchestrationsQuery } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instance } from '../../../tests/unit/fixtures/instances';

/** Inside the last few bins of whatever 24 hours the test runs in. */
function recent(): OrchestrationStatus[] {
  const now = Date.now();

  return [
    instance({ instanceId: 'a', createdTime: new Date(now - 60_000).toISOString() }),
    instance({ instanceId: 'b', createdTime: new Date(now - 2 * 60_000).toISOString() }),
    instance({
      instanceId: 'c',
      name: 'OnboardTenantOrchestrator',
      createdTime: new Date(now - 3 * 60_000).toISOString(),
    }),
  ];
}

function mount(rows: OrchestrationStatus[] = recent()) {
  const queries: OrchestrationsQuery[] = [];

  const rendered = render(ScreenHarness, {
    props: {
      screen: Instances,
      path: '/DurableFunctionsHub/instances?view=histogram',
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          queries.push(query);
          return rows;
        },
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app, queries };
}

describe('HistogramView', () => {
  it('stacks the counts by orchestrator inside the frame', async () => {
    mount();

    const chart = await screen.findByRole('group', { name: 'Instances per 30 min by orchestrator' });

    // One rect per series that has anything in its bin: two orchestrators, three instances
    await waitFor(() => expect(chart.querySelectorAll('svg > rect').length).toBeGreaterThan(0));

    const legend = chart.querySelector('.legend');
    expect(legend?.textContent).toContain('ProcessOrderOrchestrator');
    expect(legend?.textContent).toContain('OnboardTenantOrchestrator');
    expect(legend?.textContent).toContain('brush narrows the time filter');

    expect(chart.closest('.brutal-flat')?.getAttribute('style')).toContain('border-top:0');
  });

  it('says how many instances it has counted', async () => {
    mount();

    await waitFor(() => expect(screen.getByText('3 instances scanned')).toBeInTheDocument());

    // Nothing to reset: the range has not been zoomed into
    expect(screen.queryByRole('button', { name: 'Reset zoom' })).toBeNull();
  });

  it('walks the whole filtered list rather than the page the table shows', async () => {
    const { queries } = mount();

    await waitFor(() => expect(queries.some((query) => query.top === 1000)).toBe(true));

    const walk = queries.find((query) => query.top === 1000);

    expect(walk?.skip).toBe(0);
    expect(walk?.filter).toContain('runtimeStatus in (');
  });

  it('recounts when a filter changes', async () => {
    const { queries } = mount();

    await waitFor(() => expect(queries.filter((query) => query.top === 1000)).toHaveLength(1));

    await fireEvent.click(screen.getByRole('button', { name: '+ include entities' }));

    await waitFor(() => expect(queries.filter((query) => query.top === 1000)).toHaveLength(2));
    expect(queries.filter((query) => query.top === 1000)[1].filter).toContain("'DurableEntities')");
  });
});
