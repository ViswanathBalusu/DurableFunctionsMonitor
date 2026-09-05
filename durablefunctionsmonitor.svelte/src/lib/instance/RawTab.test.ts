// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import { formatJson } from '$lib/format/json';
import type { AppState } from '$lib/state/app.svelte';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import RawTab from './RawTab.svelte';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';

const INSTANCE_ID = 'order-2026-09-04-000913';

function mount() {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: RawTab,
      instanceId: INSTANCE_ID,
      endpoints: { getOrchestration: async () => detailsFixture() } as unknown as Endpoints,
    },
  });

  const harness = rendered.component as unknown as {
    appState: () => AppState;
    instanceState: () => InstanceState;
  };

  return { ...rendered, app: harness.appState(), instance: harness.instanceState() };
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

describe('RawTab', () => {
  it('shows the status document in the viewer, with its menu bar', async () => {
    const { instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    const viewer = screen.getByRole('group', { name: 'Instance status JSON' });

    expect(viewer).toBeInTheDocument();
    expect(document.querySelector('.brutal-flat')).not.toBeNull();

    // The menu bar is the tree/text/table switch and the search box (L229)
    await waitFor(() => expect(viewer.querySelector('.jse-menu')).not.toBeNull());
  });

  it('renders every key of the details, expanded', async () => {
    const { instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    const viewer = screen.getByRole('group', { name: 'Instance status JSON' });

    // Contracts §9: fully expanded, so the nested input is on screen without a click
    for (const key of ['instanceId', 'name', 'runtimeStatus', 'createdTime', 'input', 'tabTemplateNames', 'orderId']) {
      await waitFor(() => expect(viewer.textContent).toContain(key));
    }
  });

  it('copies exactly what is on screen, and says it did', async () => {
    const { app, instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() => expect(app.toast.current?.message).toBe('Copied the instance status JSON'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(formatJson(detailsFixture()));
  });
});
