// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Settings from './Settings.svelte';

function mount(path = '/DurableFunctionsHub/settings') {
  return render(ScreenHarness, { props: { screen: Settings, path } });
}

describe('Settings screen', () => {
  it('is the page of the mockup: the title, the hub and the account', () => {
    mount();

    expect(document.querySelector('section.page[data-screen-label="Settings"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toHaveClass('display');
    expect(document.querySelector('.ptitle .meta')?.textContent).toBe('DurableFunctionsHub · mystorageaccount');
  });

  it('lays the panels out in the two grids of ScreenSettings.dc.html L18 and L40', () => {
    mount();

    const grids = Array.from(document.querySelectorAll('.page > .two'));

    expect(grids.map((grid) => grid.className)).toEqual(['two', 'two wide-left']);

    // Every panel of ScreenSettings.dc.html except the mockup-only one, in the mockup's own order
    expect(Array.from(grids[0].querySelectorAll('.panel > .panel-h > h2')).map((h) => h.textContent)).toEqual([
      'Connection',
      'Hub administration',
    ]);

    expect(Array.from(grids[1].querySelectorAll('.panel > .panel-h > h2')).map((h) => h.textContent)).toEqual([
      'Appearance',
      'Feature flags',
      'Templates',
    ]);
  });
});
