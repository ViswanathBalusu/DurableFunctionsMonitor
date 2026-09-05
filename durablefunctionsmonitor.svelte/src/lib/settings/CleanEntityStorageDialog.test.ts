// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import CleanEntityStorageDialog from './CleanEntityStorageDialog.svelte';

function mount(endpoints: Partial<Endpoints> = {}) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: CleanEntityStorageDialog,
      path: '/DurableFunctionsHub/settings',
      endpoints,
      props: { open: true },
    },
  });

  return {
    ...rendered,
    app: (rendered.component as unknown as { appState: () => AppState }).appState(),
  };
}

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: 'Clean entity storage' });
}

describe('Clean entity storage dialog', () => {
  it('is the dialog of ScreenEntities.dc.html L68-L72, with both boxes on', async () => {
    mount();

    const panel = await dialog();

    expect(panel.querySelector('.warn')).not.toBeNull();
    expect(panel.textContent).toContain('Running orchestrations are not touched.');
    expect(panel.textContent).toContain(
      'POST /clean-entity-storage · the response says how many entities and locks were touched.',
    );

    // React's defaults, not the mockup's demo state
    for (const label of ['Remove empty entities (no state)', 'Release orphaned locks']) {
      expect(within(panel).getByRole('checkbox', { name: label })).toHaveAttribute('aria-checked', 'true');
    }

    expect(within(panel).getByRole('button', { name: 'Clean entity storage' })).toHaveClass('destructive');
  });

  it('sends what is checked and says what the backend touched', async () => {
    const cleanEntityStorage = vi.fn<Endpoints['cleanEntityStorage']>(async () => ({
      numberOfEmptyEntitiesRemoved: 7,
      numberOfOrphanedLocksRemoved: 0,
    }));

    const { app } = mount({ cleanEntityStorage });
    const refresh = vi.spyOn(app, 'refresh');

    const panel = await dialog();

    await fireEvent.click(within(panel).getByRole('checkbox', { name: 'Release orphaned locks' }));
    await fireEvent.click(within(panel).getByRole('button', { name: 'Clean entity storage' }));

    await waitFor(() => expect(cleanEntityStorage).toHaveBeenCalledOnce());

    expect(cleanEntityStorage.mock.calls[0][0]).toEqual({ removeEmptyEntities: true, releaseOrphanedLocks: false });

    await waitFor(() =>
      expect(app.toast.current?.message).toBe('Cleaned entity storage: 7 empty entities removed, 0 locks released'),
    );

    expect(refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Clean entity storage' })).toBeNull());
  });

  it('will not send a clean that would do neither of the two things it can do', async () => {
    const cleanEntityStorage = vi.fn<Endpoints['cleanEntityStorage']>(async () => ({
      numberOfEmptyEntitiesRemoved: 0,
      numberOfOrphanedLocksRemoved: 0,
    }));

    mount({ cleanEntityStorage });

    const panel = await dialog();

    await fireEvent.click(within(panel).getByRole('checkbox', { name: 'Remove empty entities (no state)' }));
    await fireEvent.click(within(panel).getByRole('checkbox', { name: 'Release orphaned locks' }));

    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Clean entity storage' })).toBeDisabled());
    expect(cleanEntityStorage).not.toHaveBeenCalled();
  });

  it('stays open and says why when the clean fails', async () => {
    const { app } = mount({
      cleanEntityStorage: async () => {
        throw new Error('400 Not supported');
      },
    });

    const panel = await dialog();

    await fireEvent.click(within(panel).getByRole('button', { name: 'Clean entity storage' }));

    await waitFor(() => expect(app.toast.current?.kind).toBe('error'));
    expect(app.toast.current?.message).toBe('Failed to clean entity storage. 400 Not supported');
    expect(await dialog()).toBeInTheDocument();
  });
});
