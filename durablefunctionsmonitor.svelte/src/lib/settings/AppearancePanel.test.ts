// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { AppState } from '$lib/state/app.svelte';
import { THEMES } from '$lib/themes';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import AppearancePanel, { THRESHOLDS_SAVED } from './AppearancePanel.svelte';

function mount(inVsCode = false) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: AppearancePanel,
      path: '/DurableFunctionsHub/settings',
      host: inVsCode ? { kind: 'vscode' as const } : {},
    },
  });

  return {
    ...rendered,
    app: (rendered.component as unknown as { appState: () => AppState }).appState(),
  };
}

function tile(label: string): HTMLElement {
  return screen.getByRole('radio', { name: new RegExp(`^${label}`) });
}

/** The colour as the DOM reports it back: jsdom rewrites every hex into rgb(). */
function rgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));

  return `rgb(${red}, ${green}, ${blue})`;
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('Appearance panel', () => {
  it('is the panel of ScreenSettings.dc.html L41-L60', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Appearance', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('dfm.theme · dfm.mode · dfm.density');

    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    const tiles = within(group).getAllByRole('radio');

    expect(tiles).toHaveLength(THEMES.length);

    // Four swatches: paper, ink, primary and the paper this theme uses in the dark
    const swatches = Array.from(tiles[0].querySelectorAll('.sw i')) as HTMLElement[];

    expect(swatches).toHaveLength(4);
    expect(swatches.map((swatch) => swatch.style.background)).toEqual(
      [THEMES[0].paper, THEMES[0].ink, THEMES[0].primary, THEMES[0].dark].map(rgb),
    );

    expect(tiles[0].textContent).toContain('Poster');
    expect(tiles[0].textContent).toContain('0 px · 2 px · 4 px');
  });

  it('applies the theme that is picked', async () => {
    const { app } = mount();

    await fireEvent.click(tile('Memphis'));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('memphis'));

    expect(app.prefs.theme).toBe('memphis');
    expect(tile('Memphis')).toHaveClass('active');
    expect(tile('Memphis')).toHaveAttribute('aria-checked', 'true');
    expect(tile('Poster')).toHaveAttribute('aria-checked', 'false');
  });

  it('switches the mode and the density, and says what each does', async () => {
    const { app } = mount();

    const dark = screen.getByRole('switch', { name: /Dark mode/ });

    expect(dark.textContent).toContain('paper becomes the line; shadows change color per theme');

    await fireEvent.click(dark);

    await waitFor(() => expect(app.prefs.mode).toBe('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await fireEvent.click(dark);
    await waitFor(() => expect(app.prefs.mode).toBe('light'));

    const density = screen.getByRole('switch', { name: /Comfortable density/ });

    expect(density.textContent).toContain('rows 44 px, controls 40 px');

    await fireEvent.click(density);

    await waitFor(() => expect(app.prefs.density).toBe('comfortable'));
    expect(document.documentElement.dataset.density).toBe('comfortable');
  });

  it('offers the webview the third answer a switch cannot give', async () => {
    const { app } = mount(true);

    expect(screen.queryByRole('switch', { name: /Dark mode/ })).toBeNull();

    const modes = screen.getByRole('group', { name: 'Dark mode' });

    expect(
      within(modes)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Follow VS Code', 'Light', 'Dark']);

    // 'system' means "whatever the editor is doing", which is where the webview starts
    expect(within(modes).getByRole('button', { name: 'Follow VS Code' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(within(modes).getByRole('button', { name: 'Dark' }));

    await waitFor(() => expect(app.prefs.mode).toBe('dark'));
  });

  it('chooses the clock every screen reads times in', async () => {
    const { app } = mount();

    const clock = screen.getByRole('group', { name: 'Show time as' });

    expect(within(clock).getByRole('button', { name: 'UTC' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(within(clock).getByRole('button', { name: 'Local' }));

    await waitFor(() => expect(app.prefs.showTimeAs).toBe('Local'));
  });

  it('opens the thresholds on what is saved, in the units of the mockup', () => {
    mount();

    expect(document.body.textContent).toContain('Needs attention thresholds');

    expect(field('Running longer than').value).toBe('1 h');
    expect(field('Pending older than').value).toBe('10 min');
    expect(field('Queue deeper than').value).toBe('1,000');

    for (const label of ['Running longer than', 'Pending older than', 'Queue deeper than']) {
      expect(field(label)).toHaveClass('mono');
      expect(field(label).getAttribute('aria-invalid')).toBe('false');
    }
  });

  it('will not save a threshold it cannot read', async () => {
    const { app } = mount();

    await fireEvent.input(field('Running longer than'), { target: { value: 'abc' } });

    await waitFor(() => expect(field('Running longer than').getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // The saved thresholds are untouched while the field is nonsense
    expect(app.prefs.thresholds.stuckMinutes).toBe(60);

    await fireEvent.input(field('Running longer than'), { target: { value: '2 h' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(field('Running longer than').getAttribute('aria-invalid')).toBe('false');
  });

  it('saves the three thresholds and writes them back in the unit they mean', async () => {
    const { app } = mount();

    await fireEvent.input(field('Running longer than'), { target: { value: '120' } });
    await fireEvent.input(field('Pending older than'), { target: { value: '2 d' } });
    await fireEvent.input(field('Queue deeper than'), { target: { value: '2,500' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(app.prefs.thresholds).toEqual({ stuckMinutes: 120, pendingMinutes: 2880, queueDepth: 2500 }),
    );

    expect(app.toast.current?.message).toBe(THRESHOLDS_SAVED);

    // `120` was minutes; it means two hours, and now says so
    await waitFor(() => expect(field('Running longer than').value).toBe('2 h'));
    expect(field('Pending older than').value).toBe('2 d');
    expect(field('Queue deeper than').value).toBe('2,500');
  });
});
