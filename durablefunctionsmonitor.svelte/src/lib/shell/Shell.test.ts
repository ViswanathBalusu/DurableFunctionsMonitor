// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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
    ['/DurableFunctionsHub/instances/order-1', 'Instance'],
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
    expect(screen.getByRole('heading', { name: 'Instance', level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-1');
  });
});
