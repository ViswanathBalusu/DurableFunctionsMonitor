// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import HubAdminPanel, { READ_ONLY_REASON, UNSUPPORTED_REASON } from './HubAdminPanel.svelte';

/** Everything this panel governs, on. */
const ALL: Partial<Capabilities> = { purgeHistory: true, cleanEntityStorage: true, deleteTaskHub: true };

function mount(options: { capabilities?: Partial<Capabilities>; readOnly?: boolean; path?: string } = {}) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: HubAdminPanel,
      path: options.path ?? '/DurableFunctionsHub/settings',
      capabilities: options.capabilities ?? ALL,
      readOnly: options.readOnly ?? false,
    },
  });

  return {
    ...rendered,
    app: (rendered.component as unknown as { appState: () => AppState }).appState(),
  };
}

/** The row of one operation, by its title. */
function row(title: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll('.panel .stack > .row')) as HTMLElement[];
  const found = rows.find((candidate) => candidate.textContent?.startsWith(title));

  expect(found, `no row named ${title}`).toBeDefined();

  return found as HTMLElement;
}

function button(title: string): HTMLButtonElement {
  return within(row(title)).getByRole('button') as HTMLButtonElement;
}

describe('Hub administration panel', () => {
  it('is the panel of ScreenSettings.dc.html L31-L38: three operations on the whole hub', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Hub administration', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('ReadWrite only');

    expect(row('Purge instance history').textContent).toContain(
      'By created time and runtime status. Cannot be undone.',
    );
    expect(button('Purge instance history').textContent?.trim()).toBe('Purge…');
    expect(button('Purge instance history')).toHaveClass('destructive');

    expect(row('Clean entity storage').textContent).toContain('Removes empty entities and orphaned locks.');
    expect(button('Clean entity storage').textContent?.trim()).toBe('Clean…');

    // The hub of this route, named in the line that says what goes
    expect(row('Delete task hub').textContent).toContain('Drops every table, queue and blob of DurableFunctionsHub.');
    expect(button('Delete task hub').textContent?.trim()).toBe('Delete…');
  });

  it('offers only what the backend announces, and says why for the rest', () => {
    mount({ capabilities: { purgeHistory: true, cleanEntityStorage: false, deleteTaskHub: false } });

    expect(button('Purge instance history')).toBeEnabled();
    expect(button('Purge instance history')).not.toHaveAttribute('title');

    for (const title of ['Clean entity storage', 'Delete task hub']) {
      expect(button(title)).toBeDisabled();
      expect(button(title)).toHaveAttribute('title', UNSUPPORTED_REASON);
    }
  });

  it('offers none of them to a read-only backend, whatever it announces', () => {
    mount({ readOnly: true, capabilities: ALL });

    for (const title of ['Purge instance history', 'Clean entity storage', 'Delete task hub']) {
      expect(button(title)).toBeDisabled();
      expect(button(title)).toHaveAttribute('title', READ_ONLY_REASON);
    }
  });

  it('opens each dialog from its own row', async () => {
    mount();

    await fireEvent.click(button('Purge instance history'));
    expect(await screen.findByRole('dialog', { name: 'Purge instance history' })).toBeInTheDocument();

    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await fireEvent.click(button('Clean entity storage'));
    expect(await screen.findByRole('dialog', { name: 'Clean entity storage' })).toBeInTheDocument();

    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await fireEvent.click(button('Delete task hub'));
    expect(await screen.findByRole('dialog', { name: 'Delete task hub DurableFunctionsHub' })).toBeInTheDocument();
  });

  it("opens the dialog VS Code's command asked for, and spends the parameter", async () => {
    const { app } = mount({ path: '/DurableFunctionsHub/settings?dialog=purge' });

    expect(await screen.findByRole('dialog', { name: 'Purge instance history' })).toBeInTheDocument();

    // Spent as it is read: reloading or going back must not re-open a destructive dialog
    await waitFor(() => expect(app.router.current.query.get('dialog')).toBeNull());
  });

  it("opens the clean dialog for VS Code's other command", async () => {
    mount({ path: '/DurableFunctionsHub/settings?dialog=clean' });

    expect(await screen.findByRole('dialog', { name: 'Clean entity storage' })).toBeInTheDocument();
  });

  it('opens nothing without the parameter', async () => {
    mount();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
