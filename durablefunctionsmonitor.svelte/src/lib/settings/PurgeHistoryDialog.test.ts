// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '$lib/api/types';
import type { Endpoints } from '$lib/api/endpoints';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import PurgeHistoryDialog from './PurgeHistoryDialog.svelte';

function mount(options: { endpoints?: Partial<Endpoints>; capabilities?: Partial<Capabilities> } = {}) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: PurgeHistoryDialog,
      path: '/DurableFunctionsHub/settings',
      capabilities: options.capabilities ?? {},
      endpoints: options.endpoints ?? {},
      props: { open: true },
    },
  });

  return {
    ...rendered,
    app: (rendered.component as unknown as { appState: () => AppState }).appState(),
  };
}

/** The check row of one runtime status, by the chip it carries. */
function statusRow(dialog: HTMLElement, status: string): HTMLElement {
  const rows = Array.from(dialog.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
  const row = rows.find((candidate) => candidate.querySelector('.chip')?.textContent?.trim() === status);

  expect(row, `no check row for ${status}`).toBeDefined();

  return row as HTMLElement;
}

async function openDialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: 'Purge instance history' });
}

describe('Purge history dialog', () => {
  it('is the dialog of the mockup: the band, the range, the four statuses and the entity check', async () => {
    mount();

    const dialog = await openDialog();

    expect(dialog.querySelector('.warn')).not.toBeNull();
    expect(dialog.textContent).toContain(
      'Removes history for every instance matching the filter. This cannot be undone.',
    );

    expect(within(dialog).getByLabelText('Created from')).toHaveClass('input', 'mono');
    expect(within(dialog).getByLabelText('Created till')).toHaveClass('input', 'mono');

    const statuses = Array.from(dialog.querySelectorAll('[role="checkbox"] .chip')).map((chip) =>
      chip.textContent?.trim(),
    );

    expect(statuses).toEqual(['Completed', 'Terminated', 'Failed', 'Canceled']);

    // The default of mockup L130: everything but Failed
    expect(statusRow(dialog, 'Completed').getAttribute('aria-checked')).toBe('true');
    expect(statusRow(dialog, 'Failed').getAttribute('aria-checked')).toBe('false');

    // A count above the button would be a number this app made up: the backend cannot count
    // without purging, so there is none
    expect(dialog.textContent).not.toContain('instances match');

    expect(within(dialog).getByRole('button', { name: 'Purge' })).toHaveClass('destructive');
  });

  it('cannot purge when no status is checked', async () => {
    mount();

    const dialog = await openDialog();

    for (const status of ['Completed', 'Terminated', 'Canceled']) {
      await fireEvent.click(statusRow(dialog, status));
    }

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Purge' })).toBeDisabled());

    await fireEvent.click(statusRow(dialog, 'Failed'));

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Purge' })).toBeEnabled());
  });

  it('offers durable entities only where the backend supports them', async () => {
    const unsupported = mount();

    const entities = within(await openDialog()).getByRole('checkbox', { name: 'Include durable entities' });

    expect(entities).toBeDisabled();
    expect(entities).toHaveAttribute('title', 'Not supported by this backend');

    unsupported.unmount();

    mount({ capabilities: { purgeEntities: true } });

    const supported = within(await openDialog()).getByRole('checkbox', { name: 'Include durable entities' });

    expect(supported).toBeEnabled();
    expect(supported).not.toHaveAttribute('title');
  });

  it('purges, and stays open holding the count of what it removed', async () => {
    const purgeHistory = vi.fn<Endpoints['purgeHistory']>(async () => ({ instancesDeleted: 412 }));
    const { app } = mount({ endpoints: { purgeHistory } });

    const dialog = await openDialog();

    await fireEvent.click(statusRow(dialog, 'Failed'));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Purge' }));

    await waitFor(() => expect(purgeHistory).toHaveBeenCalledOnce());

    const request = purgeHistory.mock.calls[0][0];

    expect(request.statuses).toEqual(['Completed', 'Terminated', 'Failed', 'Canceled']);
    expect(request.entityType).toBe('Orchestration');
    expect(new Date(request.timeTill).getTime() - new Date(request.timeFrom).getTime()).toBe(24 * 3600_000);

    await waitFor(() => expect(dialog.textContent).toContain('Purged 412 instances'));

    expect(app.toast.current?.message).toBe('Purged 412 instances');

    // React showed the count inside the dialog and left the closing to the user
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('says why a purge failed and keeps what was filled in', async () => {
    const { app } = mount({
      endpoints: {
        purgeHistory: async () => {
          throw new Error('500 Internal Server Error');
        },
      },
    });

    const dialog = await openDialog();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Purge' }));

    await waitFor(() => expect(app.toast.current?.kind).toBe('error'));
    expect(app.toast.current?.message).toBe('Failed to purge history. 500 Internal Server Error');

    expect(statusRow(dialog, 'Completed').getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
