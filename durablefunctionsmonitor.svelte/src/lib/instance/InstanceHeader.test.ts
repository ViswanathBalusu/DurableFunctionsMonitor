// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { OrchestrationDetails } from '$lib/api/types';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import InstanceHeader from './InstanceHeader.svelte';
import { childDetails, details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture } from '../../../tests/unit/fixtures/history';

const INSTANCE_ID = 'order-2026-09-04-000913';

/** Pinned so the running clock is a number the test can name: created 14:02:11, now 14:03:00. */
const NOW = new Date('2026-09-04T14:03:00.000Z');

function mount(
  options: {
    instanceId?: string;
    details?: OrchestrationDetails;
    history?: typeof historyFixture;
    props?: Record<string, unknown>;
  } = {},
) {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: InstanceHeader,
      instanceId: options.instanceId ?? INSTANCE_ID,
      endpoints: {
        getOrchestration: async () => options.details ?? detailsFixture(),
        getHistory: async () => ({ history: options.history ?? [] }),
      } as unknown as Endpoints,
      props: options.props ?? {},
    },
  });

  const instance = (rendered.component as unknown as { instanceState: () => InstanceState }).instanceState();

  return { ...rendered, instance };
}

function tile(): HTMLElement {
  return document.querySelector('.hero .tile') as HTMLElement;
}

function hmeta(): string {
  return document.querySelector('.hero .hmeta')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InstanceHeader', () => {
  it('draws the breadcrumb and the hero of the mockup', async () => {
    mount();

    await vi.advanceTimersByTimeAsync(0);

    // Breadcrumb: a real link to the list, the separator, and the id
    const crumb = screen.getByRole('link', { name: 'Instances' });
    expect(crumb).toHaveAttribute('href', '/DurableFunctionsHub/instances');
    expect(crumb).toHaveClass('link', 'meta');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(INSTANCE_ID);

    expect(tile()).toHaveClass('st-running');
    expect(tile().textContent).toContain('Running');
    expect(tile().querySelector('.mono')?.textContent).toBe('00:00:49');

    expect(hmeta()).toContain('ProcessOrderOrchestrator');
    expect(hmeta()).toContain('created 2026-09-04 14:02:11 UTC');
    expect(hmeta()).toContain('updated 2 s ago');
    expect(hmeta()).toContain('parent: none');
  });

  it('advances the clock of a running instance every second', async () => {
    mount();

    await vi.advanceTimersByTimeAsync(0);
    expect(tile().querySelector('.mono')?.textContent).toBe('00:00:49');

    await vi.advanceTimersByTimeAsync(2_000);

    expect(tile().querySelector('.mono')?.textContent).toBe('00:00:51');
  });

  it('holds the clock of an instance that has finished', async () => {
    mount({
      details: detailsFixture({ runtimeStatus: 'Completed', lastUpdatedTime: '2026-09-04T14:02:58Z' }),
    });

    await vi.advanceTimersByTimeAsync(0);

    // lastUpdatedTime - createdTime, and it stays there however long the screen is left open
    expect(tile().querySelector('.mono')?.textContent).toBe('00:00:47');
    expect(tile()).toHaveClass('st-completed');

    await vi.advanceTimersByTimeAsync(10_000);

    expect(tile().querySelector('.mono')?.textContent).toBe('00:00:47');
  });

  it('links to the parent instance, in the app', async () => {
    mount({ instanceId: 'order-2026-09-04-000913:0', details: childDetails() });

    await vi.advanceTimersByTimeAsync(0);

    const parent = screen.getByRole('link', { name: INSTANCE_ID });

    expect(parent).toHaveAttribute('href', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
    expect(parent).toHaveClass('mono');
  });

  it('names an entity by its entity name and has no parent line', async () => {
    mount({
      instanceId: '@counter@warehouse-07',
      details: detailsFixture({
        instanceId: '@counter@warehouse-07',
        name: 'Counter',
        entityType: 'DurableEntity',
        entityId: { name: 'counter', key: 'warehouse-07' },
        runtimeStatus: 'Pending',
      }),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(hmeta()).toContain('counter');
    expect(hmeta()).not.toContain('parent:');
    expect(tile()).toHaveClass('st-pending');
  });

  it('counts the history rows it has, and says when there are more', async () => {
    const { instance } = mount({ history: historyFixture });

    await vi.advanceTimersByTimeAsync(0);
    expect(hmeta()).toContain('history 0 rows');

    await instance.history.load();
    await waitFor(() => expect(hmeta()).toContain(`history ${historyFixture.length} rows`));

    // A full page means there is more of it: the backend reports no total (contracts §6)
    instance.history.hasMore = true;
    await waitFor(() => expect(hmeta()).toContain(`history ${historyFixture.length}+ rows`));
  });

  it('counts the whole history once /spans has counted it', async () => {
    const { instance } = mount({ history: historyFixture, props: { historyRows: 31 } });

    await vi.advanceTimersByTimeAsync(0);

    // The page the tab loaded is no longer the answer, so neither is its `+`
    instance.history.hasMore = true;
    await waitFor(() => expect(hmeta()).toContain('history 31 rows'));

    expect(hmeta()).not.toContain('+ rows');
  });

  it('shows the children only once something has counted them', async () => {
    const { unmount } = mount();

    await vi.advanceTimersByTimeAsync(0);

    // Nothing has looked for children yet, so nothing is claimed about them
    expect(hmeta()).not.toContain('children:');

    unmount();

    // E8 counts them and passes the count in; the line appears then, and links to the summary
    mount({ props: { childCount: 1 } });

    await vi.advanceTimersByTimeAsync(0);

    expect(hmeta()).toContain('children: 1');
    expect(screen.getByRole('button', { name: '1' })).toHaveClass('link', 'mono');
  });
});
