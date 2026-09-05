// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '$lib/api/client';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instances as fixtures } from '../../../tests/unit/fixtures/instances';

function mount(postAction: (instanceId: string, action: string, body?: unknown) => Promise<void>) {
  const loads = vi.fn();

  const rendered = render(ScreenHarness, {
    props: {
      screen: Instances,
      endpoints: {
        listOrchestrations: async () => {
          loads();
          return fixtures;
        },
        postAction,
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app, loads };
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('table.tbl tbody tr'));
}

function dialog(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

/** Selects the first two rows and confirms a Terminate over them. */
async function terminateTwo(): Promise<void> {
  await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

  await fireEvent.click(rows()[0].querySelector('.sel-cell .box') as HTMLElement);
  await fireEvent.click(rows()[1].querySelector('.sel-cell .box') as HTMLElement);

  await fireEvent.click(screen.getByRole('button', { name: 'Terminate' }));
  await waitFor(() => expect(dialog()).not.toBeNull());

  await fireEvent.click(within(dialog()).getByRole('button', { name: 'Terminate 2 instances' }));
}

describe('the bulk runner behind the confirm', () => {
  it('acts on every selected id, says so, and reloads the list', async () => {
    const postAction = vi.fn(async () => {});
    const { app, loads } = mount(postAction);

    await terminateTwo();

    await waitFor(() => expect(postAction).toHaveBeenCalledTimes(2));

    expect(postAction.mock.calls.map((call) => (call as unknown as string[])[0])).toEqual([
      'order-2026-09-04-000913',
      'order-2026-09-04-000912',
    ]);

    await waitFor(() => expect(app.toast.current?.message).toBe('Terminate 2 instances · 2 ok, 0 failed'));
    expect(app.toast.current?.kind).toBe('ok');

    // The selection is spent, the confirm is gone, and the list is loaded again
    await waitFor(() => expect(document.querySelector('.bulk')).toBeNull());
    expect(document.querySelector('.dialog')).toBeNull();
    await waitFor(() => expect(loads.mock.calls.length).toBeGreaterThan(1));
  });

  it('lists what failed, and only then', async () => {
    const postAction = vi.fn(async (instanceId: string) => {
      if (instanceId === 'order-2026-09-04-000912') {
        throw new ConflictError('409 Conflict: instance is not running');
      }
    });

    const { app } = mount(postAction);

    await terminateTwo();

    await waitFor(() => expect(app.toast.current?.message).toBe('Terminate 2 instances · 1 ok, 1 failed'));
    expect(app.toast.current?.kind).toBe('error');

    const result = await screen.findByRole('dialog', { name: 'Terminate 2 instances' });

    expect(within(result).getByText('1 ok, 1 failed')).toBeInTheDocument();

    // Failures first, with the status the backend answered and its message
    const failed = result.querySelectorAll('table.tbl tbody tr')[0];

    expect(failed.textContent).toContain('order-2026-09-04-000912');
    expect(failed.textContent).toContain('409');
    expect(failed.textContent).toContain('instance is not running');

    await fireEvent.click(within(result).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terminate 2 instances' })).toBeNull());
  });
});
