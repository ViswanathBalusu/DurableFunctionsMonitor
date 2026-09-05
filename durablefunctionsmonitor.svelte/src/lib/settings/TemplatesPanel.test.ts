// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { About, Templates } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import TemplatesPanel, { customMetaLine, functionMapLine, liquidTabsLine } from './TemplatesPanel.svelte';

function templates(overrides: Partial<Templates> = {}): Templates {
  return {
    functionMapAvailable: false,
    functionCount: null,
    liquidTabs: [],
    customMetaTag: false,
    ...overrides,
  };
}

function mount(about: Partial<About> = {}) {
  return render(ScreenHarness, {
    props: { screen: TemplatesPanel, path: '/DurableFunctionsHub/settings', about },
  });
}

/** The `<dd>` that follows the given term. */
function value(term: string): HTMLElement {
  const dt = Array.from(document.querySelectorAll('dl.kv dt')).find((node) => node.textContent === term);

  expect(dt, `no row named ${term}`).toBeDefined();

  return dt?.nextElementSibling as HTMLElement;
}

describe('templates lines', () => {
  it('names the function map and counts what is in it', () => {
    expect(functionMapLine(templates({ functionMapAvailable: true, functionCount: 12 }))).toBe(
      'function-map.json · 12 functions',
    );

    // A map that is there but was not counted is still a map
    expect(functionMapLine(templates({ functionMapAvailable: true }))).toBe('function-map.json');
    expect(functionMapLine(templates({ functionCount: 12 }))).toBe('none');
    expect(functionMapLine(templates())).toBe('none');
  });

  it('lists the Liquid tabs the way the tab strip shows them', () => {
    expect(liquidTabsLine(templates({ liquidTabs: ['OrderSummary.liquid', 'LedgerReport.liquid'] }))).toBe(
      'OrderSummary.liquid · LedgerReport.liquid',
    );

    expect(liquidTabsLine(templates())).toBe('none');
  });

  it('says whether the hub replaced the meta tag', () => {
    expect(customMetaLine(templates({ customMetaTag: true }))).toBe('durable-functions-monitor-meta · custom');
    expect(customMetaLine(templates())).toBe('durable-functions-monitor-meta · CSP default');
  });
});

describe('Templates panel', () => {
  it('renders what /about reported about this hub', () => {
    mount({
      templates: templates({
        functionMapAvailable: true,
        functionCount: 12,
        liquidTabs: ['OrderSummary.liquid', 'LedgerReport.liquid'],
      }),
    });

    expect(screen.getByRole('heading', { name: 'Templates', level: 2 })).toBeInTheDocument();

    expect(value('function map').textContent).toBe('function-map.json · 12 functions');
    expect(value('function map')).toHaveClass('mono');
    expect(value('Liquid tabs').textContent).toBe('OrderSummary.liquid · LedgerReport.liquid');
    expect(value('custom meta').textContent).toBe('durable-functions-monitor-meta · CSP default');
  });

  it('says none for a hub that adds nothing', () => {
    mount();

    expect(value('function map').textContent).toBe('none');
    expect(value('Liquid tabs').textContent).toBe('none');
  });

  it('says nothing at all until /about has answered', () => {
    const rendered = mount();
    const app = (rendered.component as unknown as { appState: () => AppState }).appState();

    app.about = null;
    rendered.rerender({ screen: TemplatesPanel });

    for (const term of ['function map', 'Liquid tabs', 'custom meta']) {
      expect(value(term).textContent).toBe('—');
    }
  });
});
