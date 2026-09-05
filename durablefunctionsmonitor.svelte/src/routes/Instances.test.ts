// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestrationStatus, OrchestrationsQuery } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from './Instances.svelte';
import { page } from '../../tests/unit/fixtures/instances';

function mount(
  options: {
    path?: string;
    rows?: OrchestrationStatus[];
    readOnly?: boolean;
    onQuery?: (q: OrchestrationsQuery) => void;
  } = {},
) {
  const rows = options.rows ?? page(3);

  return render(ScreenHarness, {
    props: {
      screen: Instances,
      path: options.path ?? '/DurableFunctionsHub/instances',
      readOnly: options.readOnly ?? false,
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          options.onQuery?.(query);
          return rows;
        },
      },
    },
  });
}

describe('Instances screen', () => {
  it('is the page of the mockup: title, match label and the Start button', async () => {
    mount();

    expect(document.querySelector('section.page[data-screen-label="Instances"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Instances', level: 1 })).toHaveClass('display');

    await waitFor(() => expect(document.querySelector('.ptitle .meta')?.textContent).toBe('3 match · Last 24 hours'));

    expect(screen.getByRole('button', { name: 'Start new instance' })).toHaveClass('primary');
  });

  it('cannot start an instance in a read-only backend', () => {
    mount({ readOnly: true });

    expect(screen.getByRole('button', { name: 'Start new instance' })).toBeDisabled();
  });

  it('loads the first page once as it opens', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());
    expect(onQuery.mock.calls[0][0]).toMatchObject({ skip: 0, top: 50 });
  });

  it('reloads when the shared time range changes, and not when a filter writes the URL', async () => {
    const onQuery = vi.fn();
    const { component } = mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    const app = (component as unknown as { appState: () => AppState }).appState();

    app.setTimeRange({ preset: '7d' });
    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));

    // A query change that is not the range leaves the list alone
    app.router.setQuery({ hidden: 'input' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onQuery).toHaveBeenCalledTimes(2);
  });

  it('reloads when anything asks the app to refresh', async () => {
    const onQuery = vi.fn();
    const { component } = mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    (component as unknown as { appState: () => AppState }).appState().refresh();

    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));
  });

  it('selects every loaded row for the batch-ops command, and takes the flag off the URL', async () => {
    const { component } = mount({ path: '/DurableFunctionsHub/instances?selectAll=1' });
    const app = (component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(app.router.current.query.get('selectAll')).toBeNull());
  });

  it('toasts a load failure with a retry rather than leaving an empty table', async () => {
    const { component } = render(ScreenHarness, {
      props: {
        screen: Instances,
        endpoints: {
          listOrchestrations: async () => {
            throw new Error('503 Service Unavailable');
          },
        },
      },
    });

    const app = (component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(app.toast.current?.message).toBe('Load failed. 503 Service Unavailable'));
    expect(app.toast.current?.retry).toBeTypeOf('function');

    // And the empty state does not claim that nothing matched
    expect(screen.queryByRole('heading', { name: 'No orchestrations' })).toBeNull();
  });
});
