// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import { PICK_END } from './DateRangeCalendar.svelte';
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

describe('TimeRangeSelect: the backend maximum', () => {
  /** A window longer than RangeQuery.MaxRangeDays, as a shared link could carry one. */
  const TOO_LONG = '/DurableFunctionsHub?from=2025-01-01T00:00:00.000Z&to=2026-09-04T00:00:00.000Z';

  it('refuses to apply a window the backend would reject, and says how long it is', async () => {
    const { app } = mount(TOO_LONG);

    await choose('Custom range…');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // /stats, /failures and /audit all answer 400 for this one, so Apply is not offered
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText(/611 days.*at most 92 days/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Cancelled, so the link's own window is still what every screen is loading
    expect(app.timeRange).toEqual({ from: '2025-01-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' });
  });

  it('applies a window exactly as long as the maximum', async () => {
    const { app } = mount('/DurableFunctionsHub?from=2026-06-04T00:00:00.000Z&to=2026-09-04T00:00:00.000Z');

    await choose('Custom range…');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(app.timeRange).toEqual({ from: '2026-06-04T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' }),
    );
  });

  it('shows the calendar of the window beside the two time fields', async () => {
    mount();

    await choose('Custom range…');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Two months, so a window that crosses a month boundary is one gesture
    expect(document.querySelector('.cal')?.getAttribute('aria-label')).toContain('Time range days');
    expect(document.querySelectorAll('.cal-grid')).toHaveLength(2);

    // The 24 hours in force are already drawn on it: two ends, one of them today
    expect(document.querySelectorAll('.cal-day[data-selection-start]')).toHaveLength(1);
    expect(document.querySelectorAll('.cal-day[data-selection-end]')).toHaveLength(1);
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });
});

describe('TimeRangeSelect: picking days on the calendar', () => {
  function day(value: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`.cal-day[data-value="${value}"]`);

    if (!found) {
      throw new Error(`no ${value} on the calendar`);
    }

    return found;
  }

  it('takes two clicks, and only then is the window the one on the calendar', async () => {
    // A window safely in the past: nothing after today can be picked, and there is no data there
    const { app } = mount('/DurableFunctionsHub?from=2026-06-01T08:30:00.000Z&to=2026-06-04T14:02:00.000Z');

    await choose('Custom range…');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await fireEvent.click(day('2026-06-08'));

    // Half a gesture is not a window: Apply stays off until the other end is picked
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled());
    expect(screen.getByText(PICK_END)).toBeInTheDocument();
    expect(day('2026-06-08')).toHaveAttribute('data-selection-start');

    await fireEvent.click(day('2026-06-15'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled());

    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // The days are the ones clicked; the times are the ones the window already had
    await waitFor(() =>
      expect(app.timeRange).toEqual({ from: '2026-06-08T08:30:00.000Z', to: '2026-06-15T14:02:00.000Z' }),
    );
  });
});
