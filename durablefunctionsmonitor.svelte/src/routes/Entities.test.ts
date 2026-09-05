// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities, EntitiesQuery, EntitiesResponse, OrchestrationStatus } from '$lib/api/types';
import { NO_STATE_NOTE, STATE_NOTE } from '$lib/entities/EntitiesTable.svelte';
import { READ_ONLY_REASON, UNSUPPORTED_REASON } from '$lib/settings/HubAdminPanel.svelte';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Entities, { NO_ENTITIES_TEXT, NO_ENTITIES_TITLE } from './Entities.svelte';
import { entities as entitiesFixture, entityRow } from '../../tests/unit/fixtures/entities';
import { entity } from '../../tests/unit/fixtures/instances';
import { stats as statsFixture } from '../../tests/unit/fixtures/stats';

/** What /stats says about the hub's entities: 212 of them under three names (the mockup's L19). */
const ENTITY_STATS = statsFixture({
  totals: { ...statsFixture().totals, entities: 212 },
  entitiesByName: [
    { name: 'counter', count: 204 },
    { name: 'cartaggregate', count: 6 },
    { name: 'tenantlock', count: 2 },
  ],
});

function mount(
  options: {
    path?: string;
    response?: EntitiesResponse;
    /** A different answer per call, for the paging test. */
    answer?: () => EntitiesResponse;
    rows?: OrchestrationStatus[];
    capabilities?: Partial<Capabilities>;
    readOnly?: boolean;
    stats?: boolean;
  } = {},
) {
  const queries: EntitiesQuery[] = [];

  const rendered = render(ScreenHarness, {
    props: {
      screen: Entities,
      path: options.path ?? '/DurableFunctionsHub/entities',
      capabilities: options.capabilities ?? { entities: true, stats: true, cleanEntityStorage: true },
      readOnly: options.readOnly ?? false,
      endpoints: {
        entities: async (query: EntitiesQuery = {}) => {
          queries.push(query);

          return options.answer ? options.answer() : (options.response ?? entitiesFixture());
        },
        listOrchestrations: async () => options.rows ?? [],
        stats: async () => (options.stats === false ? statsFixture() : ENTITY_STATS),
        cleanEntityStorage: async () => ({ numberOfEmptyEntitiesRemoved: 7, numberOfOrphanedLocksRemoved: 0 }),
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app, queries };
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.tbl tbody tr'));
}

function cells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** Renders the screen and waits for the rows the backend answered with. */
async function mounted(options: Parameters<typeof mount>[0] = {}) {
  const rendered = mount(options);
  const expected = options.rows?.length ?? (options.response ?? entitiesFixture()).entities.length;

  await waitFor(() => expect(rows()).toHaveLength(expected));

  return rendered;
}

describe('Entities: the title row', () => {
  it('counts the hub and offers the one destructive operation of the screen', async () => {
    await mounted();

    expect(document.querySelector('section.page[data-screen-label="Entities"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Entities', level: 1 })).toHaveClass('display');

    // ScreenEntities.dc.html L19: the hub's numbers, not the page's
    await waitFor(() =>
      expect(document.querySelector('.ptitle .meta')?.textContent).toBe('212 durable entities · 3 entity names'),
    );

    const clean = screen.getByRole('button', { name: 'Clean entity storage' });

    expect(clean).toHaveClass('btn', 'destructive');
    expect(clean).toBeEnabled();
  });

  it('says what it counted itself when there is no /stats to ask', async () => {
    await mounted({ capabilities: { entities: true } });

    expect(document.querySelector('.ptitle .meta')?.textContent).toBe('3 durable entities · 2 entity names');
  });

  it('opens the same clean dialog Settings opens', async () => {
    const { app } = await mounted();

    await fireEvent.click(screen.getByRole('button', { name: 'Clean entity storage' }));

    const dialog = await screen.findByRole('dialog', { name: 'Clean entity storage' });

    expect(dialog).toHaveTextContent('Scans the Instances table for entities that hold no state');

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Clean entity storage' }));

    await waitFor(() =>
      expect(app.toast.current?.message).toBe('Cleaned entity storage: 7 empty entities removed, 0 locks released'),
    );
  });

  it('will not offer a clean the backend or the mode refuses', async () => {
    await mounted({ readOnly: true });

    const clean = screen.getByRole('button', { name: 'Clean entity storage' });

    expect(clean).toBeDisabled();
    expect(clean).toHaveAttribute('title', READ_ONLY_REASON);
  });

  it('says so when the backend cannot clean at all', async () => {
    await mounted({ capabilities: { entities: true, stats: true } });

    expect(screen.getByRole('button', { name: 'Clean entity storage' })).toHaveAttribute('title', UNSUPPORTED_REASON);
  });
});

describe('Entities: the filter chips', () => {
  it('offers the entity names /stats knows, and filters by one', async () => {
    const { app, queries } = await mounted();

    await fireEvent.click(screen.getByRole('button', { name: '+ entity name' }));

    const option = await screen.findByRole('menuitem', { name: /counter/ });

    expect(option.textContent?.replace(/\s+/g, ' ').trim()).toBe('counter 204');

    await fireEvent.click(option);

    await waitFor(() => expect(app.router.current.query.get('name')).toBe('counter'));
    await waitFor(() => expect(queries.at(-1)?.name).toBe('counter'));

    // ...and the chip it wrote takes it off again
    const chip = document.querySelector('.chips2 .fchip') as HTMLElement;

    expect(chip.textContent?.replace(/\s+/g, ' ').trim()).toBe('counter ×');

    await fireEvent.click(within(chip).getByRole('button', { name: 'Remove entity name filter' }));

    await waitFor(() => expect(app.router.current.query.get('name')).toBeNull());
  });

  it('filters by a key prefix when the field is applied, not while it is typed', async () => {
    const { app, queries } = await mounted();

    const field = screen.getByRole('textbox', { name: 'Key starts with' });
    const asked = queries.length;

    await fireEvent.input(field, { target: { value: 'warehouse-0' } });

    expect(app.router.current.query.get('key')).toBeNull();
    expect(queries).toHaveLength(asked);

    await fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(app.router.current.query.get('key')).toBe('warehouse-0'));
    await waitFor(() => expect(queries.at(-1)?.keyPrefix).toBe('warehouse-0'));
  });

  it('starts the field from the URL', async () => {
    await mounted({ path: '/DurableFunctionsHub/entities?key=warehouse-1' });

    expect(screen.getByRole('textbox', { name: 'Key starts with' })).toHaveValue('warehouse-1');
  });

  it('opens on the last seven days, and narrows to what the user picks', async () => {
    const { app, queries } = await mounted();

    const select = screen.getByRole('button', { name: 'Updated in' });

    expect(select).toHaveTextContent('Updated in the last 7 days');
    expect(select).toHaveClass('fchip');

    await fireEvent.keyDown(select, { key: 'ArrowDown' });

    // bits-ui selects on pointerup, which is what a click in jsdom is not
    const option = await screen.findByRole('option', { name: 'Updated in the last hour' });

    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() => expect(app.router.current.query.get('updated')).toBe('1h'));

    // An hour of it, asked for as a window rather than as a name
    await waitFor(() => expect(queries.at(-1)?.updatedFrom).toBeTruthy());
  });
});

