// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { StartNewInstanceRequest } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import type { StartInstance } from '$lib/state/start-instance.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instances as fixtures } from '../../../tests/unit/fixtures/instances';

function mount(
  options: {
    path?: string;
    readOnly?: boolean;
    startNewInstance?: (req: StartNewInstanceRequest) => Promise<{ instanceId: string }>;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Instances,
      path: options.path ?? '/DurableFunctionsHub/instances',
      readOnly: options.readOnly ?? false,
      endpoints: {
        listOrchestrations: async () => fixtures,
        startNewInstance: options.startNewInstance ?? (async () => ({ instanceId: 'generated-id' })),
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  /** The dialog registers itself on the app, which is how other screens open it (contracts §7). */
  const start = () => app.dialogs.startNewInstance as unknown as StartInstance;

  return { ...rendered, app, start };
}

function dialog(): HTMLElement | null {
  return document.querySelector('.dialog');
}

async function openStart(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Start new instance' }));
  await waitFor(() => expect(dialog()).not.toBeNull());
}

describe('StartNewInstanceDialog', () => {
  it('opens from the title row with the three fields of the mockup', async () => {
    mount();

    await openStart();

    expect(screen.getByText('Start new instance', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByLabelText('Orchestrator')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Leave empty for a generated GUID')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Input (JSON)' })).toBeInTheDocument();
    expect(document.querySelector('.ed .foot')?.textContent).toContain('text mode · JSON valid');
    expect(document.querySelector('.ed .foot .meter')).not.toBeNull();
  });

  it('will not start without an orchestrator, and will not start invalid JSON', async () => {
    const { start } = mount();

    await openStart();

    const startButton = screen.getByRole('button', { name: 'Start' });
    expect(startButton).toBeDisabled();

    start().orchestrator = 'ProcessOrderOrchestrator';
    await waitFor(() => expect(startButton).toBeEnabled());

    start().inputText = '{ "orderId": ';
    await waitFor(() => expect(document.querySelector('.ed .foot')?.textContent).toContain('JSON invalid'));
    expect(startButton).toBeDisabled();

    start().inputText = '{ "orderId": "A-1044" }';
    await waitFor(() => expect(startButton).toBeEnabled());
  });

  it('posts what was filled in, says what was started and refreshes', async () => {
    const startNewInstance = vi.fn(async () => ({ instanceId: 'order-2026-09-04-000914' }));
    const { app, start } = mount({ startNewInstance });

    await openStart();

    start().orchestrator = 'ProcessOrderOrchestrator';
    start().inputText = '{ "orderId": "A-1044" }';

    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(startNewInstance).toHaveBeenCalledOnce());

    // No id typed: the backend generates one, so the field is left out rather than sent empty
    expect(startNewInstance.mock.calls[0][0] as unknown as StartNewInstanceRequest).toEqual({
      id: undefined,
      name: 'ProcessOrderOrchestrator',
      data: { orderId: 'A-1044' },
    });

    await waitFor(() => expect(dialog()).toBeNull());
    expect(app.toast.current?.message).toBe('Started order-2026-09-04-000914 · ProcessOrderOrchestrator');
  });

  it('sends the id that was typed, and an empty input as null', async () => {
    const startNewInstance = vi.fn(async () => ({ instanceId: 'my-own-id' }));
    const { start } = mount({ startNewInstance });

    await openStart();

    start().orchestrator = 'ProcessOrderOrchestrator';

    await fireEvent.input(screen.getByPlaceholderText('Leave empty for a generated GUID'), {
      target: { value: 'my-own-id' },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(startNewInstance).toHaveBeenCalledOnce());
    expect(startNewInstance.mock.calls[0][0] as unknown as StartNewInstanceRequest).toEqual({
      id: 'my-own-id',
      name: 'ProcessOrderOrchestrator',
      data: null,
    });
  });

  it('keeps the dialog open when the backend refuses, and says why', async () => {
    const { app, start } = mount({
      startNewInstance: async () => {
        throw new Error('409 Conflict: an instance with this id already exists');
      },
    });

    await openStart();

    start().orchestrator = 'ProcessOrderOrchestrator';

    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(app.toast.current?.message).toBe(
        'Failed to start new instance. 409 Conflict: an instance with this id already exists',
      ),
    );

    expect(dialog()).not.toBeNull();
    expect(start().orchestrator).toBe('ProcessOrderOrchestrator');
  });

  it('opens itself from ?start=1, and takes the flag off the URL', async () => {
    mount({ path: '/DurableFunctionsHub/instances?start=1' });

    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(new URLSearchParams(window.location.search).get('start')).toBeNull();
  });

  it('is not offered at all in a read-only hub', async () => {
    mount({ readOnly: true });

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Start new instance' })[0]).toBeDisabled());
    expect(dialog()).toBeNull();
  });
});
