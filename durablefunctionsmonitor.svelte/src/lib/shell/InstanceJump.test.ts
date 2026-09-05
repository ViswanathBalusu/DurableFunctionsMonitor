// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import { MAX_SUGGESTIONS, Suggestions } from '$lib/state/suggestions.svelte';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

function endpoints(idSuggestions: (prefix: string) => Promise<string[]>): Endpoints {
  return { idSuggestions } as unknown as Endpoints;
}

describe('Suggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks nothing until the prefix is long enough', async () => {
    const call = vi.fn(async () => ['order-1']);
    const suggestions = new Suggestions(endpoints(call), 150);

    suggestions.query('o');
    await vi.advanceTimersByTimeAsync(300);

    expect(call).not.toHaveBeenCalled();
    expect(suggestions.items).toEqual([]);
  });

  it('asks once for a burst of keystrokes', async () => {
    const call = vi.fn(async () => ['order-1', 'order-2']);
    const suggestions = new Suggestions(endpoints(call), 150);

    suggestions.query('or');
    suggestions.query('ord');
    suggestions.query('orde');
    await vi.advanceTimersByTimeAsync(300);

    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith('orde');
    expect(suggestions.items).toEqual(['order-1', 'order-2']);
  });

  it('shows at most six', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `order-${i}`);
    const suggestions = new Suggestions(
      endpoints(async () => many),
      150,
    );

    suggestions.query('order');
    await vi.advanceTimersByTimeAsync(300);

    expect(suggestions.items).toHaveLength(MAX_SUGGESTIONS);
  });

  it('ignores an answer that is no longer about what is being typed', async () => {
    const suggestions = new Suggestions(
      endpoints(async (prefix) => {
        // The first call is slow, the second fast: the slow answer must not win
        await new Promise((resolve) => setTimeout(resolve, prefix === 'or' ? 500 : 10));
        return [`${prefix}-result`];
      }),
      0,
    );

    suggestions.query('or');
    await vi.advanceTimersByTimeAsync(1);
    suggestions.query('ord');

    await vi.advanceTimersByTimeAsync(600);

    expect(suggestions.items).toEqual(['ord-result']);
  });

  it('says nothing when the lookup fails', async () => {
    const suggestions = new Suggestions(
      endpoints(async () => {
        throw new Error('offline');
      }),
      0,
    );

    suggestions.query('order');
    await vi.advanceTimersByTimeAsync(50);

    expect(suggestions.items).toEqual([]);
    expect(suggestions.loading).toBe(false);
  });

  it('forgets everything when cleared', async () => {
    const suggestions = new Suggestions(
      endpoints(async () => ['order-1']),
      150,
    );

    suggestions.query('order');
    suggestions.clear();
    await vi.advanceTimersByTimeAsync(300);

    expect(suggestions.items).toEqual([]);
  });
});

describe('InstanceJump', () => {
  it('is a labelled mono field with the mockup’s placeholder', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    const field = await screen.findByRole('combobox', { name: 'Find instance' });
    expect(field).toHaveClass('mono');
    expect(field.getAttribute('placeholder')).toBe('Find instance   /');
    expect(field.closest('.anchor')).toHaveClass('grow');
  });

  it('offers what the backend suggests and opens the chosen one', async () => {
    render(ShellHarness, {
      props: { path: '/DurableFunctionsHub', suggestions: ['order-2026-09-04-000911', 'order-2026-09-04-000913'] },
    });

    const field = await screen.findByRole('combobox', { name: 'Find instance' });
    await fireEvent.input(field, { target: { value: 'order' } });

    // By text, not by accessible name: the top bar's auto-refresh select puts its own options in the
    // same document, and the name lookup has to disambiguate across both listboxes.
    const option = (await screen.findByText('order-2026-09-04-000911', {}, { timeout: 2000 })).closest(
      '[role="option"]',
    ) as HTMLElement;
    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() =>
      expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-2026-09-04-000911'),
    );
  });

  it('opens the typed id on Enter when nothing was suggested', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', suggestions: [] } });

    const field = await screen.findByRole('combobox', { name: 'Find instance' });
    await fireEvent.input(field, { target: { value: 'order-typed-by-hand' } });
    await fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-typed-by-hand'));
  });

  it('can be focused from outside, which is what the / shortcut does', async () => {
    const { component } = render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    (component as unknown as { focusJump: () => void }).focusJump();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Find instance' })));
  });
});
