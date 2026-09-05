// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Capabilities, OrchestrationsQuery } from '$lib/api/types';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { page } from '../../../tests/unit/fixtures/instances';
import { stats } from '../../../tests/unit/fixtures/stats';

function mount(
  options: { path?: string; capabilities?: Partial<Capabilities>; onQuery?: (q: OrchestrationsQuery) => void } = {},
) {
  return render(ScreenHarness, {
    props: {
      screen: Instances,
      path: options.path ?? '/DurableFunctionsHub/instances',
      capabilities: options.capabilities ?? {},
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          options.onQuery?.(query);
          return page(3);
        },
        stats: async () => stats(),
      },
    },
  });
}

function chips(): string[] {
  return Array.from(document.querySelectorAll('.chips2 .fchip')).map((chip) => chip.textContent?.trim() ?? '');
}

describe('FilterChips', () => {
  it('draws the rail of the mockup: facets, range, entities', async () => {
    mount();

    const bar = document.querySelector('.chips2');
    expect(bar).toHaveAttribute('aria-label', 'Filters');

    expect(screen.getByRole('button', { name: '+ status' })).toHaveClass('fchip', 'add');
    expect(screen.getByRole('button', { name: '+ orchestrator' })).toHaveClass('add');
    expect(screen.getByRole('button', { name: 'Time range' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ include entities' })).toHaveClass('add');

    // Nothing is filtered yet, so there is nothing to clear
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('shows a chip per selected status and removes it again', async () => {
    const onQuery = vi.fn();
    mount({ path: '/DurableFunctionsHub/instances?status=Running,Failed', onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalled());
    expect(chips().slice(0, 2)).toEqual(['Running ×', 'Failed ×']);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Running filter' }));

    await waitFor(() => expect(chips()[0]).toBe('Failed ×'));
    expect(onQuery.mock.calls.at(-1)?.[0].filter).toContain("runtimeStatus in ('Failed')");
  });

  it('applies the statuses of the facet together, when it closes', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole('button', { name: '+ status' }));

    await fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Failed' }));
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Terminated' }));

    // Two boxes ticked, and nothing reloaded yet
    expect(onQuery).toHaveBeenCalledOnce();

    // The rail has an Apply of its own, so this one is taken from inside the popover
    const popover = document.querySelector('.pop') as HTMLElement;
    await fireEvent.click(within(popover).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));
    expect(onQuery.mock.calls[1][0].filter).toContain("runtimeStatus in ('Failed','Terminated')");
  });

  it('offers the orchestrators /stats knows, and filters by one', async () => {
    const onQuery = vi.fn();
    mount({ capabilities: { stats: true }, onQuery });

    await fireEvent.click(screen.getByRole('button', { name: '+ orchestrator' }));

    const item = await screen.findByRole('menuitemcheckbox', { name: /ProcessOrderOrchestrator/ });
    await fireEvent.click(item);

    await waitFor(() =>
      expect(onQuery.mock.calls.at(-1)?.[0].filter).toContain("name in ('ProcessOrderOrchestrator')"),
    );

    expect(chips().some((chip) => chip.startsWith('ProcessOrderOrchestrator'))).toBe(true);
  });

  it('asks for a name to be typed when the backend has no /stats', async () => {
    mount();

    await fireEvent.click(screen.getByRole('button', { name: '+ orchestrator' }));

    const field = await screen.findByRole('textbox', { name: 'Orchestrator name' });
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();

    await fireEvent.input(field, { target: { value: 'ReconcileLedgerOrchestrator' } });
    await fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(chips().some((chip) => chip.startsWith('ReconcileLedger'))).toBe(true));
  });

  it('lets the entities in and out again', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole('button', { name: '+ include entities' }));

    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].filter).toContain("'DurableEntities')"));
    expect(screen.getByRole('button', { name: 'Entities included ×' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the free filter as a chip, and takes it off', async () => {
    const onQuery = vi.fn();
    mount({ path: '/DurableFunctionsHub/instances?col=name&op=Contains&val=Order', onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalled());
    expect(chips().some((chip) => chip.startsWith('name contains Order'))).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }));

    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].filter).not.toContain('contains(name'));
  });

  it('offers Clear all once anything is filtered, and clears everything', async () => {
    mount({ path: '/DurableFunctionsHub/instances?status=Failed&entities=1' });

    const clearAll = await screen.findByRole('button', { name: 'Clear all' });
    await fireEvent.click(clearAll);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull());
    expect(screen.getByRole('button', { name: '+ include entities' })).toBeInTheDocument();
  });

  it('changes the shared time range from the chip', async () => {
    const onQuery = vi.fn();
    const { component } = mount({ onQuery });

    const trigger = screen.getByRole('button', { name: 'Time range' });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    // bits-ui selects on pointerup, which is what a click in jsdom is not
    const option = await screen.findByRole('option', { name: 'Last 7 days' });
    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    const app = (component as unknown as { appState: () => { timeRange: unknown } }).appState();

    await waitFor(() => expect(app.timeRange).toEqual({ preset: '7d' }));
  });
});
