// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MenuItem from './MenuItem.svelte';
import PopHarness from '../../../tests/unit/harnesses/PopHarness.svelte';

describe('Pop', () => {
  it('wraps its trigger in an .anchor', () => {
    render(PopHarness, { props: { kind: 'menu' } });

    expect(screen.getByRole('button', { name: 'Actions' }).closest('.anchor')).not.toBeNull();
  });

  it('opens a menu of .mi items in a .pop', async () => {
    render(PopHarness, { props: { kind: 'menu' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
    expect(document.querySelectorAll('.pop .mi').length).toBe(2);
  });

  it('opens a popover with arbitrary content', async () => {
    render(PopHarness, { props: { kind: 'popover' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Columns' }));

    await waitFor(() => expect(screen.getByText('Column chooser')).toBeInTheDocument());
    expect(screen.getByText('Column chooser').closest('.pop')).not.toBeNull();
  });

  it('adds .right when it is end-aligned', async () => {
    render(PopHarness, { props: { kind: 'menu', align: 'end' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    await waitFor(() => expect(document.querySelector('.pop.right')).not.toBeNull());
  });

  it('passes the sizing the mockups set per popover', async () => {
    render(PopHarness, { props: { kind: 'popover', minWidth: '260px', padding: '10px' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Columns' }));

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
    const style = document.querySelector('.pop')?.getAttribute('style')?.replace(/\s/g, '') ?? '';
    expect(style).toContain('min-width:260px');
    expect(style).toContain('padding:10px');
  });

  it('closes on Escape', async () => {
    render(PopHarness, { props: { kind: 'menu' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());

    await fireEvent.keyDown(document.querySelector('.pop') as Element, { key: 'Escape' });

    await waitFor(() => expect(document.querySelector('.pop')).toBeNull());
  });
});

describe('MenuItem', () => {
  it('is a .mi menuitem', () => {
    render(MenuItem, { props: { children: undefined } as never });

    const item = screen.getByRole('menuitem');
    expect(item).toHaveClass('mi');
    expect(item.getAttribute('aria-checked')).toBeNull();
  });

  it('marks the active and destructive variants', () => {
    render(MenuItem, { props: { active: true, destructive: true } as never });

    const item = screen.getByRole('menuitem');
    expect(item).toHaveClass('active');
    expect(item).toHaveClass('destructive');
  });

  it('reports checked state for the two checkable roles', () => {
    const radio = render(MenuItem, { props: { role: 'menuitemradio', checked: true } as never });
    expect(screen.getByRole('menuitemradio').getAttribute('aria-checked')).toBe('true');
    radio.unmount();

    render(MenuItem, { props: { role: 'menuitemcheckbox', checked: false } as never });
    expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('false');
  });

  it('falls back to `active` when the caller only says which one is current', () => {
    render(MenuItem, { props: { role: 'menuitemradio', active: true } as never });

    expect(screen.getByRole('menuitemradio').getAttribute('aria-checked')).toBe('true');
  });

  it('renders the leading and meta snippets', () => {
    render(PopHarness, { props: { kind: 'item' } });

    const item = screen.getByRole('menuitem', { name: /Instances/ });
    expect(item.querySelector('.ico')).not.toBeNull();
    expect(item.querySelector('.meta')?.textContent?.trim()).toBe('g i');
    expect(item.querySelector('.meta')?.previousElementSibling).toHaveClass('grow');
  });

  it('clicks', async () => {
    const onclick = vi.fn();
    render(MenuItem, { props: { onclick } as never });

    await fireEvent.click(screen.getByRole('menuitem'));

    expect(onclick).toHaveBeenCalledOnce();
  });
});
