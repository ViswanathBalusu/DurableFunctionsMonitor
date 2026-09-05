// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ProgressBar from './ProgressBar.svelte';
import Toast from './Toast.svelte';

describe('ProgressBar', () => {
  it('is a labelled .progress bar', () => {
    render(ProgressBar, { props: {} });

    const bar = screen.getByRole('progressbar', { name: 'Loading' });
    expect(bar).toHaveClass('progress');
  });

  it('takes a label of its own', () => {
    render(ProgressBar, { props: { label: 'Terminating' } });

    expect(screen.getByRole('progressbar', { name: 'Terminating' })).toBeInTheDocument();
  });

  it('keeps only its bottom border under the top bar', () => {
    render(ProgressBar, { props: { inline: true } });

    expect(screen.getByRole('progressbar').getAttribute('style')?.replace(/\s/g, '')).toContain(
      'border-width:00var(--border-width)',
    );
  });
});

describe('Toast', () => {
  it('reports an error by default', () => {
    render(Toast, { props: { message: 'Terminate failed: instance is not running' } });

    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('toast');
    expect(toast).not.toHaveClass('ok');
    expect(toast.textContent).toContain('Terminate failed');
  });

  it('turns green for a success', () => {
    render(Toast, { props: { kind: 'ok', message: 'Terminated 3 instances' } });

    expect(screen.getByRole('status')).toHaveClass('ok');
  });

  it('offers Retry only when there is something to retry', async () => {
    const plain = render(Toast, { props: { message: 'Failed' } });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    plain.unmount();

    const onRetry = vi.fn();
    render(Toast, { props: { message: 'Failed', onRetry } });

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('always offers a labelled dismiss', async () => {
    const onClose = vi.fn();
    render(Toast, { props: { message: 'Failed', onClose } });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets the message take the room', () => {
    render(Toast, { props: { message: 'Failed' } });

    expect(screen.getByText('Failed')).toHaveClass('grow');
  });
});
