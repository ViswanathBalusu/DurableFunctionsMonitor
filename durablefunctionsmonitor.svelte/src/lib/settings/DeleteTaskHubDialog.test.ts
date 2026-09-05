// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import DeleteTaskHubDialog, { DELETE_TASK_HUB_VSCODE_NOTE } from './DeleteTaskHubDialog.svelte';

const HUB = 'DurableFunctionsHub';

function mount(endpoints: Partial<Endpoints> = {}, inVsCode = false) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: DeleteTaskHubDialog,
      path: `/${HUB}/settings`,
      endpoints,
      host: inVsCode ? { kind: 'vscode' as const } : {},
      props: { open: true },
    },
  });

  return {
    ...rendered,
    app: (rendered.component as unknown as { appState: () => AppState }).appState(),
  };
}

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: `Delete task hub ${HUB}` });
}

describe('Delete task hub dialog', () => {
  it('says what it drops, and asks for the name', async () => {
    mount();

    const panel = await dialog();

    expect(panel.querySelector('.warn')).not.toBeNull();
    expect(panel.textContent).toContain(
      'Drops the Instances, History and Partitions tables, all control and work-item queues and the large-message container. Running orchestrations are lost.',
    );

    const field = within(panel).getByLabelText('Type the task hub name to confirm') as HTMLInputElement;

    expect(field.placeholder).toBe(HUB);
    expect(field).toHaveClass('mono');
    expect(field.value).toBe('');
  });

  it('enables the confirm only on an exact match', async () => {
    mount();

    const panel = await dialog();
    const field = within(panel).getByLabelText('Type the task hub name to confirm');
    const confirm = within(panel).getByRole('button', { name: 'Delete task hub' });

    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass('destructive');

    await fireEvent.input(field, { target: { value: 'durablefunctionshub' } });
    await waitFor(() => expect(confirm).toBeDisabled());

    await fireEvent.input(field, { target: { value: `${HUB}x` } });
    await waitFor(() => expect(confirm).toBeDisabled());

    // Surrounding space is a typo, not a different hub
    await fireEvent.input(field, { target: { value: ` ${HUB} ` } });
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it('deletes the hub and goes back to the login screen', async () => {
    const deleteTaskHub = vi.fn<Endpoints['deleteTaskHub']>(async () => {});
    const { app } = mount({ deleteTaskHub });

    const panel = await dialog();

    await fireEvent.input(within(panel).getByLabelText('Type the task hub name to confirm'), {
      target: { value: HUB },
    });

    await fireEvent.click(within(panel).getByRole('button', { name: 'Delete task hub' }));

    await waitFor(() => expect(deleteTaskHub).toHaveBeenCalledOnce());
    await waitFor(() => expect(app.toast.current?.message).toBe(`Deleted task hub ${HUB}`));

    expect(app.router.current.name).toBe('login');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Delete task hub ${HUB}` })).toBeNull());
  });

  it('says why the hub is still there when the delete failed', async () => {
    const { app } = mount({
      deleteTaskHub: async () => {
        throw new Error('403 Forbidden');
      },
    });

    const panel = await dialog();

    await fireEvent.input(within(panel).getByLabelText('Type the task hub name to confirm'), {
      target: { value: HUB },
    });

    await fireEvent.click(within(panel).getByRole('button', { name: 'Delete task hub' }));

    await waitFor(() => expect(app.toast.current?.message).toBe('Failed to delete task hub. 403 Forbidden'));

    expect(app.router.current.name).not.toBe('login');
    expect(await dialog()).toBeInTheDocument();
  });

  it('has nowhere to navigate inside the webview, so it says the hub is gone', async () => {
    const deleteTaskHub = vi.fn<Endpoints['deleteTaskHub']>(async () => {});
    const { app } = mount({ deleteTaskHub }, true);

    const panel = await dialog();

    await fireEvent.input(within(panel).getByLabelText('Type the task hub name to confirm'), {
      target: { value: HUB },
    });

    await fireEvent.click(within(panel).getByRole('button', { name: 'Delete task hub' }));

    await waitFor(() => expect(deleteTaskHub).toHaveBeenCalledOnce());
    await waitFor(() => expect(panel.textContent).toContain(DELETE_TASK_HUB_VSCODE_NOTE));

    expect(app.router.current.name).not.toBe('login');

    // Nothing left to delete: the field and the confirm are spent
    expect(within(panel).getByRole('button', { name: 'Delete task hub' })).toBeDisabled();
    expect(within(panel).getByLabelText('Type the task hub name to confirm')).toBeDisabled();
  });
});
