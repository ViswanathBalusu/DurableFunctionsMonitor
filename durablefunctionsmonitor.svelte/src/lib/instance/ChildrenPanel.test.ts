// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChildrenResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import ChildrenPanel, { NO_CHILDREN } from './ChildrenPanel.svelte';
import { children as childrenFixture } from '../../../tests/unit/fixtures/children';

const INSTANCE_ID = 'order-2026-09-04-000913';

function mount(response: ChildrenResponse = childrenFixture()) {
  const rendered = render(WorkspaceHarness, {
    props: {
      // The harness hands every component an `instance`; this panel is given the answer instead
      component: ChildrenPanel as unknown as Component<{ instance: InstanceState }>,
      instanceId: INSTANCE_ID,
      load: false,
      props: { response },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function rows(): { name: string; status: string }[] {
  return Array.from(document.querySelectorAll('.row')).map((row) => ({
    name: row.querySelector('.link')?.textContent?.trim() ?? '',
    status: row.querySelector('.chip')?.textContent?.trim() ?? '',
  }));
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

describe('ChildrenPanel', () => {
  it('lists what the instance started, with the status each is in', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Children', level: 3 })).toBeInTheDocument();

    expect(rows()).toEqual([
      { name: 'NotifyCustomer', status: 'Running' },
      { name: 'ArchiveOrder', status: 'Completed' },
    ]);

    expect(document.querySelector('.chip.st-running')).toHaveClass('sm');
  });

  it('says whether the backend could find all of them', () => {
    mount();

    // Azure Storage matches the ids the runtime generates, so what it finds is a lower bound
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('/children · partial');

    mount(childrenFixture({ complete: true }));

    expect(document.querySelectorAll('.panel-h .fine.muted')[1].textContent).toBe('/children · complete');
  });

  it('opens the child that was clicked, and can be opened in a new tab', async () => {
    const { app } = mount();

    const link = screen.getByRole('link', { name: 'NotifyCustomer' });

    // The name is what is read; the id is where it goes
    expect(link).toHaveAttribute('href', '/DurableFunctionsHub/instances/order-2026-09-04-000913%3A0');
    expect(link).toHaveAttribute('title', 'order-2026-09-04-000913:0');
    expect(link).toHaveClass('link', 'mono');

    await fireEvent.click(link);

    expect(app.router.current).toMatchObject({ name: 'instance', instanceId: 'order-2026-09-04-000913:0' });
  });

  it('says it looked when there was nothing to find', () => {
    mount(childrenFixture({ children: [], complete: true }));

    expect(screen.getByText(NO_CHILDREN)).toHaveClass('meta');
    expect(rows()).toEqual([]);
  });
});
