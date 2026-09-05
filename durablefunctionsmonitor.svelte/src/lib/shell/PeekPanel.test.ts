// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { PeekItem } from '$lib/state/peek.svelte';
import PeekHarness from '../../../tests/unit/harnesses/PeekHarness.svelte';

const orchestration: PeekItem = {
  id: 'order-2026-0917',
  name: 'ProcessOrder',
  kind: 'Orchestration',
  status: 'Running',
  created: '2026-09-04T14:02:11Z',
  updated: '2026-09-04T14:02:58Z',
  duration: 47_000,
  customStatus: { stage: 'charging' },
};

const entity: PeekItem = {
  id: '@counter@main',
  name: 'Counter',
  kind: 'DurableEntity',
  status: 'Running',
  created: '2026-09-04T09:00:00Z',
  updated: '2026-09-04T14:02:58Z',
  duration: 18_178_000,
  state: { count: 41, lastSignal: 'increment' },
};

async function openPeek(props: Record<string, unknown> = {}) {
  const view = render(PeekHarness, { props: { item: orchestration, ...props } });

  await fireEvent.click(screen.getByTestId('row'));
  await waitFor(() => expect(document.querySelector('.peek')).not.toBeNull());

  return view;
}

function panel(): HTMLElement {
  return document.querySelector('.peek') as HTMLElement;
}

describe('PeekPanel', () => {
  it('is not in the DOM until a row is peeked', () => {
    render(PeekHarness, { props: { item: orchestration } });

    expect(document.querySelector('.peek')).toBeNull();
  });

  it('heads the panel with the status tile, the id and the name', async () => {
    await openPeek();

    const tile = panel().querySelector('.tile');
    expect(tile).toHaveClass('st-running');
    expect(tile?.textContent?.trim()).toBe('Running');

    expect(panel().querySelector('.phead .mono')?.textContent?.trim()).toBe('order-2026-0917');
    expect(panel().querySelector('.phead .meta')?.textContent).toContain('ProcessOrder · Orchestration');
  });

  it('summarises the row', async () => {
    await openPeek();

    const summary = Array.from(panel().querySelectorAll('.kv dt')).map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent?.trim(),
    ]);

    expect(summary).toEqual([
      ['created', '2026-09-04 14:02:11'],
      ['last updated', '2026-09-04 14:02:58'],
      ['duration', '47 s'],
      ['customStatus', '{"stage":"charging"}'],
      // E8 owns the history count; the panel says it does not know rather than guessing
      ['history', '—'],
    ]);
  });

  it('reads the timestamps on the clock the user chose', async () => {
    await openPeek({ showTimeAs: 'Local' as const, item: { ...orchestration, customStatus: null } });

    const values = Array.from(panel().querySelectorAll('.kv dd')).map((dd) => dd.textContent?.trim());

    // Local time in the test's zone, which is not UTC; and a missing customStatus is "none"
    expect(values[0]).toMatch(/^2026-09-04 \d{2}:02:11$/);
    expect(values[3]).toBe('none');
  });

  it('draws the orchestration timeline as one lane', async () => {
    await openPeek();

    const lanes = panel().querySelectorAll('.swim .lane');
    expect(lanes).toHaveLength(1);
    expect(lanes[0].querySelector('.lbl')?.textContent).toBe('ProcessOrder');

    const bar = lanes[0].querySelector('.bar') as HTMLElement;
    expect(bar).toHaveClass('orch');
    expect(bar.style.width).toBe('100%');
    expect(bar.textContent?.trim()).toBe('47s');
  });

  it('shows an entity state pretty-printed and fully expanded', async () => {
    await openPeek({ item: entity });

    expect(panel().querySelector('.section-h + .brutal-flat .jse-bar')).not.toBeNull();
    expect(panel().querySelector('pre.json')?.textContent).toBe('{\n  "count": 41,\n  "lastSignal": "increment"\n}');

    // An entity has no timeline: the swimlane belongs to orchestrations
    expect(panel().querySelector('.swim')).toBeNull();
  });

  it('offers the orchestration actions', async () => {
    const onAction = vi.fn();
    await openPeek({ withActions: true, onAction });

    for (const name of ['Suspend', 'Raise event', 'Terminate']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }

    await fireEvent.click(screen.getByRole('button', { name: 'Terminate' }));
    expect(onAction).toHaveBeenCalledWith('terminate', expect.objectContaining({ id: 'order-2026-0917' }));
  });

  it('offers Resume in place of Suspend once the instance is suspended', async () => {
    await openPeek({ withActions: true, item: { ...orchestration, status: 'Suspended' } });

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
  });

  it('offers the entity actions', async () => {
    const onAction = vi.fn();
    await openPeek({ withActions: true, item: entity, onAction });

    await fireEvent.click(screen.getByRole('button', { name: 'Send signal' }));
    expect(onAction).toHaveBeenCalledWith('sendSignal', expect.objectContaining({ id: '@counter@main' }));

    expect(screen.getByRole('button', { name: 'Purge' })).toHaveClass('destructive');
  });

  it('disables every action in a read-only backend', async () => {
    await openPeek({ withActions: true, readOnly: true });

    for (const name of ['Suspend', 'Raise event', 'Terminate']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }

    // Open is not an action: reading is what read-only allows
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  });

  it('draws no action row until the confirms behind it exist', async () => {
    await openPeek();

    expect(screen.queryByRole('button', { name: 'Terminate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('opens the instance screen and closes', async () => {
    const { component } = await openPeek();

    await fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-2026-0917');
    await waitFor(() => expect(document.querySelector('.peek')).toBeNull());
    expect(component.peekState().isOpen).toBe(false);
  });

  it('closes on the × button, on Escape, and says so', async () => {
    await openPeek();

    expect(panel().querySelector('.pbody > p.meta')?.textContent).toBe(
      'Esc or click outside to close. The list keeps its scroll position and selection.',
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.querySelector('.peek')).toBeNull());

    await fireEvent.click(screen.getByTestId('row'));
    await waitFor(() => expect(document.querySelector('.peek')).not.toBeNull());

    await fireEvent.keyDown(panel(), { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.peek')).toBeNull());
  });

  it('leaves the list alone: same rows, same selection, same scroll', async () => {
    const { component } = render(PeekHarness, { props: { item: orchestration } });

    const list = document.querySelector('.list') as HTMLElement;
    const row = screen.getByTestId('row');
    const checkbox = screen.getByTestId('select') as HTMLInputElement;

    await fireEvent.click(checkbox);
    list.scrollTop = 24;

    await fireEvent.click(row);
    await waitFor(() => expect(document.querySelector('.peek')).not.toBeNull());

    // E4's selection store replaces this set; what matters is that the panel never touches it
    expect(component.selected()).toEqual(['order-2026-0917']);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByTestId('row')).toBe(row);
    expect(list.scrollTop).toBe(24);
  });

  it('gives the focus back to the row that opened it', async () => {
    render(PeekHarness, { props: { item: orchestration } });

    const row = screen.getByTestId('row');
    row.focus();
    await fireEvent.click(row);
    await waitFor(() => expect(document.querySelector('.peek')).not.toBeNull());

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
});
