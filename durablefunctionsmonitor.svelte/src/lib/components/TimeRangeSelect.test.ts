// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import TimeRangeSelect from './TimeRangeSelect.svelte';

const DAY_MS = 24 * 60 * 60_000;

function mount(path = '/DurableFunctionsHub') {
  const rendered = render(ScreenHarness, { props: { screen: TimeRangeSelect, path } });

  return {
    ...rendered,
    app: (rendered.component as unknown as { appState: () => AppState }).appState(),
  };
}

/** bits-ui opens on ArrowDown and selects on pointerup, which is what a click in jsdom is not. */
async function choose(name: string): Promise<void> {
  await fireEvent.keyDown(screen.getByRole('button', { name: 'Time range' }), { key: 'ArrowDown' });

  const option = await screen.findByRole('option', { name });

  await fireEvent.pointerDown(option, { pointerType: 'mouse' });
  await fireEvent.pointerUp(option, { pointerType: 'mouse' });
  await fireEvent.click(option);
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Time range' });
}

describe('TimeRangeSelect', () => {
  it('offers the five presets and the entry that opens the picker', async () => {
    mount();

    await fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(6));

    expect(screen.getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([
      'Last 15 minutes',
      'Last hour',
      'Last 24 hours',
      'Last 7 days',
      'Last 30 days',
      'Custom range…',
    ]);
  });

  it('sets a preset on the shared range', async () => {
    const { app } = mount();

    await choose('Last 7 days');

    await waitFor(() => expect(app.timeRange).toEqual({ preset: '7d' }));
  });

  it('opens the picker on the window in force and applies what it holds', async () => {
    const { app } = mount();

    await choose('Custom range…');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Custom time range')).toBeInTheDocument();

    // The dialog opens seeded with the 24 hours that were in force, so Apply alone is a valid answer
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect('from' in app.timeRange).toBe(true));

    const range = app.timeRange as { from: string; to: string };
    const span = new Date(range.to).getTime() - new Date(range.from).getTime();

    expect(Math.round(span / 1000)).toBe(DAY_MS / 1000);
    expect(new URL(window.location.href).searchParams.get('range')).toBeNull();
  });

  it('names the custom window in the trigger, and keeps offering the picker', async () => {
    mount('/DurableFunctionsHub?from=2026-09-04T08:30:00.000Z&to=2026-09-04T14:02:00.000Z');

    expect(trigger().textContent?.trim()).toBe('2026-09-04 08:30 → 14:02');

    await fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(7));
  });

  it('leaves the range and the trigger alone when the picker is cancelled', async () => {
    const { app } = mount();

    await choose('Custom range…');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(app.timeRange).toEqual({ preset: '24h' });

    // The picker entry is an action, not a range: the trigger still names the window in force
    expect(trigger().textContent?.trim()).toBe('Last 24 hours');
  });
});
