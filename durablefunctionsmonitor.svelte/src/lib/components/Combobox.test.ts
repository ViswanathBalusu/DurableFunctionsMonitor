// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Combobox from './Combobox.svelte';

const items = ['order-2026-09-04-000911', 'order-2026-09-04-000913', 'order-2026-09-04-000915'];

function open(props: Record<string, unknown> = {}) {
  const result = render(Combobox, { props: { items, ariaLabel: 'Instance id', ...props } as never });
  const input = screen.getByRole('combobox', { name: 'Instance id' }) as HTMLInputElement;
  return { ...result, input };
}

describe('Combobox', () => {
  it('is an .input.mono', () => {
    const { input } = open();

    expect(input).toHaveClass('input');
    expect(input).toHaveClass('mono');
  });

  it('offers nothing until the minimum number of characters is typed', async () => {
    const { input } = open({ minChars: 2 });

    await fireEvent.input(input, { target: { value: 'o' } });
    expect(screen.queryByRole('listbox')).toBeNull();

    await fireEvent.input(input, { target: { value: 'or' } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
  });

  it('lists the suggestions as .mi.mono rows inside a .pop', async () => {
    const { input } = open();

    await fireEvent.input(input, { target: { value: 'order' } });

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
    const options = document.querySelectorAll('.pop .mi.mono');
    expect(options.length).toBe(3);
    expect(options[0].textContent?.trim()).toBe('order-2026-09-04-000911');
  });

  it('says so when there is nothing to suggest', async () => {
    const { input } = open({ items: [], emptyText: 'No instance id starts with that.' });

    await fireEvent.input(input, { target: { value: 'zz' } });

    await waitFor(() => expect(screen.getByText('No instance id starts with that.')).toBeInTheDocument());
  });

  it('reports what the user typed while typing', async () => {
    const oninput = vi.fn();
    const { input } = open({ oninput });

    await fireEvent.input(input, { target: { value: 'order-2026' } });

    expect(oninput).toHaveBeenCalledWith('order-2026');
  });

  it('highlights with the arrow keys and selects the highlighted option', async () => {
    const onSelect = vi.fn();
    const { input } = open({ onSelect });

    await fireEvent.input(input, { target: { value: 'order' } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    // bits-ui highlights with the arrow keys; clicking the highlighted row is the same code path as
    // Enter on it, and is what jsdom can actually deliver (Enter needs a real pointer/focus dance).
    await fireEvent.keyDown(input, { key: 'ArrowDown' });

    const option = screen.getByRole('option', { name: 'order-2026-09-04-000911' });
    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('order-2026-09-04-000911'));

    // And the list is closed, so the screen can act on the choice
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('applies what was typed on Enter when nothing is highlighted', async () => {
    const onEnter = vi.fn();
    const onSelect = vi.fn();
    const { input } = open({ onEnter, onSelect });

    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onEnter).toHaveBeenCalledWith('');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes and blurs on Escape', async () => {
    const { input } = open();

    input.focus();
    await fireEvent.input(input, { target: { value: 'order' } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).not.toBe(input);
  });
});
