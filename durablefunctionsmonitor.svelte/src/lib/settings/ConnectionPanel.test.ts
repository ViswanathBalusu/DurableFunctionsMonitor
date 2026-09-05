// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { About, ConnectionInfo } from '$lib/api/types';
import type { Endpoints } from '$lib/api/endpoints';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import ConnectionPanel, { providerName } from './ConnectionPanel.svelte';

const MASKED = 'DefaultEndpointsProtocol=https;AccountName=dfmstorage001;AccountKey=••••••••••••';

function mount(
  options: {
    about?: Partial<About>;
    readOnly?: boolean;
    dangerous?: boolean;
    endpoints?: Partial<Endpoints>;
  } = {},
) {
  return render(ScreenHarness, {
    props: {
      screen: ConnectionPanel,
      path: '/DurableFunctionsHub/settings',
      readOnly: options.readOnly ?? false,
      dangerous: options.dangerous ?? false,
      about: { version: '6.6.0 (isolated)', provider: 'AzureStorage', ...options.about },
      endpoints: options.endpoints ?? {},
    },
  });
}

/** The `<dd>` that follows the given term. */
function value(term: string): HTMLElement {
  const terms = Array.from(document.querySelectorAll('dl.kv dt'));
  const dt = terms.find((node) => node.textContent === term);

  expect(dt, `no row named ${term}`).toBeDefined();

  return dt?.nextElementSibling as HTMLElement;
}

describe('providerName', () => {
  it('says what the backend means, and passes on a name it has not heard of', () => {
    expect(providerName('AzureStorage')).toBe('Azure Storage');
    expect(providerName('MsSql')).toBe('MSSQL');
    expect(providerName('Netherite')).toBe('Netherite');

    // What normalizeAbout fills in for a backend older than B0, and for nothing at all
    expect(providerName('unknown')).toBe('unknown');
    expect(providerName('')).toBe('unknown');

    expect(providerName('SomethingElse')).toBe('SomethingElse');
  });
});

describe('Connection panel', () => {
  it('is the panel of the mockup: what /about answered about this backend', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Connection', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('GET /about');

    expect(value('account')).toHaveTextContent('mystorageaccount');
    expect(value('account')).toHaveClass('mono');
    expect(value('task hub')).toHaveTextContent('DurableFunctionsHub');
    expect(value('backend')).toHaveTextContent('6.6.0 (isolated)');
    expect(value('provider').querySelector('.chip.sm')?.textContent?.trim()).toBe('Azure Storage');

    // jsdom serves the tests from localhost; the browser half of the line is the shell it runs in
    expect(value('host').textContent).toContain('standalone · ');
  });

  it('renders the permission chips for the four combinations of readOnly and dangerous', () => {
    const chips = () =>
      Array.from(value('permissions').querySelectorAll('.chip, .dbadge')).map((node) => node.textContent?.trim());

    const writable = mount({ readOnly: false, dangerous: false });
    expect(chips()).toEqual(['ReadWrite']);
    writable.unmount();

    const writableDangerous = mount({ readOnly: false, dangerous: true });
    expect(chips()).toEqual(['ReadWrite', 'DangerousOperations']);
    expect(value('permissions').querySelector('.dbadge.sm')).not.toBeNull();
    writableDangerous.unmount();

    const readOnly = mount({ readOnly: true, dangerous: false });
    expect(chips()).toEqual(['Read only']);
    readOnly.unmount();

    const readOnlyDangerous = mount({ readOnly: true, dangerous: true });
    expect(chips()).toEqual(['Read only', 'DangerousOperations']);
    readOnlyDangerous.unmount();
  });

  it('says nothing it was not told when /about has not answered yet', () => {
    mount({ about: { accountName: '', hubName: '', version: '', provider: '' } });

    expect(value('account')).toHaveTextContent('—');
    expect(value('backend')).toHaveTextContent('—');
    expect(value('provider').textContent).toContain('unknown');
  });

  it('opens /about as JSON', async () => {
    mount();

    await fireEvent.click(screen.getByRole('button', { name: 'View /about JSON' }));

    const dialog = await screen.findByRole('dialog', { name: '/about' });

    expect(within(dialog).getByRole('group', { name: '/about' })).toBeInTheDocument();
  });

  it('shows the masked connection string the backend sends, and nothing that could write it back', async () => {
    const manageConnection = vi.fn(async (): Promise<ConnectionInfo> => ({
      connectionString: MASKED,
      hubName: 'DurableFunctionsHub',
      isReadOnly: true,
    }));

    mount({ endpoints: { manageConnection } });

    await fireEvent.click(screen.getByRole('button', { name: 'Manage connection' }));

    const dialog = await screen.findByRole('dialog', { name: 'Connection settings' });

    await waitFor(() => expect(manageConnection).toHaveBeenCalledOnce());

    const connectionString = within(dialog).getByLabelText('Storage connection string') as HTMLInputElement;

    await waitFor(() => expect(connectionString.value).toBe(MASKED));
    expect(connectionString.readOnly).toBe(true);
    expect(connectionString).toHaveClass('mono');

    const hubName = within(dialog).getByLabelText('Task hub name') as HTMLInputElement;

    expect(hubName.value).toBe('DurableFunctionsHub');
    expect(hubName.readOnly).toBe(true);

    expect(dialog.textContent).toContain('Keys are never sent to the browser.');

    // The backend has no endpoint that writes the connection back, so there is nothing but Close
    const footer = dialog.querySelector('.foot') as HTMLElement;

    expect(
      within(footer)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Close']);
  });

  it('says why the connection could not be read', async () => {
    mount({
      endpoints: {
        manageConnection: async () => {
          throw new Error('403 Forbidden');
        },
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Manage connection' }));

    const dialog = await screen.findByRole('dialog', { name: 'Connection settings' });

    await waitFor(() => expect(dialog.textContent).toContain('Could not read the connection. 403 Forbidden'));
    expect((within(dialog).getByLabelText('Storage connection string') as HTMLInputElement).value).toBe('');
  });

  it('asks the backend again every time the dialog opens', async () => {
    const manageConnection = vi.fn(async (): Promise<ConnectionInfo> => ({
      connectionString: MASKED,
      hubName: 'h',
      isReadOnly: true,
    }));

    mount({ endpoints: { manageConnection } });

    await fireEvent.click(screen.getByRole('button', { name: 'Manage connection' }));

    const dialog = await screen.findByRole('dialog', { name: 'Connection settings' });

    await waitFor(() => expect(manageConnection).toHaveBeenCalledOnce());

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connection settings' })).toBeNull());

    await fireEvent.click(screen.getByRole('button', { name: 'Manage connection' }));

    await waitFor(() => expect(manageConnection).toHaveBeenCalledTimes(2));
  });
});
