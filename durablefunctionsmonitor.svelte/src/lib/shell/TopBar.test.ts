// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { Host } from '$lib/host.svelte';
import { Hubs } from '$lib/state/hubs.svelte';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

function endpoints(taskHubNames: () => Promise<string[]>): Endpoints {
  return { taskHubNames } as unknown as Endpoints;
}

const browser = { kind: 'browser' } as Host;
const vscode = { kind: 'vscode' } as Host;

describe('Hubs', () => {
  it('loads the hubs once and sorts them', async () => {
    const call = vi.fn(async () => ['Zulu', 'alpha', 'DurableFunctionsHub']);
    const hubs = new Hubs(endpoints(call), browser);

    expect(await hubs.load('DurableFunctionsHub')).toEqual(['alpha', 'DurableFunctionsHub', 'Zulu']);

    await hubs.load('DurableFunctionsHub');
    expect(call).toHaveBeenCalledOnce();
  });

  it('asks nothing inside VS Code, where there is one attached hub', async () => {
    const call = vi.fn(async () => ['a', 'b']);
    const hubs = new Hubs(endpoints(call), vscode);

    expect(await hubs.load('DurableFunctionsHub')).toEqual(['DurableFunctionsHub']);
    expect(call).not.toHaveBeenCalled();
    expect(hubs.switchable).toBe(false);
  });

  it('falls back to the open hub when the backend will not list them', async () => {
    const hubs = new Hubs(
      endpoints(async () => {
        throw new Error('Task Hub name is invalid.');
      }),
      browser,
    );

    expect(await hubs.load('DurableFunctionsHub')).toEqual(['DurableFunctionsHub']);
    expect(hubs.error).toBe('Task Hub name is invalid.');
  });

  it('asks again after a reset', async () => {
    const call = vi.fn(async () => ['a']);
    const hubs = new Hubs(endpoints(call), browser);

    await hubs.load('a');
    hubs.reset();
    await hubs.load('a');

    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe('TopBar', () => {
  it('renders the product name, the hub and the controls', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(screen.getByText('Durable Functions Monitor')).toHaveClass('display');
    expect(await screen.findByRole('button', { name: /DurableFunctionsHub/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-refresh' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Show time as' })).toBeInTheDocument();
  });

  it('shows the read-only chip when /about withholds ReadWrite', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', readOnly: true } });

    const chip = screen.getByText('Read only');
    expect(chip).toHaveClass('chip');
    expect(chip.getAttribute('title')).toBe('/about does not list DurableFunctionsMonitor.ReadWrite');
  });

  it('hides it when the endpoint is writable', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', readOnly: false } });

    expect(screen.queryByText('Read only')).toBeNull();
  });

  it('shows the danger badge only when dangerous operations are on', () => {
    const off = render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });
    expect(screen.queryByText('Dangerous operations on')).toBeNull();
    off.unmount();

    render(ShellHarness, { props: { path: '/DurableFunctionsHub', dangerous: true } });
    expect(screen.getByText('Dangerous operations on')).toHaveClass('dbadge');
  });

  it('binds the time toggle to the preference', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(screen.getByRole('button', { name: 'UTC' }).getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Local' }));

    expect(screen.getByRole('button', { name: 'Local' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('tells the user what Local means here', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    // The suite runs in Etc/GMT-2
    expect(screen.getByRole('group', { name: 'Show time as' }).getAttribute('title')).toBe('UTC+2');
  });
});

describe('HubSwitcher', () => {
  it('lists the hubs of the account and marks the open one', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', hubNames: ['DurableFunctionsHub', 'OtherHub'] } });

    await fireEvent.click(await screen.findByRole('button', { name: /DurableFunctionsHub/ }));

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());

    const current = screen.getByRole('menuitemradio', { name: /DurableFunctionsHub/ });
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(current.textContent).toContain('current');

    expect(screen.getByRole('menuitemradio', { name: /OtherHub/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('switches to the chosen hub’s Overview', async () => {
    render(ShellHarness, {
      props: { path: '/DurableFunctionsHub/entities', hubNames: ['DurableFunctionsHub', 'OtherHub'] },
    });

    await fireEvent.click(await screen.findByRole('button', { name: /DurableFunctionsHub/ }));
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /OtherHub/ })).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('menuitemradio', { name: /OtherHub/ }));

    expect(window.location.pathname).toBe('/OtherHub');
  });

  it('offers the way back to the hub picker in the browser', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', hubNames: ['DurableFunctionsHub'] } });

    await fireEvent.click(await screen.findByRole('button', { name: /DurableFunctionsHub/ }));

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Switch account or connection…' })).toBeInTheDocument(),
    );
  });
});
