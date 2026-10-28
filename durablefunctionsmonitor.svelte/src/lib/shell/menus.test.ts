// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { THEMES, family, theme } from '$lib/themes';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

async function openMenu(name: RegExp | string) {
  const trigger = await screen.findByRole('button', { name });
  await fireEvent.click(trigger);
  await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
  return trigger;
}

describe('themes.ts', () => {
  it('has the five papers of the design system, with their swatches', () => {
    const papers = THEMES.filter((entry) => entry.family === 'brutal');

    expect(papers.map((entry) => entry.key)).toEqual(['poster', 'riso', 'memphis', 'blueprint', 'hazard']);

    for (const entry of THEMES) {
      expect(entry.paper).toMatch(/^#[0-9A-F]{6}$/i);
      expect(entry.ink).toMatch(/^#[0-9A-F]{6}$/i);
      expect(entry.primary).toMatch(/^#[0-9A-F]{6}$/i);
      expect(entry.dark).toMatch(/^#[0-9A-F]{6}$/i);
      expect(entry.metrics).toMatch(/px/);
    }
  });

  it('falls back to the first theme for a name it does not know', () => {
    expect(theme('riso').label).toBe('Riso');
    expect(theme('neon' as never).key).toBe('poster');
  });

  it('answers the family of a theme, and of an unknown name with the first theme', () => {
    expect(family('hazard')).toBe('brutal');
    expect(family('neon' as never)).toBe('brutal');
  });
});

describe('ThemeMenu', () => {
  it('names the current theme and mode on its trigger', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(await screen.findByRole('button', { name: /Poster · Light/ })).toBeInTheDocument();
  });

  it('offers every theme as a radio, with the current one marked', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openMenu(/Poster · Light/);

    const tiles = screen.getAllByRole('menuitemradio');
    expect(tiles).toHaveLength(THEMES.length);
    expect(tiles[0].getAttribute('aria-checked')).toBe('true');
    expect(tiles[0]).toHaveClass('active');

    // Three swatches per tile: paper, ink, primary
    expect(tiles[1].querySelectorAll('.sw i')).toHaveLength(3);
  });

  it('applies a theme to the document and remembers it', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openMenu(/Poster · Light/);
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /Riso/ }));

    expect(document.documentElement.dataset.theme).toBe('riso');
    expect(await screen.findByRole('button', { name: /Riso · Light/ })).toBeInTheDocument();
  });

  it('turns dark mode on with the switch', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openMenu(/Poster/);
    await fireEvent.click(screen.getByRole('switch', { name: /Dark mode/ }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // And back
    await fireEvent.click(screen.getByRole('switch', { name: /Dark mode/ }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('switches the density', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openMenu(/Poster/);
    await fireEvent.click(screen.getByRole('switch', { name: /Comfortable density/ }));

    expect(document.documentElement.dataset.density).toBe('comfortable');
  });
});

describe('UserMenu', () => {
  const signedIn = {
    source: 'server' as const,
    userName: 'chandra@contoso.com',
    name: 'Chandra Balusu',
    objectId: '11111111-2222-3333-4444-555555555555',
    tenantId: '66666666-7777-8888-9999-000000000000',
    roles: ['Operator'],
    authMethod: 'easyauth',
  };

  it('shows who signed in through Easy Auth or MSAL, not only what the host was told', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', identity: signedIn } });

    await openMenu(/chandra/);

    expect(screen.getByText('Chandra Balusu')).toBeInTheDocument();
    expect(screen.getByText('chandra@contoso.com · ReadWrite')).toHaveClass('meta');
  });

  it('opens the details of the account: everything the identity says, and nothing it does not', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', identity: signedIn } });

    await openMenu(/chandra/);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Account details' }));

    const dialog = await screen.findByRole('dialog', { name: 'Account' });
    const details = within(dialog).getByLabelText('Account details');

    expect(within(details).getByText('Chandra Balusu')).toBeInTheDocument();
    expect(within(details).getByText('11111111-2222-3333-4444-555555555555')).toBeInTheDocument();
    expect(within(details).getByText('66666666-7777-8888-9999-000000000000')).toBeInTheDocument();
    expect(within(details).getByText('Operator')).toBeInTheDocument();
    expect(within(details).getByText(/Easy Auth/)).toBeInTheDocument();

    // No MSAL session here, so nothing about tokens
    expect(within(details).queryByText('Token scopes')).toBeNull();
    expect(within(dialog).queryByText(/ID token claims/)).toBeNull();
  });

  it('says that changes are audited only when they are', async () => {
    const { unmount } = render(ShellHarness, {
      props: { path: '/DurableFunctionsHub', identity: signedIn, capabilities: { audit: true } },
    });

    await openMenu(/chandra/);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Account details' }));
    expect(await screen.findByText(/recorded in the audit log/)).toBeInTheDocument();

    unmount();
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', identity: signedIn } });

    await openMenu(/chandra/);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Account details' }));
    await screen.findByRole('dialog', { name: 'Account' });
    expect(screen.queryByText(/recorded in the audit log/)).toBeNull();
  });

  it('copies the details of the account', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(ShellHarness, { props: { path: '/DurableFunctionsHub', identity: signedIn } });

    await openMenu(/chandra/);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Account details' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy details' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
      userName: 'chandra@contoso.com',
      objectId: signedIn.objectId,
    });
  });

  it('has no account to show when nobody is signed in', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openMenu(/anonymous/);

    expect(screen.queryByRole('menuitem', { name: 'Account details' })).toBeNull();
  });

  it('shows the user, the permissions and the way to Settings', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', userName: 'chandra@contoso.com' } });

    await openMenu(/chandra/);

    expect(screen.getByText('chandra@contoso.com · ReadWrite')).toHaveClass('meta');

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/DurableFunctionsHub/settings');
  });

  it('says anonymous when authentication is off, and offers no sign out', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openMenu(/anonymous/);

    expect(screen.getByText(/^anonymous ·/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
  });

  it('names the dangerous permission when it is on', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', dangerous: true, userName: 'a@b.com' } });

    await openMenu(/^a$|a@b/);

    expect(screen.getByText('a@b.com · ReadWrite · DangerousOperations')).toBeInTheDocument();
  });

  it('offers sign out when the login state provides one', async () => {
    const onSignOut = vi.fn();
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', onSignOut } });

    await openMenu(/anonymous/);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('offers the palette from the menu on narrow screens', async () => {
    const onOpenPalette = vi.fn();
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', onOpenPalette } });

    await openMenu(/anonymous/);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Command palette' }));

    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
