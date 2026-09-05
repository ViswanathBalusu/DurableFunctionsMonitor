// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OK_TIMEOUT_MS, Toasts } from './toast.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Toasts', () => {
  it('shows nothing until something happens', () => {
    expect(new Toasts().current).toBeNull();
  });

  it('lets a success go after five seconds', () => {
    const toasts = new Toasts();

    toasts.ok('Terminated order-1');
    expect(toasts.current).toMatchObject({ kind: 'ok', message: 'Terminated order-1' });

    vi.advanceTimersByTime(OK_TIMEOUT_MS - 1);
    expect(toasts.current).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(toasts.current).toBeNull();
  });

  it('keeps a failure until it is dismissed', () => {
    const toasts = new Toasts();

    toasts.error('Could not terminate order-1');

    vi.advanceTimersByTime(OK_TIMEOUT_MS * 10);
    expect(toasts.current?.kind).toBe('error');

    toasts.dismiss();
    expect(toasts.current).toBeNull();
  });

  it('carries a retry only when the caller gave one', () => {
    const toasts = new Toasts();
    const retry = vi.fn();

    toasts.error('Could not load', { retry });
    expect(toasts.current?.retry).toBe(retry);

    toasts.error('Could not load');
    expect(toasts.current?.retry).toBeUndefined();
  });

  it('shows one toast at a time: the newest replaces', () => {
    const toasts = new Toasts();

    const first = toasts.ok('Suspended order-1');
    const second = toasts.ok('Resumed order-1');

    expect(toasts.current?.id).toBe(second.id);
    expect(second.id).toBeGreaterThan(first.id);
  });

  it('does not let a replaced timer take the toast that replaced it', () => {
    const toasts = new Toasts();

    toasts.ok('Suspended order-1');
    vi.advanceTimersByTime(OK_TIMEOUT_MS - 10);

    toasts.error('Could not resume order-1');
    vi.advanceTimersByTime(20);

    // The first toast's five seconds are up, but the error that replaced it stays
    expect(toasts.current?.kind).toBe('error');
  });

  it('builds the message of a failure from its error', () => {
    const toasts = new Toasts();

    toasts.fromError('Could not terminate order-1', new Error('404 Not Found'));
    expect(toasts.current?.message).toBe('Could not terminate order-1. 404 Not Found');

    // Something thrown that is not an Error, and something thrown with nothing to say
    toasts.fromError('Could not load', 'network down');
    expect(toasts.current?.message).toBe('Could not load. network down');

    toasts.fromError('Could not load', new Error(''));
    expect(toasts.current?.message).toBe('Could not load');
  });

  it('passes the retry through fromError', () => {
    const toasts = new Toasts();
    const retry = vi.fn();

    toasts.fromError('Could not load', new Error('500'), retry);

    expect(toasts.current?.retry).toBe(retry);
    expect(toasts.current?.kind).toBe('error');
  });
});
