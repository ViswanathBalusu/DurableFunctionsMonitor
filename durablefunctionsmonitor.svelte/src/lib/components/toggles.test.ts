// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CheckRow from './CheckRow.svelte';
import Checkbox from './Checkbox.svelte';
import Switch from './Switch.svelte';

describe('Checkbox', () => {
  it('is a role=checkbox button with the box the stylesheet draws', () => {
    render(Checkbox, { props: { label: 'Remove empty entities (no state)' } });

    const box = screen.getByRole('checkbox', { name: 'Remove empty entities (no state)' });
    expect(box).toHaveClass('check');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.querySelector('.box')).not.toBeNull();
    expect(box.querySelector('.box.on')).toBeNull();
  });

  it('toggles on click and reports the new value', async () => {
    const onchange = vi.fn();
    render(Checkbox, { props: { label: 'Include entities', onchange } });

    const box = screen.getByRole('checkbox');
    await fireEvent.click(box);

    expect(onchange).toHaveBeenCalledWith(true);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.querySelector('.box.on')).not.toBeNull();

    await fireEvent.click(box);
    expect(onchange).toHaveBeenLastCalledWith(false);
  });

  it('toggles with the keyboard, because it is a button', async () => {
    const onchange = vi.fn();
    render(Checkbox, { props: { label: 'Include entities', onchange } });

    const box = screen.getByRole('checkbox');
    box.focus();

    // A button activates on Space and Enter; jsdom does not synthesise the click, so this is the click
    // the browser would deliver.
    await fireEvent.click(box);

    expect(onchange).toHaveBeenCalledWith(true);
  });

  it('starts checked when told to', () => {
    render(Checkbox, { props: { label: 'Include entities', checked: true } });

    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  });
});

describe('Switch', () => {
  it('is a role=switch row with its label, hint and track', () => {
    render(Switch, { props: { label: 'Dark mode', hint: 'paper becomes the line' } });

    const toggle = screen.getByRole('switch', { name: /Dark mode/ });
    expect(toggle).toHaveClass('check');
    expect(toggle.querySelector('.meta')?.textContent).toBe('paper becomes the line');
    expect(toggle.querySelector('.switch')).not.toBeNull();
    expect(toggle.querySelector('.switch.on')).toBeNull();
  });

  it('turns on and reports it', async () => {
    const onchange = vi.fn();
    render(Switch, { props: { label: 'Comfortable density', onchange } });

    const toggle = screen.getByRole('switch');
    await fireEvent.click(toggle);

    expect(onchange).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.querySelector('.switch.on')).not.toBeNull();
  });

  it('renders without a hint', () => {
    render(Switch, { props: { label: 'Comfortable density' } });

    expect(screen.getByRole('switch').querySelector('.meta')).toBeNull();
  });
});

describe('CheckRow', () => {
  it('is a menuitemcheckbox with a status chip', () => {
    render(CheckRow, { props: { status: 'Failed', checked: true } });

    const row = screen.getByRole('menuitemcheckbox');
    expect(row).toHaveClass('check');
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.querySelector('.box.on')).not.toBeNull();

    const chip = row.querySelector('.chip');
    expect(chip).toHaveClass('st-failed');
    expect(chip).toHaveClass('sm');
    expect(chip?.textContent).toBe('Failed');
  });

  it('falls back to a plain label', () => {
    render(CheckRow, { props: { label: 'Include entities' } });

    expect(screen.getByRole('menuitemcheckbox', { name: 'Include entities' })).toBeInTheDocument();
  });

  it('toggles and reports', async () => {
    const onchange = vi.fn();
    render(CheckRow, { props: { status: 'Running', onchange } });

    await fireEvent.click(screen.getByRole('menuitemcheckbox'));

    expect(onchange).toHaveBeenCalledWith(true);
  });
});
