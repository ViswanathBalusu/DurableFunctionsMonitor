// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instances as fixtures } from '../../../tests/unit/fixtures/instances';

function mount(options: { readOnly?: boolean } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Instances,
      readOnly: options.readOnly ?? false,
      endpoints: {
        listOrchestrations: async () => fixtures,
      },
    },
  });
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('table.tbl tbody tr'));
}

async function selectFirstRow(): Promise<void> {
  await waitFor(() => expect(rows()).toHaveLength(fixtures.length));
  await fireEvent.click(rows()[0].querySelector('.sel-cell .box') as HTMLElement);
}

function bar(): HTMLElement | null {
  return document.querySelector('.bulk');
}

describe('BulkActionBar', () => {
  it('is not there until something is selected', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    expect(bar()).toBeNull();
  });

  it('appears with one selected row, and the × puts it away again', async () => {
    mount();

    await selectFirstRow();

    await waitFor(() => expect(bar()).not.toBeNull());
    expect(bar()).toHaveAttribute('role', 'toolbar');
    expect(bar()).toHaveAttribute('aria-label', 'Bulk actions');
    expect(bar()?.querySelector('.cnt')?.textContent).toBe('1 selected');

    await fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    await waitFor(() => expect(bar()).toBeNull());
    expect(rows()[0]).not.toHaveAttribute('aria-selected', 'true');
  });

  it('counts every selected row', async () => {
    mount();

    await selectFirstRow();
    await fireEvent.click(rows()[2].querySelector('.sel-cell .box') as HTMLElement);

    await waitFor(() => expect(bar()?.querySelector('.cnt')?.textContent).toBe('2 selected'));
  });

  it('offers the six actions of the mockup, purge destructive', async () => {
    mount();

    await selectFirstRow();
    await waitFor(() => expect(bar()).not.toBeNull());

    const buttons = Array.from(bar()?.querySelectorAll('button') ?? []).map((button) => button.textContent?.trim());

    expect(buttons).toEqual(['Terminate', 'Suspend', 'Resume', 'Rewind', 'Raise event', 'Purge', '×']);
    expect(screen.getByRole('button', { name: 'Purge' })).toHaveClass('destructive');

    // Nothing dangerous is offered in bulk (design §3)
    expect(screen.queryByRole('button', { name: /replay|restart/i })).toBeNull();
  });

  it('disables every action in a read-only hub, but still lets the selection go', async () => {
    mount({ readOnly: true });

    await selectFirstRow();
    await waitFor(() => expect(bar()).not.toBeNull());

    for (const name of ['Terminate', 'Suspend', 'Resume', 'Rewind', 'Raise event', 'Purge']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }

    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeEnabled();
  });
});
