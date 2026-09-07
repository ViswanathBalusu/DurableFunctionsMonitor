// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { CalendarDate } from '@internationalized/date';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DateRangeCalendar from './DateRangeCalendar.svelte';

/** Pinned, so the calendar's "nothing after today" ceiling does not move with the real clock. */
const TODAY = new CalendarDate(2026, 9, 4);

function mount(props: Record<string, unknown> = {}) {
  return render(DateRangeCalendar, {
    props: {
      from: '2026-06-01T08:30:00.000Z',
      to: '2026-06-04T14:02:00.000Z',
      maxValue: TODAY,
      calendarLabel: 'Days',
      ...props,
    },
  });
}

/**
 * A day of the two months on screen. The same date can be drawn twice - the 1st of a month is a
 * padding cell of the month before it too - so the cell of its own month is the one that counts.
 */
function day(value: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(`.cal-day[data-value="${value}"]`));

  const own = found.find((cell) => !cell.hasAttribute('data-outside-month')) ?? found[0];

  if (!own) {
    throw new Error(`no ${value} on the calendar`);
  }

  return own;
}

/** The two month buttons of the header, in the order the header draws them. */
function nav(which: 'prev' | 'next'): HTMLElement {
  const buttons = document.querySelectorAll<HTMLElement>('.cal-nav');

  return which === 'prev' ? buttons[0] : buttons[buttons.length - 1];
}

describe('DateRangeCalendar', () => {
  it('opens on the window it was given, two months at a time', () => {
    mount();

    expect(document.querySelectorAll('.cal-grid')).toHaveLength(2);
    expect(document.querySelector('.cal')?.getAttribute('aria-label')).toContain('Days');

    expect(day('2026-06-01')).toHaveAttribute('data-selection-start');
    expect(day('2026-06-04')).toHaveAttribute('data-selection-end');

    // Everything in between is the window, drawn as one block
    expect(day('2026-06-02')).toHaveAttribute('data-selected');
  });

  it('starts a new window on the first click rather than moving one end of the old one', async () => {
    mount();

    await fireEvent.click(day('2026-06-08'));

    // The gesture is two clicks: the first one is the start of a new window, and the old ends go
    await waitFor(() => expect(day('2026-06-08')).toHaveAttribute('data-selection-start'));
    expect(document.querySelectorAll('.cal-day[data-selection-end]')).toHaveLength(0);

    await fireEvent.click(day('2026-06-15'));

    await waitFor(() => expect(day('2026-06-15')).toHaveAttribute('data-selection-end'));
    expect(day('2026-06-08')).toHaveAttribute('data-selection-start');
  });

  it('will not close a window longer than the backend maximum', async () => {
    mount({ from: '2026-01-05T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' });

    await fireEvent.click(day('2026-01-05'));

    await waitFor(() => expect(day('2026-01-05')).toHaveAttribute('data-selection-start'));

    // 2026-01-05 to 2026-04-06 is the 92 days RangeQuery allows; April the 20th is past them
    await fireEvent.click(nav('next'));
    await fireEvent.click(nav('next'));

    await fireEvent.click(day('2026-04-20'));

    // Rather than closing an over-long window, the click begins a new one - so an over-long pair is
    // never handed back to the caller at all
    await waitFor(() => expect(day('2026-04-20')).toHaveAttribute('data-selection-start'));
    expect(document.querySelectorAll('.cal-day[data-selection-end]')).toHaveLength(0);

    // A day inside the maximum closes it as normal
    await fireEvent.click(day('2026-04-30'));

    await waitFor(() => expect(day('2026-04-30')).toHaveAttribute('data-selection-end'));
  });

  it('cannot pick a day in the future: there is no history there', async () => {
    mount({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z' });

    await fireEvent.click(nav('next'));

    // The ceiling is 2026-09-04, so September stops there
    await waitFor(() => expect(day('2026-09-04')).not.toHaveAttribute('data-disabled'));
    expect(day('2026-09-05')).toHaveAttribute('data-disabled');
  });
});
