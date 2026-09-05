// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

async function openPalette(props: Record<string, unknown> = {}) {
  const view = render(ShellHarness, { props: { path: '/DurableFunctionsHub', ...props } });

  await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  await waitFor(() => expect(document.querySelector('.palette')).not.toBeNull());

  return view;
}

function input(): HTMLInputElement {
  // By its placeholder: bits-ui gives the input its own hidden label, which takes the accessible name
  return screen.getByPlaceholderText('Type a command, a screen or an instance id') as HTMLInputElement;
}

async function type(text: string) {
  await fireEvent.input(input(), { target: { value: text } });
  await waitFor(() => expect(input().value).toBe(text));
}

function rows(): string[] {
  return Array.from(document.querySelectorAll('.prow span:first-child')).map((label) => label.textContent ?? '');
}

function selectedRow(): string {
  return document.querySelector('.prow.sel')?.textContent?.trim() ?? '';
}

describe('CommandPalette', () => {
  it('is not in the DOM until it is asked for', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(document.querySelector('.palette')).toBeNull();
  });

  it('opens on Ctrl K over a transparent-to-clicks overlay, with its own footer', async () => {
    await openPalette();

    const palette = document.querySelector('.overlay.pal > .palette') as HTMLElement;
    expect(palette).not.toBeNull();
    expect(palette.getAttribute('role')).toBe('dialog');
    expect(palette.getAttribute('aria-modal')).toBe('true');

    expect(input().placeholder).toBe('Type a command, a screen or an instance id');
    expect(document.querySelector('.pfoot')?.textContent?.trim()).toBe(
      'Up and down to move · Enter to run · Esc to close · Ctrl K opens this anywhere',
    );
  });

  it('groups the rows as the mockup does', async () => {
    await openPalette();

    expect(Array.from(document.querySelectorAll('.grp')).map((g) => g.textContent)).toEqual([
      'Go to',
      'Actions',
      'Preferences',
    ]);

    expect(rows()).toContain('Overview');
    expect(rows()).toContain('Refresh');
    expect(rows()).toContain('Theme: Riso');
  });

  it('shows the chord and the current mark in the right-hand kbd', async () => {
    await openPalette();

    const instances = Array.from(document.querySelectorAll('.prow')).find((row) =>
      row.textContent?.startsWith('Instances'),
    );

    expect(instances?.querySelector('.kbd')?.textContent).toBe('g i');

    const poster = Array.from(document.querySelectorAll('.prow')).find((row) =>
      row.textContent?.startsWith('Theme: Poster'),
    );

    expect(poster?.querySelector('.kbd')?.textContent).toBe('current');
  });

  it('filters as the user types, and one row is left for a theme name', async () => {
    await openPalette();
    await type('riso');

    await waitFor(() => expect(rows()).toEqual(['Theme: Riso']));
    expect(Array.from(document.querySelectorAll('.grp')).map((g) => g.textContent)).toEqual(['Preferences']);
  });

  it('applies the theme on Enter and closes', async () => {
    await openPalette();
    await type('riso');
    await waitFor(() => expect(selectedRow()).toContain('Theme: Riso'));

    await fireEvent.keyDown(input(), { key: 'Enter' });

    await waitFor(() => expect(document.querySelector('.palette')).toBeNull());
    expect(document.documentElement.dataset.theme).toBe('riso');
  });

  it('moves the highlight with the arrow keys', async () => {
    await openPalette();

    await waitFor(() => expect(selectedRow()).toContain('Overview'));

    await fireEvent.keyDown(input(), { key: 'ArrowDown' });
    await waitFor(() => expect(selectedRow()).toContain('Instances'));

    await fireEvent.keyDown(input(), { key: 'ArrowUp' });
    await waitFor(() => expect(selectedRow()).toContain('Overview'));
  });

  it('moves the highlight with the pointer too', async () => {
    await openPalette();

    const entities = Array.from(document.querySelectorAll('.prow')).find((row) =>
      row.textContent?.startsWith('Entities'),
    ) as HTMLElement;

    await fireEvent.pointerMove(entities);

    await waitFor(() => expect(selectedRow()).toContain('Entities'));
  });

  it('runs a row on click', async () => {
    await openPalette();

    const entities = Array.from(document.querySelectorAll('.prow')).find((row) =>
      row.textContent?.startsWith('Entities'),
    ) as HTMLElement;

    await fireEvent.click(entities);

    expect(window.location.pathname).toBe('/DurableFunctionsHub/entities');
    await waitFor(() => expect(document.querySelector('.palette')).toBeNull());
  });

  it('says so when nothing matches', async () => {
    await openPalette();
    await type('zzz');

    await waitFor(() => expect(rows()).toEqual([]));
    expect(screen.getByText('Nothing matches. Try a screen, a theme name or an instance id.')).toHaveClass('meta');
  });

  it('offers the instance ids the backend suggests', async () => {
    await openPalette({ suggestions: ['order-1', 'order-2'] });
    await type('order');

    await waitFor(() => expect(rows()).toContain('Instance order-1'));
    expect(rows()).toContain('Instance order-2');
  });

  it('closes on Escape and on a click outside', async () => {
    await openPalette();

    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.palette')).toBeNull());

    await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.querySelector('.palette')).not.toBeNull());

    await fireEvent.click(document.querySelector('.overlay.pal') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.palette')).toBeNull());
  });

  it('toggles shut on a second Ctrl K, and starts empty the next time', async () => {
    await openPalette();
    await type('riso');

    await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.querySelector('.palette')).toBeNull());

    await fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.querySelector('.palette')).not.toBeNull());

    expect(input().value).toBe('');
  });

  it('opens the hub menu from Switch task hub', async () => {
    await openPalette({ hubNames: ['DurableFunctionsHub', 'OtherHub'] });

    const row = Array.from(document.querySelectorAll('.prow')).find((candidate) =>
      candidate.textContent?.startsWith('Switch task hub'),
    ) as HTMLElement;

    await fireEvent.click(row);

    expect(await screen.findByRole('menuitemradio', { name: /OtherHub/ })).toBeInTheDocument();
  });

  it('opens from the top bar button as well', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', onOpenPalette: () => {} } });

    await fireEvent.click(screen.getByRole('button', { name: 'Ctrl K' }));

    await waitFor(() => expect(document.querySelector('.palette')).not.toBeNull());
  });
});
