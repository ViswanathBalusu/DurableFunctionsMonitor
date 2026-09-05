// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { Login as LoginState, type HubOption } from '$lib/state/login.svelte';
import Login from './Login.svelte';

function state(overrides: Partial<LoginState> = {}) {
  window.history.replaceState({}, '', '/');

  const login = new LoginState({
    endpoints: {} as Endpoints,
    host,
    router: new Router({ mode: 'history', routePrefix: '' }),
  });

  return Object.assign(login, overrides);
}

const hubs: HubOption[] = [
  { name: 'First', badge: 'ReadWrite', version: '6.9.0 (isolated)' },
  { name: 'Second', badge: 'Read only', version: '6.9.0 (isolated)' },
  { name: 'Third', badge: null, version: null },
];

describe('Login screen', () => {
  it('names the product, the version and the host', () => {
    render(Login, { props: { login: state({ version: '6.9.0 (isolated)' }) } });

    expect(screen.getByRole('heading', { name: 'Durable Functions Monitor', level: 1 })).toHaveClass('display');
    expect(document.querySelector('.login .meta')?.textContent).toBe(`6.9.0 (isolated) · ${window.location.host}`);
  });

  it('says nothing about a version it does not know yet', () => {
    render(Login, { props: { login: state() } });

    expect(document.querySelector('.login .meta')?.textContent).toBe(window.location.host);
  });

  it('offers the sign-in card when AAD is configured and nobody is signed in', () => {
    render(Login, { props: { login: state({ needsSignIn: true }) } });

    expect(screen.getByRole('heading', { name: 'Sign in', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/This deployment uses Easy Auth/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveClass('primary');

    // No connection-string form: the backend has no endpoint behind it (decision D11)
    expect(screen.queryByText(/connection string/i)).toBeNull();
  });

  it('takes the user to AAD from the sign-in button', async () => {
    const login = state({ needsSignIn: true });
    const signIn = vi.fn();
    login.signIn = signIn;

    render(Login, { props: { login } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));

    expect(signIn).toHaveBeenCalledOnce();
  });

  it('lists the hubs, with the badge each one reported', () => {
    render(Login, {
      props: { login: state({ hubs, userName: 'chandra@contoso.com', accountName: 'dfmstorage001' }) },
    });

    const rows = Array.from(document.querySelectorAll('.hubrow'));
    expect(rows.map((row) => row.querySelector('.mono')?.textContent)).toEqual(['First', 'Second', 'Third']);

    expect(rows[0].querySelector('.chip')?.textContent?.trim()).toBe('ReadWrite');
    expect(rows[1].querySelector('.chip')).toHaveClass('st-terminated');

    // A hub whose /about failed carries no badge rather than a wrong one
    expect(rows[2].querySelector('.chip')).toBeNull();

    expect(screen.getByText('signed in as chandra@contoso.com')).toBeInTheDocument();
    expect(screen.getByText('dfmstorage001')).toHaveClass('mono');
  });

  it('says where the hubs came from, and offers the way out', () => {
    render(Login, { props: { login: state({ hubs }) } });

    expect(screen.getByText('Hubs come from GET ../task-hub-names for this storage account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveClass('ghost');
  });

  it('signs out', async () => {
    const login = state({ hubs });
    const signOut = vi.fn();
    login.signOut = signOut;

    render(Login, { props: { login } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  it('links each row to that hub, and picking the second reports it', async () => {
    const onPick = vi.fn();
    render(Login, { props: { login: state({ hubs }), onPick } });

    const rows = Array.from(document.querySelectorAll('.hubrow')) as HTMLAnchorElement[];
    expect(rows.map((row) => new URL(row.href).pathname)).toEqual(['/First', '/Second', '/Third']);

    await fireEvent.click(rows[1]);

    expect(onPick).toHaveBeenCalledWith('Second');
  });

  it('leaves a Ctrl-click to the browser, so a hub can be opened in a second tab', async () => {
    const onPick = vi.fn();
    render(Login, { props: { login: state({ hubs }), onPick } });

    const row = document.querySelector('.hubrow') as HTMLElement;
    await fireEvent.click(row, { ctrlKey: true });

    expect(onPick).not.toHaveBeenCalled();
  });

  it('says why it is empty when the login failed', () => {
    render(Login, { props: { login: state({ error: 'Failed to load the list of Task Hubs. 403 Forbidden' }) } });

    expect(screen.getByRole('status')).toHaveTextContent('403 Forbidden');
    expect(document.querySelector('.hubrow')).toBeNull();
  });

  it('carries the footnote about read-only and dangerous operations', () => {
    render(Login, { props: { login: state() } });

    expect(
      screen.getByText(
        'Read-only deployments show a Read only badge after sign in. Dangerous operations need DFM_DANGEROUS_OPERATIONS_ENABLED=true on the backend.',
      ),
    ).toBeInTheDocument();
  });
});
