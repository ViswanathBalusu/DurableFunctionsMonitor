// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestrationsQuery } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { page } from '../../../tests/unit/fixtures/instances';

/** The whole screen: the menu saves what the screen is filtered by, so the screen is the unit. */
function mount(options: { path?: string; onQuery?: (q: OrchestrationsQuery) => void } = {}) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Instances,
      path: options.path ?? '/DurableFunctionsHub/instances',
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          options.onQuery?.(query);
          return page(3);
        },
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

async function openMenu(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Saved views' }));
  await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
}

/** Opens the menu, saves the current view under the prefilled name, and gives that name back. */
async function saveCurrentView(): Promise<string> {
  await openMenu();
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Save current view…' }));

  const field = (await screen.findByLabelText('Name')) as HTMLInputElement;
  const name = field.value;

  await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());

  return name;
}

describe('SavedViewsMenu', () => {
  it('ships no views of its own, only a way to save one', async () => {
    mount();

    await openMenu();

    expect(screen.getByText('Nothing saved yet')).toBeInTheDocument();
    expect(document.querySelectorAll('.pop .mi')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Save current view…' })).toBeInTheDocument();
  });

  it('names the view after the statuses and the range, and says where it was saved', async () => {
    const { app } = mount({ path: '/DurableFunctionsHub/instances?status=Failed,Terminated&range=7d' });

    const name = await saveCurrentView();

    expect(name).toBe('Failed, Terminated · Last 7 days');
    expect(app.prefs.savedViews).toHaveLength(1);
    expect(app.toast.current?.message).toBe('Saved view "Failed, Terminated · Last 7 days" to this browser');

    // The whole view, the time range included: a saved view keeps the range it was saved with
    expect(app.prefs.savedViews[0].url.startsWith('/DurableFunctionsHub/instances?')).toBe(true);

    const saved = new URLSearchParams(app.prefs.savedViews[0].url.split('?')[1]);
    expect(saved.get('status')).toBe('Failed,Terminated');
    expect(saved.get('range')).toBe('7d');
  });

  it('pins the range even when it is the default one', async () => {
    const { app } = mount();

    await saveCurrentView();

    expect(new URLSearchParams(app.prefs.savedViews[0].url.split('?')[1]).get('range')).toBe('24h');
  });

  it('restores statuses, names, the free filter and the range', async () => {
    const onQuery = vi.fn();
    const { app } = mount({
      path: '/DurableFunctionsHub/instances?status=Failed&name=ProcessOrderOrchestrator&col=instanceId&op=StartsWith&val=order-2026&range=7d',
      onQuery,
    });

    const name = await saveCurrentView();

    // Away from it: no filters at all, and another range
    await fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    app.setTimeRange({ preset: '15m' });

    // Cleared means every status, which is the eight-status list (contracts §6), not no list at all
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].filter).not.toContain("in ('Failed')"));

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name }));

    await waitFor(() => expect(app.timeRange).toEqual({ preset: '7d' }));

    const filter = onQuery.mock.calls.at(-1)?.[0].filter ?? '';
    expect(filter).toContain("runtimeStatus in ('Failed')");
    expect(filter).toContain("name in ('ProcessOrderOrchestrator')");
    expect(filter).toContain("startswith(instanceId, 'order-2026')");
    expect(screen.getByRole('button', { name: 'Remove Failed filter' })).toBeInTheDocument();
  });

  it('reloads the list once when a view is opened', async () => {
    const onQuery = vi.fn();
    const { app } = mount({ path: '/DurableFunctionsHub/instances?status=Failed&range=7d', onQuery });

    const name = await saveCurrentView();

    app.setTimeRange({ preset: '15m' });
    await waitFor(() => expect(app.timeRange).toEqual({ preset: '15m' }));

    const before = onQuery.mock.calls.length;

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name }));

    await waitFor(() => expect(app.timeRange).toEqual({ preset: '7d' }));
    await waitFor(() => expect(onQuery.mock.calls.length).toBe(before + 1));
  });

  it('asks before it removes a view, and keeps it when the answer is no', async () => {
    const { app } = mount();

    const name = await saveCurrentView();

    await openMenu();
    await fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));

    expect(screen.getByText(`Remove “${name}”?`)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(app.prefs.savedViews).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(app.prefs.savedViews).toHaveLength(0));
    expect(screen.getByText('Nothing saved yet')).toBeInTheDocument();
  });

  it('saves over a view whose name is taken, rather than listing it twice', async () => {
    const { app } = mount({ path: '/DurableFunctionsHub/instances?status=Failed&range=7d' });

    const name = await saveCurrentView();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Failed filter' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Failed filter' })).toBeNull());

    // The statuses are gone, so the view is now a different one - saved under the same name
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Save current view…' }));

    const field = await screen.findByLabelText('Name');
    await fireEvent.input(field, { target: { value: name } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(app.prefs.savedViews).toHaveLength(1));
    expect(new URLSearchParams(app.prefs.savedViews[0].url.split('?')[1]).get('status')).toBeNull();
  });
});