describe('Entities: the table', () => {
  it('shows the entity, its key, its state as one line and what can be done to it', async () => {
    await mounted();

    const headers = Array.from(document.querySelectorAll('.tbl thead th')).map((th) => th.textContent?.trim());

    expect(headers).toEqual(['', 'entity name', 'key', 'state', 'lastUpdatedTime', 'status', 'actions']);

    // The newest is sorted first, and the header says which column did it (L39)
    expect(document.querySelector('.tbl thead th.sort.desc')?.textContent?.trim()).toBe('lastUpdatedTime');

    const [first] = rows();

    expect(cells(first)).toEqual([
      '',
      'counter entity',
      'warehouse-07',
      '{"value":1284,"lastSku":"SKU-4471"}',
      '2026-09-04 14:01:47',
      'Running',
      'Signal Purge',
    ]);

    expect(within(first).getByText('entity')).toHaveClass('chip', 'kind-entity', 'sm');
    expect(first.getAttribute('data-st')).toBe('Running');
  });

  it('opens the whole state in the peek, from the row and from the state cell alike', async () => {
    const { app } = await mounted();

    await fireEvent.click(rows()[0]);

    expect(app.peek.item).toMatchObject({
      id: '@counter@warehouse-07',
      name: 'counter',
      kind: 'DurableEntity',
      status: 'Running',
      state: { value: 1284, lastSku: 'SKU-4471' },
    });

    // An entity listing carries no created time or duration, and the panel is told nothing instead
    expect(app.peek.item).toMatchObject({ created: '', duration: null });

    app.peek.close();

    await fireEvent.click(within(rows()[0]).getByRole('button', { name: '{"value":1284,"lastSku":"SKU-4471"}' }));

    expect(app.peek.item?.id).toBe('@counter@warehouse-07');
  });

  it('says an unreadable state is unreadable, rather than showing an empty cell', async () => {
    await mounted();

    const ledger = rows()[2];

    expect(cells(ledger)[3]).toBe('could not be read');
    expect(within(ledger).getByText('could not be read')).toHaveAttribute(
      'title',
      'Unexpected character at position 0',
    );
  });

  it('signals and purges one entity through the shared dialogs', async () => {
    const { app } = await mounted();

    await fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Signal' }));

    expect(app.actions.kind).toBe('signal');
    expect(app.actions.target).toMatchObject({ id: '@counter@warehouse-07', key: 'warehouse-07', isEntity: true });

    // ...and it did not also peek the row it was clicked in
    expect(app.peek.item).toBeNull();

    app.actions.close();

    await fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Purge' }));

    expect(app.actions.kind).toBe('purge');
    expect(app.actions.target?.key).toBe('warehouse-12');
  });

  it('offers neither in read-only mode', async () => {
    await mounted({ readOnly: true });

    expect(within(rows()[0]).getByRole('button', { name: 'Signal' })).toBeDisabled();
    expect(within(rows()[0]).getByRole('button', { name: 'Purge' })).toBeDisabled();
  });

  it('counts what is shown against what the hub holds', async () => {
    await mounted();

    await waitFor(() =>
      expect(document.querySelector('.tfoot .meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        `Showing 3 of 212 · ${STATE_NOTE}`,
      ),
    );

    // Nothing more to load, so nothing offers to
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('loads the next page when there is one', async () => {
    const pages = [
      entitiesFixture({ hasMore: true }),
      entitiesFixture({
        entities: [entityRow({ instanceId: '@counter@warehouse-99', key: 'warehouse-99' })],
        hasMore: false,
      }),
    ];
    let next = 0;
    const { queries } = await mounted({ response: undefined, answer: () => pages[Math.min(next++, 1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(queries).toHaveLength(2);
    expect(queries[1].skip).toBe(3);
  });

  it('says why there is no state to show on a backend without /entities', async () => {
    await mounted({ capabilities: { stats: true }, rows: [entity({ input: null })] });

    expect(cells(rows()[0])[3]).toBe('—');
    expect(document.querySelector('.tfoot .meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `Showing 1 of 212 · ${NO_STATE_NOTE}`,
    );
  });
});

describe('Entities: nothing to show', () => {
  it('says so, and leaves the chips that are hiding them to hand', async () => {
    const { app } = mount({
      path: '/DurableFunctionsHub/entities?name=counter&key=nothing-matches-this',
      response: entitiesFixture({ entities: [] }),
    });

    const empty = await screen.findByRole('heading', { name: NO_ENTITIES_TITLE });

    expect(empty.closest('.empty')?.querySelector('p')?.textContent).toBe(NO_ENTITIES_TEXT);
    expect(document.querySelector('.tbl')).toBeNull();

    // What the text says to clear is right above it, still filled in
    await fireEvent.click(screen.getByRole('button', { name: 'Remove entity name filter' }));

    await waitFor(() => expect(app.router.current.query.get('name')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Key starts with' })).toHaveValue('nothing-matches-this');
  });

  it('says nothing about what matches until something has been asked', () => {
    mount({ response: entitiesFixture({ entities: [] }) });

    expect(screen.queryByRole('heading', { name: NO_ENTITIES_TITLE })).toBeNull();
    expect(document.querySelector('.tbl')).not.toBeNull();
  });
});
