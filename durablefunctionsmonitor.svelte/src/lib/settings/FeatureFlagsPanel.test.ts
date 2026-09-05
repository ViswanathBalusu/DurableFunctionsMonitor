// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities } from '$lib/api/types';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import FeatureFlagsPanel, { REPORTED_BY_BACKEND } from './FeatureFlagsPanel.svelte';

function mount(
  options: {
    capabilities?: Partial<Capabilities>;
    readOnly?: boolean;
    dangerous?: boolean;
    functionGraph?: boolean;
  } = {},
) {
  return render(ScreenHarness, {
    props: {
      screen: FeatureFlagsPanel,
      path: '/DurableFunctionsHub/settings',
      capabilities: options.capabilities ?? {},
      readOnly: options.readOnly ?? false,
      dangerous: options.dangerous ?? false,
      host: options.functionGraph ? { functionGraphAvailable: true } : {},
    },
  });
}

/** The `<dd>` that follows the given term. */
function value(term: string): HTMLElement {
  const dt = Array.from(document.querySelectorAll('dl.kv dt')).find((node) => node.textContent === term);

  expect(dt, `no row named ${term}`).toBeDefined();

  return dt?.nextElementSibling as HTMLElement;
}

/** The chips of one row, with whether each reads as on. */
function chips(term: string): { text: string; on: boolean }[] {
  return Array.from(value(term).querySelectorAll('.chip')).map((chip) => ({
    text: chip.textContent?.trim() ?? '',
    on: chip.classList.contains('st-completed'),
  }));
}

describe('Feature flags panel', () => {
  it('shows the two flags as switches that cannot be moved', () => {
    mount({ readOnly: true, dangerous: true });

    expect(screen.getByRole('heading', { name: 'Feature flags', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('from /about');

    const readOnly = screen.getByRole('switch', { name: /Read-only mode/ });

    expect(readOnly).toHaveAttribute('aria-checked', 'true');
    expect(readOnly).toBeDisabled();
    expect(readOnly).toHaveAttribute('aria-disabled', 'true');
    expect(readOnly).toHaveAttribute('title', REPORTED_BY_BACKEND);
    expect(readOnly.textContent).toContain('no ReadWrite permission');

    const dangerous = screen.getByRole('switch', { name: /Dangerous operations/ });

    expect(dangerous).toHaveAttribute('aria-checked', 'true');
    expect(dangerous.textContent).toContain('DFM_DANGEROUS_OPERATIONS_ENABLED');
  });

  it('reads the flags off /about rather than off a setting of its own', () => {
    mount({ readOnly: false, dangerous: false });

    expect(screen.getByRole('switch', { name: /Read-only mode/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /Dangerous operations/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('says what the storage supports, on and off', () => {
    mount({ capabilities: { updateInput: true, truncateHistory: false } });

    expect(chips('storageSupports')).toEqual([
      { text: 'updateInput', on: true },
      { text: 'truncateHistory', on: false },
    ]);

    expect(value('storageSupports').querySelectorAll('.chip.muted')).toHaveLength(1);
  });

  it('renders exactly the true capabilities as chips', () => {
    mount({
      capabilities: {
        stats: true,
        children: false,
        spans: true,
        failures: false,
        batch: true,
        storageHealth: false,
        audit: false,
        entities: true,
        conditionalGet: true,
        // Governed by the Hub administration panel, and not listed here
        purgeHistory: true,
        deleteTaskHub: true,
      },
    });

    expect(chips('capabilities').map((chip) => chip.text)).toEqual([
      'stats',
      'spans',
      'batch',
      'entities',
      'conditionalGet',
    ]);
  });

  it('says none rather than an empty line when the backend announces nothing', () => {
    mount();

    expect(chips('capabilities')).toEqual([]);
    expect(value('capabilities').textContent?.trim()).toBe('none');
  });

  it('says whether the host published a function graph', () => {
    const without = mount();

    expect(chips('function graph')).toEqual([{ text: 'not available', on: false }]);

    without.unmount();

    mount({ functionGraph: true });

    expect(chips('function graph')).toEqual([{ text: 'available', on: true }]);
  });
});
