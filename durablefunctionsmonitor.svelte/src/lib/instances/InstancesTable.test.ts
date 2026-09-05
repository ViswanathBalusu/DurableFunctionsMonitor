// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestrationStatus, OrchestrationsQuery } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instances from '../../routes/Instances.svelte';
import { entityInstances, instances as fixtures, page } from '../../../tests/unit/fixtures/instances';
import { baseColumns, displayName, durationOf, isSortable, toPeekItem } from './columns';

function mount(
  options: {
    rows?: OrchestrationStatus[];
    pages?: OrchestrationStatus[][];
    onQuery?: (q: OrchestrationsQuery) => void;
    downloadField?: (instanceId: string, field: string) => Promise<void>;
  } = {},
) {
  const pages = options.pages ?? [options.rows ?? fixtures];
  let call = 0;

  return render(ScreenHarness, {
    props: {
      screen: Instances,
      endpoints: {
        listOrchestrations: async (query: OrchestrationsQuery) => {
          options.onQuery?.(query);
          return pages[Math.min(call++, pages.length - 1)];
        },
        downloadField: options.downloadField ?? (async () => {}),
      },
    },
  });
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('table.tbl tbody tr'));
}

function headers(): string[] {
  return Array.from(document.querySelectorAll('table.tbl thead th')).map((th) => th.textContent?.trim() ?? '');
}

describe('columns', () => {
  it('sorts by what the backend can sort by, and by nothing else', () => {
    expect(isSortable('createdTime')).toBe(true);
    expect(isSortable('customStatus')).toBe(false);
    expect(isSortable('input')).toBe(false);
    expect(isSortable('output')).toBe(false);

    expect(baseColumns().map((column) => column.id)).toEqual([
      'instanceId',
      'name',
      'createdTime',
      'lastUpdatedTime',
      'runtimeStatus',
      'duration',
      'customStatus',
      'lastEvent',
      'parentInstanceId',
      'input',
      'output',
    ]);
  });

  it('names an entity by its entity name and gives it no duration', () => {
    const entity = entityInstances[0];

    expect(displayName(entity)).toBe('counter');
    expect(durationOf(entity)).toBeNull();
    expect(durationOf(fixtures[0])).toBe(47_000);
  });

  it('peeks a row with what the row already knows', () => {
    expect(toPeekItem(fixtures[2])).toMatchObject({
      id: 'order-2026-09-04-000911',
      name: 'ProcessOrderOrchestrator',
      kind: 'Orchestration',
      status: 'Failed',
      duration: 17_000,
    });

    // An entity's state is the input column it comes back in
    expect(toPeekItem(entityInstances[0]).state).toEqual({ value: 1284, lastSku: 'SKU-4471' });
  });
});

