// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FormControlsHarness from '../../../tests/unit/harnesses/FormControlsHarness.svelte';
import Select from './Select.svelte';
import TextInput from './TextInput.svelte';

describe('TextInput', () => {
  it('is an .input and binds its value', async () => {
    render(TextInput, { props: { value: 'order-1', ariaLabel: 'Instance id' } as never });

    const input = screen.getByDisplayValue('order-1');
    expect(input).toHaveClass('input');

    await fireEvent.input(input, { target: { value: 'order-2' } });
    expect((input as HTMLInputElement).value).toBe('order-2');
  });

  it('adds mono for identifiers', () => {
    render(TextInput, { props: { value: 'order-1', mono: true } as never });

    expect(screen.getByDisplayValue('order-1')).toHaveClass('mono');
  });

  it('calls onEnter with the current value', async () => {
    const onEnter = vi.fn();
    render(TextInput, { props: { value: 'order-1', onEnter } as never });

    await fireEvent.keyDown(screen.getByDisplayValue('order-1'), { key: 'Enter' });

    expect(onEnter).toHaveBeenCalledWith('order-1');
  });

  it('does not swallow the caller’s own keydown handler', async () => {
    const onkeydown = vi.fn();
    render(TextInput, { props: { value: '', onkeydown } as never });

    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(onkeydown).toHaveBeenCalledOnce();
  });

  it('passes the placeholder and readonly through', () => {
    render(TextInput, {
      props: { value: '', placeholder: 'Leave empty for a generated GUID', readonly: true } as never,
    });

    const input = screen.getByPlaceholderText('Leave empty for a generated GUID');
    expect(input).toHaveAttribute('readonly');
  });
});

describe('Field', () => {
  it('labels the control it wraps', () => {
    render(FormControlsHarness, { props: { which: 'field' } });

    const input = screen.getByLabelText('Instance id');
    expect(input).toHaveClass('input');
    expect(input.closest('.field')).not.toBeNull();
  });
});

describe('Select', () => {
  const options = [
    { value: '1h', label: 'Last hour' },
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
  ];

  it('shows the label of the chosen option inside a .sel wrapper', () => {
    render(Select, { props: { options, value: '24h', ariaLabel: 'Time range' } as never });

    const trigger = screen.getByRole('button', { name: 'Time range' });
    expect(trigger).toHaveClass('input');
    expect(trigger.textContent?.trim()).toBe('Last 24 hours');
    expect(trigger.closest('.sel')).not.toBeNull();
  });

  it('renders as a filter chip when asked', () => {
    render(Select, { props: { options, value: '24h', ariaLabel: 'Time range', chip: true } as never });

    expect(screen.getByRole('button', { name: 'Time range' })).toHaveClass('fchip');
  });

  it('opens with the keyboard and chooses with Enter', async () => {
    const onchange = vi.fn();
    render(Select, { props: { options, value: '24h', ariaLabel: 'Time range', onchange } as never });

    const trigger = screen.getByRole('button', { name: 'Time range' });

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    // Clicking an option is what bits-ui listens for; pointerup is the event it selects on
    const option = screen.getByRole('option', { name: 'Last 7 days' });
    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() => expect(onchange).toHaveBeenCalledWith('7d'));
    expect(screen.getByRole('button', { name: 'Time range' }).textContent?.trim()).toBe('Last 7 days');
  });

  it('closes on Escape', async () => {
    render(Select, { props: { options, value: '24h', ariaLabel: 'Time range' } as never });

    const trigger = screen.getByRole('button', { name: 'Time range' });

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    await fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('lists the options in a .pop as .mi rows', async () => {
    render(Select, { props: { options, value: '24h', ariaLabel: 'Time range' } as never });

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Time range' }), { key: 'ArrowDown' });

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
    expect(document.querySelectorAll('.pop .mi').length).toBe(3);
  });

  it('honours the width the caller sets', () => {
    render(Select, { props: { options, value: '24h', ariaLabel: 'Time range', width: '190px' } as never });

    expect(
      screen.getByRole('button', { name: 'Time range' }).closest('.sel')?.getAttribute('style')?.replace(/\s/g, ''),
    ).toContain('width:190px');
  });
});
