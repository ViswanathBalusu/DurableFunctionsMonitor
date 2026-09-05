// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import type { OrchestrationStatus, OrchestrationsQuery } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instances as fixtures } from '../../../tests/unit/fixtures/instances';

function byCreated(rows: OrchestrationStatus[]): OrchestrationStatus[] {
  return [...rows].sort((a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime());
}

function mount(options: { client?: Partial<BackendClient> } = {}) {
  /** What the timeline asked for; the table's own query is the one without an ascending order. */
  const timelineQueries: OrchestrationsQuery[] = [];

  const rendered = render(ScreenHarness, {
    props: {
      screen: Instances,
      path: '/DurableFunctionsHub/instances?view=timeline',
      client: options.client ?? {},
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          if (query.orderBy === 'createdTime asc') {
            timelineQueries.push(query);
            return byCreated(fixtures);
          }

          return fixtures;
        },
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app, timelineQueries };
}

function lanes(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.swim .lane'));
}

describe('TimelineView', () => {
  it('draws a lane per instance under the view strip', async () => {
    mount();

    await waitFor(() => expect(lanes()).toHaveLength(fixtures.length));

    expect(document.querySelector('.swim')).toHaveAttribute('aria-label', 'Instances timeline');
    expect(document.querySelector('.swim')?.getAttribute('style')).toContain('border-top: 0px');
    expect(document.querySelector('.axis .meta')?.textContent).toBe('instance');
    expect(document.querySelectorAll('.axis .ticks span')).toHaveLength(6);

    // Created ascending, so the oldest is the first lane; its bar carries its status
    expect(lanes()[0].querySelector('.lbl')?.textContent?.trim()).toBe('nightly-reconcile-20260903');
    expect(lanes()[0].querySelector('.bar')).toHaveClass('st-terminated');
    expect(lanes().at(-1)?.querySelector('.now')).not.toBeNull();
  });

  it('shows the seven statuses of the legend and offers the export', async () => {
    mount();

    await waitFor(() => expect(lanes()).toHaveLength(fixtures.length));

    expect(document.querySelectorAll('.legend span')).toHaveLength(7);
    expect(document.querySelector('.legend i')).toHaveClass('st-completed');
    expect(screen.getByRole('button', { name: 'Save as SVG' })).toBeInTheDocument();
  });

  it('opens the peek from a lane, and the workspace from its label', async () => {
    const { app } = mount();

    await waitFor(() => expect(lanes()).toHaveLength(fixtures.length));

    await fireEvent.click(lanes()[0]);

    expect(app.peek.item?.id).toBe('nightly-reconcile-20260903');
    expect(app.peek.item?.status).toBe('Terminated');

    app.peek.close();

    const link = lanes()[0].querySelector('.lbl .link') as HTMLElement;
    const click = createEvent.click(link);

    fireEvent(link, click);

    expect(click.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/nightly-reconcile-20260903');
    expect(app.peek.isOpen).toBe(false);
  });

  it('reloads its own page when a filter changes', async () => {
    const { timelineQueries } = mount();

    await waitFor(() => expect(timelineQueries).toHaveLength(1));

    await fireEvent.click(screen.getByRole('button', { name: '+ include entities' }));

    await waitFor(() => expect(timelineQueries).toHaveLength(2));
    expect(timelineQueries[1].filter).toContain("'DurableEntities')");
  });

  it('saves the picture through the host', async () => {
    const saveAs = vi.fn(async () => {});
    mount({ client: { isVsCode: true, host: { saveAs } } as unknown as Partial<BackendClient> });

    await waitFor(() => expect(lanes()).toHaveLength(fixtures.length));

    await fireEvent.click(screen.getByRole('button', { name: 'Save as SVG' }));

    await waitFor(() => expect(saveAs).toHaveBeenCalledOnce());

    const [text, fileName] = saveAs.mock.calls[0] as unknown as [string, string];

    expect(fileName).toBe('instances-gantt.svg');
    expect(text.startsWith('<svg')).toBe(true);
    expect(text).toContain('nightly-reconcile-20260903');
  });
});
