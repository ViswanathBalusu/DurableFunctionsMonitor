// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestrationsQuery } from '$lib/api/types';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { page } from '../../../tests/unit/fixtures/instances';

function mount(options: { path?: string; onQuery?: (q: OrchestrationsQuery) => void } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Instances,
      path: options.path ?? '/DurableFunctionsHub/instances',
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          options.onQuery?.(query);
          return page(3);
        },
      },
    },
  });
}

describe('FilterRail', () => {
  it('is the row of the mockup: column, operator, value, Apply and Refresh', async () => {
    mount();

    expect(screen.getByRole('button', { name: 'Filtered column' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter operator' })).toBeInTheDocument();

    const value = screen.getByRole('textbox', { name: 'Filter value' });
    expect(value).toHaveClass('input', 'mono');
    expect(value).toHaveAttribute('placeholder', 'order-2026-');

    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('primary');
    expect(screen.getByText('Density and columns in the table menu')).toHaveClass('meta');
  });

  it('applies on Enter, once', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    const value = screen.getByRole('textbox', { name: 'Filter value' });
    await fireEvent.input(value, { target: { value: 'order-2026-' } });
    await fireEvent.keyDown(value, { key: 'Enter' });

    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));
    expect(onQuery.mock.calls[1][0].filter).toContain("startswith(instanceId, 'order-2026-')");
  });

  it('applies on the Apply button', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    await fireEvent.input(screen.getByRole('textbox', { name: 'Filter value' }), { target: { value: 'order-1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));
    expect(onQuery.mock.calls[1][0].filter).toContain("startswith(instanceId, 'order-1')");
  });

  it('does not filter on a value that has only been typed', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    await fireEvent.input(screen.getByRole('textbox', { name: 'Filter value' }), { target: { value: 'order-1' } });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onQuery).toHaveBeenCalledOnce();
  });

  it('re-applies when the operator changes under a filter that is in force', async () => {
    const onQuery = vi.fn();
    mount({ path: '/DurableFunctionsHub/instances?col=name&op=StartsWith&val=Process', onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    const trigger = screen.getByRole('button', { name: 'Filter operator' });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const option = await screen.findByRole('option', { name: 'Contains' });
    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].filter).toContain("contains(name, 'Process')"));
  });

  it('reloads from the Refresh button', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(2));
    expect(onQuery.mock.calls[1][0].skip).toBe(0);
  });
});
