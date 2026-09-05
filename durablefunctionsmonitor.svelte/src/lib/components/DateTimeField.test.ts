// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DateTimeField from './DateTimeField.svelte';

/**
 * The vitest setup pins TZ to Etc/GMT-2, which is UTC+2 (the POSIX signs are inverted). So a local
 * clock reading 14:02 is 12:02 UTC, which is what these tests turn on.
 */
const ISO = '2026-09-04T12:02:00.000Z';

function segments(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-segment]')) as HTMLElement[];
}

function segment(part: string): HTMLElement {
  const found = segments().find((element) => element.getAttribute('data-segment') === part);
  if (!found) {
    throw new Error(`no ${part} segment; got ${segments().map((s) => s.getAttribute('data-segment'))}`);
  }
  return found;
}

describe('DateTimeField', () => {
  it('is an .input.mono 190px wide, as the mockups draw it', () => {
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From' } });

    const field = screen.getByLabelText('From');
    expect(field).toHaveClass('input');
    expect(field).toHaveClass('mono');
    expect(field.getAttribute('style')?.replace(/\s/g, '')).toContain('width:190px');
  });

  it('shows the instant in UTC by default', () => {
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From' } });

    expect(segment('hour').textContent).toBe('12');
    expect(segment('day').textContent).toBe('04');
  });

  it('shows the same instant on the local clock when asked', () => {
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From', showTimeAs: 'Local' } });

    // Etc/GMT-2 is UTC+2, so 12:02 UTC reads 14:02 locally
    expect(segment('hour').textContent).toBe('14');
  });

  it('emits UTC after a local edit', async () => {
    const onchange = vi.fn();
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From', showTimeAs: 'Local', onchange } });

    const hour = segment('hour');
    hour.focus();
    await fireEvent.keyDown(hour, { key: 'ArrowUp' });

    // 15:02 local is 13:02 UTC: the conversion happens on the way out, not in the segments
    expect(onchange).toHaveBeenCalledWith('2026-09-04T13:02:00.000Z');
  });

  it('emits UTC after a UTC edit', async () => {
    const onchange = vi.fn();
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From', onchange } });

    const hour = segment('hour');
    hour.focus();
    await fireEvent.keyDown(hour, { key: 'ArrowDown' });

    expect(onchange).toHaveBeenCalledWith('2026-09-04T11:02:00.000Z');
  });

  it('shows the placeholder instead of segments when there is no value', () => {
    render(DateTimeField, { props: { value: null, ariaLabel: 'To', placeholder: 'now' } });

    expect(screen.getByText('now')).toBeInTheDocument();
    expect(segments()).toHaveLength(0);
  });

  it('has minute granularity by default and seconds when asked', () => {
    const minute = render(DateTimeField, { props: { value: ISO, ariaLabel: 'From' } });
    expect(segments().some((s) => s.getAttribute('data-segment') === 'second')).toBe(false);
    minute.unmount();

    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From', granularity: 'second' } });
    expect(segments().some((s) => s.getAttribute('data-segment') === 'second')).toBe(true);
  });

  it('renders the enable checkbox unchecked and disables the field', () => {
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'To', enabled: false, enabledLabel: 'Till' } });

    const checkbox = screen.getByRole('checkbox', { name: 'Till' });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    expect(screen.getByLabelText('To').getAttribute('aria-disabled')).toBe('true');
  });

  it('reports the checkbox being turned on', async () => {
    const onEnabledChange = vi.fn();
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'To', enabled: false, onEnabledChange } });

    await fireEvent.click(screen.getByRole('checkbox'));

    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it('renders no checkbox when the caller does not ask for one', () => {
    render(DateTimeField, { props: { value: ISO, ariaLabel: 'From' } });

    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('ignores a value that is not a date', () => {
    render(DateTimeField, { props: { value: 'not-a-date', ariaLabel: 'From', placeholder: 'now' } });

    // The field does not throw and does not invent a date; it just has nothing to show
    expect(segments()).toHaveLength(0);
  });
});
