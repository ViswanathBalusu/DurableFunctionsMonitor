// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { OrchestrationDetails } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import InstanceActions from './InstanceActions.svelte';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture } from '../../../tests/unit/fixtures/history';

const INSTANCE_ID = 'order-2026-09-04-000913';

function mount(options: { instanceId?: string; details?: OrchestrationDetails; readOnly?: boolean } = {}) {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: InstanceActions,
      instanceId: options.instanceId ?? INSTANCE_ID,
      readOnly: options.readOnly ?? false,
      endpoints: {
        getOrchestration: async () => options.details ?? detailsFixture(),
        getHistory: async () => ({ history: historyFixture }),
      } as unknown as Endpoints,
    },
  });

  const harness = rendered.component as unknown as {
    appState: () => AppState;
    instanceState: () => InstanceState;
  };

  return { ...rendered, app: harness.appState(), instance: harness.instanceState() };
}

function labels(): string[] {
  return Array.from(document.querySelectorAll('button.btn')).map((button) => button.textContent?.trim() ?? '');
}

describe('InstanceActions', () => {
  it('offers the seven buttons of the mockup, in order', async () => {
    mount();

    await waitFor(() => expect(labels()).toHaveLength(7));

    expect(labels()).toEqual(['Suspend', 'Raise event', 'Set customStatus', 'Restart', 'Rewind', 'Terminate', 'Purge']);

    expect(screen.getByRole('button', { name: 'Terminate' })).toHaveClass('destructive');
    expect(screen.getByRole('button', { name: 'Purge' })).toHaveClass('destructive');
  });

  it('offers Resume for a suspended instance', async () => {
    mount({ details: detailsFixture({ runtimeStatus: 'Suspended' }) });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
  });

  it('enables Rewind for a failed instance and says why it is off for any other', async () => {
    const failed = mount({ details: detailsFixture({ runtimeStatus: 'Failed' }) });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rewind' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Rewind' })).toHaveAttribute('title', 'Re-run the failed steps');

    failed.unmount();

    mount({ details: detailsFixture({ runtimeStatus: 'Completed' }) });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Rewind' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Rewind' })).toHaveAttribute(
      'title',
      'Rewind is available for failed instances',
    );
  });

  it('gives an entity Send signal and Purge, and nothing else', async () => {
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

    await waitFor(() => expect(labels()).toEqual(['Send signal', 'Purge']));
  });

  it('is all dead in a read-only hub, and says so', async () => {
    mount({ readOnly: true });

    await waitFor(() => expect(labels()).toHaveLength(7));

    for (const label of labels()) {
      const button = screen.getByRole('button', { name: label });

      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Read-only mode');
    }
  });

  it('opens the confirm for what was pressed, on this instance', async () => {
    const { app, instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    await fireEvent.click(screen.getByRole('button', { name: 'Set customStatus' }));

    expect(app.actions.kind).toBe('custom');
    expect(app.actions.target).toMatchObject({
      id: INSTANCE_ID,
      name: 'ProcessOrderOrchestrator',
      status: 'Running',
      isEntity: false,
      customStatus: { step: 'ChargePayment', attempt: 2 },
    });

    // Nothing has counted the history yet, so the purge dialog is told nothing about it
    expect(app.actions.target?.historyRows).toBeNull();

    app.actions.close();

    await instance.history.load();
    await fireEvent.click(screen.getByRole('button', { name: 'Purge' }));

    await waitFor(() => expect(app.actions.target?.historyRows).toBe(historyFixture.length));
    expect(app.actions.def?.body).toContain(`its ${historyFixture.length} history rows`);
  });
});
