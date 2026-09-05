// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import type { Capabilities } from '$lib/api/types';
import { ACTIVITY_NOTE } from '$lib/functions/FunctionsTable.svelte';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Functions, { NODE_LEGEND } from './Functions.svelte';
import { functionMap as functionMapFixture } from '../../tests/unit/fixtures/function-map';
import { stats as statsFixture } from '../../tests/unit/fixtures/stats';

function mount(
  options: {
    path?: string;
    capabilities?: Partial<Capabilities>;
    functionGraph?: boolean;
    viewMode?: 0 | 1;
    isVsCode?: boolean;
    saveAs?: (svg: string, name: string) => Promise<void>;
    saveJson?: () => Promise<void>;
    gotoFunctionCode?: (name: string) => Promise<void>;
  } = {},
) {
  return render(ScreenHarness, {
    props: {
      screen: Functions,
      path: options.path ?? '/DurableFunctionsHub/functions',
      capabilities: options.capabilities ?? { stats: true },
      host: {
        functionGraphAvailable: options.functionGraph ?? true,
        viewMode: options.viewMode ?? 0,
      },
      client: {
        isVsCode: options.isVsCode ?? false,
        host: {
          saveAs: options.saveAs ?? (async () => {}),
          saveFunctionGraphAsJson: options.saveJson ?? (async () => {}),
          gotoFunctionCode: options.gotoFunctionCode ?? (async () => {}),
        },
      } as unknown as Partial<BackendClient>,
      endpoints: {
        stats: async () => statsFixture(),
        functionMap: async () => functionMapFixture(),
      },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/** One column of every row of the table, by the label its cells carry. */
function column(label: string): string[] {
  return Array.from(document.querySelectorAll(`tbody td[data-label="${label}"]`)).map(
    (cell) => cell.textContent?.trim() ?? '',
  );
}

describe('Functions: the page', () => {
  it('is the page of the mockup: the title, the range and the layout segment', async () => {
    mount();

    expect(document.querySelector('section.page[data-screen-label="Functions"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Functions', level: 1 })).toHaveClass('display');
    expect(screen.getByRole('button', { name: 'Time range' })).toHaveTextContent('Last 24 hours');

    const segment = screen.getByRole('group', { name: 'Layout' });

    expect(Array.from(segment.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      'Table',
      'Both',
      'Graph',
    ]);

    await waitFor(() => expect(document.querySelector('tbody tr')).not.toBeNull());

    expect(document.querySelector('.page > .two')?.className).toBe('two');
  });

  it('shows one half at a time, and says which in the URL', async () => {
    const rendered = mount();

    await waitFor(() => expect(document.querySelector('tbody tr')).not.toBeNull());

    await screen.getByRole('button', { name: 'Table' }).click();

    await waitFor(() => expect(document.querySelector('.page > .two')).toHaveClass('single'));

    expect(appOf(rendered).router.current.query.get('layout')).toBe('table');
    expect(document.querySelector('.graph')).toBeNull();

    await screen.getByRole('button', { name: 'Graph' }).click();

    await waitFor(() => expect(document.querySelector('table.tbl')).toBeNull());

    expect(appOf(rendered).router.current.query.get('layout')).toBe('graph');
  });

  it('is the table alone when the host publishes no function map', async () => {
    mount({ functionGraph: false, path: '/DurableFunctionsHub/functions?layout=graph' });

    await waitFor(() => expect(document.querySelector('tbody tr')).not.toBeNull());

    expect(document.querySelector('.graph')).toBeNull();

    // There is no choice to offer when there is only one half
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
  });

  it('is the graph alone when the backend does not count', async () => {
    mount({ capabilities: {} });

    await waitFor(() => expect(document.querySelector('.graph')).not.toBeNull());

    expect(document.querySelector('table.tbl')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
  });
});

describe('Functions: the table', () => {
  it('is the columns of the mockup, spined in the orchestrator colour', async () => {
    mount();

    await waitFor(() => expect(document.querySelector('tbody tr')).not.toBeNull());

    expect(Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim())).toEqual([
      '',
      'orchestrator',
      'started',
      'completed',
      'failed',
      'rate',
      'p50',
      'p95',
      'last failure',
    ]);

    expect(document.querySelector('tbody td.spine')?.getAttribute('style')).toContain('var(--node-orchestrator)');

    // Sorted by started, busiest first
    expect(column('started')).toEqual(['1,102', '1,096', '24', '7']);
  });

  it('says what the numbers cannot cover, and how much was scanned', async () => {
    mount();

    await waitFor(() => expect(document.querySelector('.tfoot .fine.muted')?.textContent).toBe('scanned 1,229 · full'));

    expect(document.querySelector('.tfoot .meta')?.textContent).toBe(ACTIVITY_NOTE);
  });

  it('selects the row that was clicked, and marks it', async () => {
    const rendered = mount();

    await waitFor(() => expect(document.querySelector('tbody tr')).not.toBeNull());

    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr'));

    await rows[0].click();

    await waitFor(() => expect(rows[0]).toHaveClass('hl'));

    expect(appOf(rendered).router.current.query.get('selected')).toBe('ProcessOrderOrchestrator');
    expect(rows[1]).not.toHaveClass('hl');
  });

  it('opens the instances of a name without selecting the row', async () => {
    const rendered = mount();

    await waitFor(() => expect(document.querySelector('tbody tr')).not.toBeNull());

    await screen.getByRole('button', { name: 'ReconcileLedgerOrchestrator' }).click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('instances');
    expect(route.query.get('name')).toBe('ReconcileLedgerOrchestrator');
    expect(route.query.get('selected')).toBeNull();
  });
});

describe('Functions: the graph', () => {
  it('draws a card per function, with the counters the range gave them', async () => {
    mount();

    await waitFor(() => expect(document.querySelectorAll('.graph .node').length).toBeGreaterThan(0));

    const orchestrator = Array.from(document.querySelectorAll('.graph .node')).find((card) =>
      card.textContent?.includes('ProcessOrderOrchestrator'),
    );

    expect(orchestrator).toHaveClass('n-orchestrator');
    expect(Array.from(orchestrator?.querySelectorAll('.metrics .mini') ?? []).map((n) => n.textContent)).toEqual([
      '1080',
      '3',
      '19',
    ]);
  });

  it('names the seven kinds of card under it', async () => {
    mount();

    await waitFor(() => expect(document.querySelector('.legend')).not.toBeNull());

    const legend = Array.from(document.querySelectorAll('.legend > span'));

    expect(legend.map((item) => item.textContent?.trim())).toEqual(NODE_LEGEND.map((node) => node.label));
    expect(legend[0].querySelector('i')?.getAttribute('style')).toContain('var(--node-http)');
  });

  it('saves the picture under the hub it belongs to', async () => {
    const saveAs = vi.fn<(svg: string, name: string) => Promise<void>>(async () => {});

    // The webview cannot write a file itself, so the string goes over the bridge and can be read here
    mount({ saveAs, isVsCode: true });

    await waitFor(() => expect(document.querySelectorAll('.graph .node').length).toBeGreaterThan(0));

    await screen.getByRole('button', { name: 'Save as SVG' }).click();

    await waitFor(() => expect(saveAs).toHaveBeenCalledOnce());

    expect(saveAs.mock.calls[0][1]).toBe('DurableFunctionsHub-functions.svg');
    expect(saveAs.mock.calls[0][0]).toContain('<svg');
  });

  it('offers the project the picture comes from, and only where it can be opened', async () => {
    const browser = mount();

    await waitFor(() => expect(document.querySelector('.legend')).not.toBeNull());

    expect(screen.getByRole('button', { name: 'az-func-as-a-graph' })).toBeInTheDocument();

    browser.unmount();

    mount({ isVsCode: true });

    await waitFor(() => expect(document.querySelector('.legend')).not.toBeNull());

    expect(screen.queryByRole('button', { name: 'az-func-as-a-graph' })).toBeNull();
    expect(document.querySelector('.meta.mono')?.textContent).toContain('az-func-as-a-graph');
  });
});

describe('Functions: the VS Code function-graph view', () => {
  it('is the graph and nothing else, whatever the URL asks for', async () => {
    mount({ viewMode: 1, isVsCode: true, path: '/DurableFunctionsHub/functions?layout=table' });

    await waitFor(() => expect(document.querySelector('.graph')).not.toBeNull());

    expect(document.querySelector('table.tbl')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
  });

  it('lets the extension save the map itself', async () => {
    const saveJson = vi.fn(async () => {});

    mount({ viewMode: 1, isVsCode: true, saveJson });

    await waitFor(() => expect(document.querySelector('.legend')).not.toBeNull());

    await screen.getByRole('button', { name: 'Save as JSON' }).click();

    expect(saveJson).toHaveBeenCalledOnce();
  });

  it('offers no JSON to save in the browser, which has nowhere to put it', async () => {
    mount();

    await waitFor(() => expect(document.querySelector('.legend')).not.toBeNull());

    expect(screen.queryByRole('button', { name: 'Save as JSON' })).toBeNull();
  });

  it('opens the code of a card that was double-clicked', async () => {
    const gotoFunctionCode = vi.fn(async () => {});

    mount({ viewMode: 1, isVsCode: true, gotoFunctionCode });

    await waitFor(() => expect(document.querySelectorAll('.graph .node').length).toBeGreaterThan(0));

    const card = Array.from(document.querySelectorAll('.graph .node')).find((node) =>
      node.textContent?.includes('ChargePayment'),
    ) as HTMLElement;

    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    await waitFor(() => expect(gotoFunctionCode).toHaveBeenCalledWith('ChargePayment'));
  });
});
