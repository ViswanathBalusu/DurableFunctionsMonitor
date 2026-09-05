// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ButtonHarness from '../../../tests/unit/harnesses/ButtonHarness.svelte';

/** Renders <Button> / <LinkButton> with the props under test (a snippet child needs a wrapper). */
function renderButton(props: Record<string, unknown> = {}) {
  return render(ButtonHarness, { props: { which: 'button', label: 'Terminate', ...props } });
}

describe('Button', () => {
  it('is a .btn with the label', () => {
    renderButton();

    const button = screen.getByRole('button', { name: 'Terminate' });
    expect(button).toHaveClass('btn');
    expect(button.getAttribute('type')).toBe('button');
  });

  it.each([
    ['primary', 'btn primary'],
    ['secondary', 'btn secondary'],
    ['destructive', 'btn destructive'],
    ['danger', 'btn danger'],
    ['ghost', 'btn ghost'],
  ])('renders the %s variant as "%s"', (variant, expected) => {
    renderButton({ variant });

    expect(screen.getByRole('button').className).toBe(expected);
  });

  it('leaves the default variant unnamed, so `.btn` alone styles it', () => {
    renderButton({ variant: 'default' });

    expect(screen.getByRole('button').className).toBe('btn');
  });

  it('adds sm and flat', () => {
    renderButton({ size: 'sm', flat: true });

    const button = screen.getByRole('button');
    expect(button).toHaveClass('sm');
    expect(button).toHaveClass('flat');
  });

  it('passes a class through', () => {
    renderButton({ class: 'ml-auto-thing' });

    expect(screen.getByRole('button')).toHaveClass('ml-auto-thing');
  });

  it('calls onclick once', async () => {
    const onclick = vi.fn();
    renderButton({ onclick });

    await fireEvent.click(screen.getByRole('button'));

    expect(onclick).toHaveBeenCalledOnce();
  });

  it('is disabled through the attribute, so the stylesheet can style it', () => {
    renderButton({ disabled: true });

    // dfm-ui.css styles `.btn:disabled` (L100); nothing here fakes the disabled look with a class,
    // and a real browser will not deliver a click to it either.
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders a real anchor when href is given', () => {
    renderButton({ href: '/DurableFunctionsHub/instances' });

    const link = screen.getByRole('link', { name: 'Terminate' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveClass('btn');

    // A real link, not a button pretending to be one
    expect(link.getAttribute('role')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the icon snippet before the label', () => {
    renderButton({ withIcon: true });

    const button = screen.getByRole('button');
    expect(button.firstElementChild?.tagName).toBe('svg');
    expect(button.firstElementChild).toHaveClass('ico');
  });
});

describe('LinkButton', () => {
  it('is a .link button by default', () => {
    render(ButtonHarness, { props: { which: 'link', label: 'order-1' } });

    expect(screen.getByRole('button', { name: 'order-1' })).toHaveClass('link');
  });

  it('adds mono and muted', () => {
    render(ButtonHarness, { props: { which: 'link', label: 'order-1', mono: true, muted: true } });

    const link = screen.getByRole('button');
    expect(link).toHaveClass('mono');
    expect(link).toHaveClass('muted');
  });

  it('renders an anchor when href is given', () => {
    render(ButtonHarness, { props: { which: 'link', label: 'order-1', href: '/hub/instances/order-1' } });

    expect(screen.getByRole('link', { name: 'order-1' }).tagName).toBe('A');
  });

  it('keeps its click to itself inside a clickable row when asked', async () => {
    const onclick = vi.fn();
    const onRowClick = vi.fn();

    render(ButtonHarness, { props: { which: 'link', label: 'order-1', stopPropagation: true, onclick, onRowClick } });

    await fireEvent.click(screen.getByRole('button', { name: 'order-1' }));

    expect(onclick).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('lets the row take the click when it does not', async () => {
    const onRowClick = vi.fn();

    render(ButtonHarness, { props: { which: 'link', label: 'order-1', onRowClick } });

    await fireEvent.click(screen.getByRole('button', { name: 'order-1' }));

    expect(onRowClick).toHaveBeenCalledOnce();
  });
});
