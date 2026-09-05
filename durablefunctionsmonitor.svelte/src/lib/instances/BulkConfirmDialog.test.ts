// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities } from '$lib/api/types';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instances as fixtures } from '../../../tests/unit/fixtures/instances';
import { BULK_BATCH_NOTE, BULK_FANOUT_NOTE, bulkDef } from './bulk-defs';

function mount(capabilities: Partial<Capabilities> = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Instances,
      capabilities,
      endpoints: { listOrchestrations: async () => fixtures },
    },
  });
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('table.tbl tbody tr'));
}

/** Selects `count` rows and opens one bulk confirm from the bar. */
async function open(action: string, count = 2, capabilities: Partial<Capabilities> = {}): Promise<void> {
  mount(capabilities);

  await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

  for (let index = 0; index < count; index += 1) {
    await fireEvent.click(rows()[index].querySelector('.sel-cell .box') as HTMLElement);
  }

  await fireEvent.click(screen.getByRole('button', { name: action }));
  await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());
}

function dialog(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

describe('bulkDef', () => {
  it('counts the instances into every line of the wording', () => {
    expect(bulkDef('terminate', 3)).toMatchObject({
      title: 'Terminate 3 instances',
      confirm: 'Terminate 3 instances',
      variant: 'destructive',
      band: true,
      reason: true,
    });

    expect(bulkDef('suspend', 1).confirm).toBe('Suspend 1');
    expect(bulkDef('raise-event', 4).title).toBe('Raise event on 4 instances');
    expect(bulkDef('raise-event', 4).confirm).toBe('Raise event');
    expect(bulkDef('resume', 2).reason).toBeUndefined();
    expect(bulkDef('purge', 2)).toMatchObject({ variant: 'destructive', band: true });
  });
});

describe('BulkConfirmDialog', () => {
  it('shows the terminate wording, the hazard band, the ids and a reason', async () => {
    await open('Terminate');

    expect(screen.getByText('Terminate 2 instances', { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).not.toBeNull();
    expect(dialog().textContent).toContain('This cannot be undone.');

    const ids = dialog().querySelector('.ed.ro pre')?.textContent ?? '';
    expect(ids).toContain('order-2026-09-04-000913');
    expect(ids).toContain('order-2026-09-04-000912');

    expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Event name')).toBeNull();

    expect(dialog().textContent).toContain(BULK_FANOUT_NOTE);
    expect(screen.getByRole('button', { name: 'Terminate 2 instances' })).toHaveClass('destructive');
  });

  it('says it will go through the batch endpoint where the backend has one', async () => {
    await open('Terminate', 2, { batch: true });

    // ScreenInstances.dc.html L154 - the same dialog, telling the truth about how it will run
    expect(dialog().querySelector('.meta')?.textContent).toBe(BULK_BATCH_NOTE);
  });

  it('asks for the event and its payload, and will not send a nameless one', async () => {
    await open('Raise event');

    expect(screen.getByText('Raise event on 2 instances', { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).toBeNull();
    expect(screen.queryByLabelText('Reason (optional)')).toBeNull();

    // The bar behind the dialog carries the same words, so the confirm is taken from the dialog
    const confirm = within(dialog()).getByRole('button', { name: 'Raise event' });
    expect(confirm).toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Event name'), { target: { value: 'PaymentApproved' } });

    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.getByRole('group', { name: 'Event data (JSON)' })).toBeInTheDocument();
  });

  it('purges without a reason, and behind the band', async () => {
    await open('Purge');

    expect(screen.getByText('Purge 2 instances', { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).not.toBeNull();
    expect(screen.queryByLabelText('Reason (optional)')).toBeNull();
    expect(dialog().textContent).toContain('their large-message blobs');
  });

  it('resumes without a band and says what it skips', async () => {
    await open('Resume');

    expect(dialog().querySelector('.warn')).toBeNull();
    expect(dialog().textContent).toContain('Instances that are not suspended are reported as skipped.');
    expect(screen.queryByLabelText('Reason (optional)')).toBeNull();
  });

  it('cancels back to the bar, with the selection still made', async () => {
    await open('Suspend');

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
    expect(document.querySelector('.bulk .cnt')?.textContent).toBe('2 selected');
  });
});
