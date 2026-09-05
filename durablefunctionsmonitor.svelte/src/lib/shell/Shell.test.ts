// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { FailuresQuery } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

describe('Shell', () => {
  it('renders the two-column frame with the content area', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    const shell = document.querySelector('.shell');
    expect(shell).not.toBeNull();
    expect(shell).not.toHaveClass('collapsed');
    expect(document.querySelector('.shell > .main > main.content#main')).not.toBeNull();
  });

  it('collapses when the preference says so, which is all the CSS needs', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', navCollapsed: true } });

    expect(document.querySelector('.shell')).toHaveClass('collapsed');
  });

  it('shows the loading bar only while something is in flight', async () => {
    const { component } = render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(screen.queryByRole('progressbar')).toBeNull();

    (component as unknown as { begin: () => void }).begin();

    expect(await screen.findByRole('progressbar', { name: 'Loading' })).toHaveClass('progress');
  });

  it('installs the keyboard map for as long as it is on screen', async () => {
    const onOpenPalette = vi.fn();
    const { unmount } = render(ShellHarness, { props: { path: '/DurableFunctionsHub', onOpenPalette } });

    await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(onOpenPalette).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.querySelector('.palette')).not.toBeNull());

    // While the palette is up the rest of the map is inert, so it is closed again first
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.palette')).toBeNull());

    await fireEvent.keyDown(window, { key: '/' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Find instance' })));

    unmount();
    await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});

describe('Outlet', () => {
  it.each([
    ['/DurableFunctionsHub', 'Overview'],
    ['/DurableFunctionsHub/instances', 'Instances'],
    // The workspace is titled by the instance it has open, not by the word "Instance"
    ['/DurableFunctionsHub/instances/order-1', 'order-1'],
    ['/DurableFunctionsHub/failures', 'Failures'],
    ['/DurableFunctionsHub/entities', 'Entities'],
    ['/DurableFunctionsHub/functions', 'Functions'],
    ['/DurableFunctionsHub/storage', 'Storage'],
    ['/DurableFunctionsHub/activity', 'Activity'],
    ['/DurableFunctionsHub/settings', 'Settings'],
  ])('renders %s as the %s screen', (path, title) => {
    render(ShellHarness, { props: { path } });

    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
  });

  it('follows a route change', async () => {
    const { component } = render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();

    (component as unknown as { go: (name: string) => void }).go('failures');

    expect(await screen.findByRole('heading', { name: 'Failures', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview', level: 1 })).toBeNull();
  });

  it('drops the refresh handlers of the screen it leaves', async () => {
    const { component } = render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });
    const harness = component as unknown as { appState: () => AppState; go: (name: string) => void };

    const load = vi.fn();
    harness.appState().onRefresh(load);

    harness.go('entities');
    await screen.findByRole('heading', { name: 'Entities', level: 1 });

    harness.appState().refresh();

    expect(load).not.toHaveBeenCalled();
  });

  it('rewrites a legacy instance path to the canonical one', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub/durable-instances/order-1' } });

    // Decision D8: the alias resolves to the instance route, and the URL is rewritten to match
    expect(screen.getByRole('heading', { name: 'order-1', level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-1');
  });
});

/**
 * The Failures badge (E9-S1-T1). The shell keeps it current for every screen but the Failures
 * screen, which sets it from the load it makes anyway.
 */
describe('Shell failures badge', () => {
  function shellWith(path: string, capabilities: Record<string, boolean> = { failures: true }) {
    const queries: FailuresQuery[] = [];

    const rendered = render(ShellHarness, {
      props: {
        path,
        capabilities,
        endpoints: {
          failures: async (query: FailuresQuery) => {
            queries.push(query);

            return { totalFailed: 9 } as never;
          },
        },
      },
    });

    return { queries, app: (rendered.component as unknown as { appState: () => AppState }).appState() };
  }

  it('counts the failures of the range and badges the nav with them', async () => {
    const { queries } = shellWith('/DurableFunctionsHub');

    await waitFor(() => expect(document.querySelector('.snav .cnt')).toHaveTextContent('9'));

    expect(queries).toHaveLength(1);
    expect(document.querySelector('.bottom-nav .bcnt')).toHaveTextContent('9');
  });

  it('asks again when the shared range changes', async () => {
    const { app, queries } = shellWith('/DurableFunctionsHub');

    await waitFor(() => expect(queries).toHaveLength(1));

    app.setTimeRange({ preset: '7d' });

    await waitFor(() => expect(queries).toHaveLength(2));
    expect(new Date(queries[1].to).getTime() - new Date(queries[1].from).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('leaves the call to the Failures screen while that screen is on', async () => {
    const { app, queries } = shellWith('/DurableFunctionsHub/failures');

    // The screen loads the same endpoint and sets the count itself; asking twice helps nobody
    await waitFor(() => expect(app.router.current.name).toBe('failures'));
    expect(queries).toEqual([]);

    app.failuresCount = 4;
    await waitFor(() => expect(document.querySelector('.snav .cnt')).toHaveTextContent('4'));
  });

  it('shows no badge on a backend without the endpoint', async () => {
    const { queries } = shellWith('/DurableFunctionsHub', {});

    await waitFor(() => expect(document.querySelector('.snav')).not.toBeNull());

    expect(queries).toEqual([]);
    expect(document.querySelector('.snav .cnt')).toBeNull();
  });
});
