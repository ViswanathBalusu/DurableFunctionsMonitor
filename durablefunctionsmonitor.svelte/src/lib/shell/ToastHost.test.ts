// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Toasts } from '$lib/state/toast.svelte';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

function mount() {
  const { component } = render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

  return (component as unknown as { toasts: () => Toasts }).toasts();
}

describe('ToastHost', () => {
  it('shows nothing until something happens', () => {
    mount();

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a success in the ok colours', async () => {
    const toasts = mount();

    toasts.ok('Terminated order-1');

    const toast = await screen.findByRole('status');
    expect(toast).toHaveClass('toast', 'ok');
    expect(toast.textContent).toContain('Terminated order-1');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows a failure with its Retry, and runs it once', async () => {
    const toasts = mount();
    const retry = vi.fn();

    toasts.error('Could not terminate order-1', { retry });

    const toast = await screen.findByRole('status');
    expect(toast).not.toHaveClass('ok');

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledOnce();

    // Retrying takes the toast away: the next attempt reports for itself
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('dismisses on ×', async () => {
    const toasts = mount();

    toasts.error('Could not load the instances');
    await screen.findByRole('status');

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(toasts.current).toBeNull();
  });

  it('replaces the toast that is up rather than stacking', async () => {
    const toasts = mount();

    toasts.ok('Suspended order-1');
    await screen.findByRole('status');

    toasts.error('Could not resume order-1');

    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
    expect(screen.getByRole('status').textContent).toContain('Could not resume order-1');
  });
});
