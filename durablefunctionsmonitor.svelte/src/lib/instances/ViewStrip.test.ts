// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { OrchestrationStatus } from '$lib/api/types';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { instances as fixtures } from '../../../tests/unit/fixtures/instances';

function mount(options: { rows?: OrchestrationStatus[]; readOnly?: boolean; path?: string } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Instances,
      path: options.path ?? '/DurableFunctionsHub/instances',
      readOnly: options.readOnly ?? false,
      endpoints: { listOrchestrations: async () => options.rows ?? fixtures },
    },
  });
}

describe('ViewStrip', () => {
  it('offers the three views, with the table selected', async () => {
    mount();

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Table', 'Timeline', 'Histogram']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('says what is on screen and how it is sorted', async () => {
    mount();

    await waitFor(() =>
      expect(document.querySelector('.tabs .meta')?.textContent).toBe('9 loaded · sorted by createdTime desc'),
    );
  });

  it('switches the view, and puts it in the URL', async () => {
    mount();

    await fireEvent.click(await screen.findByRole('tab', { name: 'Timeline' }));

    await waitFor(() => expect(new URL(window.location.href).searchParams.get('view')).toBe('timeline'));
    expect(document.querySelector('table.tbl')).toBeNull();
  });
});

describe('the empty state', () => {
  it('replaces the strip and the table when nothing matched', async () => {
    mount({ rows: [] });

    expect(await screen.findByRole('heading', { name: 'No orchestrations', level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nothing matches these filters in the last 24 hours. Remove a chip, widen the time range or start a new instance.',
      ),
    ).toBeInTheDocument();

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelector('table.tbl')).toBeNull();
  });

  it('offers a way out of the filters, and a way to make something to look at', async () => {
    mount({ rows: [] });

    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    const start = screen.getAllByRole('button', { name: 'Start new instance' });
    expect(start).toHaveLength(2);
  });

  it('cannot start an instance from the empty state in a read-only backend', async () => {
    mount({ rows: [], readOnly: true });

    await screen.findByRole('heading', { name: 'No orchestrations' });

    for (const button of screen.getAllByRole('button', { name: 'Start new instance' })) {
      expect(button).toBeDisabled();
    }
  });

  it('says the range it looked in', async () => {
    mount({ rows: [], path: '/DurableFunctionsHub/instances?range=7d' });

    expect(await screen.findByText(/last 7 days/)).toBeInTheDocument();
  });
});