describe('InstancesTable', () => {
  it('draws the columns of the mockup, without the hidden ones', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    // The two selection columns come first, then the seven visible ones
    expect(headers().slice(2)).toEqual([
      'instanceId',
      'name',
      'createdTime',
      'lastUpdatedTime',
      'runtimeStatus',
      'duration',
      'customStatus',
    ]);
  });

  it('shows the row the way the mockup does', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    const running = rows()[0];
    expect(running).toHaveAttribute('data-st', 'Running');
    expect(running.querySelector('[data-label="instanceId"] .link')?.textContent?.trim()).toBe(
      'order-2026-09-04-000913',
    );
    expect(running.querySelector('[data-label="createdTime"]')?.textContent?.trim()).toBe('2026-09-04 14:02:11');
    expect(running.querySelector('[data-label="duration"]')?.textContent?.trim()).toBe('47 s');
    expect(running.querySelector('[data-label="runtimeStatus"] .chip')).toHaveClass('st-running');
  });

  it('marks an entity as one', async () => {
    mount({ rows: entityInstances });

    await waitFor(() => expect(rows()).toHaveLength(2));

    const row = rows()[0];
    expect(row.querySelector('[data-label="name"]')?.textContent?.trim()).toContain('counter');
    expect(row.querySelector('[data-label="name"] .chip')).toHaveClass('kind-entity');
    expect(row.querySelector('[data-label="duration"]')?.textContent?.trim()).toBe('—');
  });

  it('opens the peek on a row click, and the workspace on the id', async () => {
    const { component } = mount();
    const app = (component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    await fireEvent.click(rows()[1]);
    expect(app.peek.item?.id).toBe('order-2026-09-04-000912');

    app.peek.close();

    await fireEvent.click(rows()[1].querySelector('[data-label="instanceId"] .link') as HTMLElement);

    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-2026-09-04-000912');
    expect(app.peek.isOpen).toBe(false);
  });

  it('navigates in the app instead of letting the browser reload the page', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    const link = rows()[0].querySelector('[data-label="instanceId"] .link') as HTMLElement;
    const click = createEvent.click(link);

    fireEvent(link, click);

    // The href is real, so the link can be copied and opened in a new tab - but a plain click is ours
    expect(click.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-2026-09-04-000913');
  });

  it('sorts through the backend, and falls back to the default order on the third click', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());

    // The header's label is a button when the column can be sorted
    const header = screen.getByRole('button', { name: 'name' });

    await fireEvent.click(header);
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].orderBy).toBe('name'));

    await fireEvent.click(header);
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].orderBy).toBe('name desc'));

    await fireEvent.click(header);
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].orderBy).toBe('createdTime desc'));
  });

  it('flips the column it is sorted by, which has no unsorted state to fall back to', async () => {
    const onQuery = vi.fn();
    mount({ onQuery });

    await waitFor(() => expect(onQuery).toHaveBeenCalledOnce());
    expect(onQuery.mock.calls[0][0].orderBy).toBe('createdTime desc');

    const header = screen.getByRole('button', { name: 'createdTime' });

    await fireEvent.click(header);
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].orderBy).toBe('createdTime'));

    await fireEvent.click(header);
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].orderBy).toBe('createdTime desc'));

    await fireEvent.click(header);
    await waitFor(() => expect(onQuery.mock.calls.at(-1)?.[0].orderBy).toBe('createdTime'));
  });

  it('selects rows without opening anything', async () => {
    const { component } = mount();
    const app = (component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    await fireEvent.click(rows()[0].querySelector('.sel-cell .box') as HTMLElement);

    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
    expect(app.peek.isOpen).toBe(false);
  });

  it('says how many rows are shown, and offers more while there are more', async () => {
    const second = page(4).map((row, index) => ({ ...row, instanceId: `second-page-${index}` }));

    mount({ pages: [page(50), second] });

    await waitFor(() => expect(rows()).toHaveLength(50));
    expect(document.querySelector('.tfoot .meta')?.textContent).toContain('Showing 50');

    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(rows()).toHaveLength(54));
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('counts the hidden columns and shows them all again', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    expect(document.querySelector('.tfoot .meta')?.textContent).toContain('4 columns hidden');

    await fireEvent.click(screen.getByRole('button', { name: 'show all' }));

    await waitFor(() => expect(headers()).toContain('input'));
    expect(document.querySelector('.tfoot .meta')?.textContent).not.toContain('columns hidden');
  });
});

describe('the cell viewers', () => {
  it('opens customStatus pretty-printed and expanded, without opening the peek', async () => {
    const { component } = mount();
    const app = (component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(rows()).toHaveLength(fixtures.length));

    await fireEvent.click(rows()[0].querySelector('[data-label="customStatus"] .link') as HTMLElement);

    const dialog = await screen.findByRole('dialog', { name: 'customStatus' });

    expect(within(dialog).getByText('order-2026-09-04-000913')).toHaveClass('meta', 'mono');
    expect(dialog.querySelector('.jse-theme-dfm')).not.toBeNull();

    // Contracts §9: what the viewer holds is the pretty-printed value, which is what it copies
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        ['{', '  "step": "ChargePayment",', '  "attempt": 2', '}'].join('\n'),
      ),
    );

    // The cell is a link inside a clickable row, and the row keeps out of it
    expect(app.peek.isOpen).toBe(false);
  });

  it('saves a big field through the backend and says what it copied', async () => {
    const downloads: string[][] = [];
    const { component } = mount({
      rows: [fixtures[2]],
      downloadField: async (instanceId, field) => void downloads.push([instanceId, field]),
    });

    const app = (component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(rows()).toHaveLength(1));

    // output is one of the hidden columns, so it is shown first
    await fireEvent.click(screen.getByRole('button', { name: 'show all' }));
    await waitFor(() => expect(headers()).toContain('output'));

    await fireEvent.click(rows()[0].querySelector('[data-label="output"] .link') as HTMLElement);

    const dialog = await screen.findByRole('dialog', { name: 'output' });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(downloads).toEqual([['order-2026-09-04-000911', 'output']]));

    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() => expect(app.toast.current?.message).toBe('Copied output to the clipboard'));
  });
});
