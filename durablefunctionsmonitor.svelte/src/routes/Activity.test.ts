// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { ORDER_NOTE } from '$lib/activity/ActivityTable.svelte';
import type { AuditQuery, AuditResponse, Capabilities } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Activity, { NO_ACTIVITY_TITLE, auditingOffText, nothingInRangeText } from './Activity.svelte';
import { audit as auditFixture, auditDisabled, auditRow } from '../../tests/unit/fixtures/audit';

function mount(
  options: {
    path?: string;
    response?: AuditResponse;
    /** A different answer per call, for the paging test. */
    answer?: () => AuditResponse;
    capabilities?: Partial<Capabilities>;
  } = {},
) {
  const queries: AuditQuery[] = [];

  const rendered = render(ScreenHarness, {
    props: {
      screen: Activity,
      path: options.path ?? '/DurableFunctionsHub/activity',
      capabilities: options.capabilities ?? { audit: true },
      endpoints: {
        audit: async (query: AuditQuery = {}) => {
          queries.push(query);

          return options.answer ? options.answer() : (options.response ?? auditFixture());
        },
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
  const expected = (options.response ?? auditFixture()).rows.length;

  await waitFor(() => expect(rows()).toHaveLength(expected));

  return rendered;
}

/** Picks an option out of a bits-ui select, which does not answer to a plain click in jsdom. */
async function pick(select: string, option: string): Promise<void> {
  await fireEvent.keyDown(screen.getByRole('button', { name: select }), { key: 'ArrowDown' });

  const item = await screen.findByRole('option', { name: option });

  await fireEvent.pointerDown(item, { pointerType: 'mouse' });
  await fireEvent.pointerUp(item, { pointerType: 'mouse' });
  await fireEvent.click(item);
}

describe('Activity: the title row', () => {
  it('is the header of the mockup: the range, the operation and how many entries', async () => {
    await mounted();

    expect(document.querySelector('section.page[data-screen-label="Activity"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Activity', level: 1 })).toHaveClass('display');

    // ScreenActivity.dc.html L18-L21
    expect(screen.getByRole('button', { name: 'Time range' })).toHaveTextContent('Last 24 hours');
    expect(screen.getByRole('button', { name: 'Operation' })).toHaveTextContent('All operations');
    expect(document.querySelector('.ptitle .meta')?.textContent).toBe('6 entries');
  });

  it('asks again for the range the user picks, and shares it with every screen', async () => {
    const { app, queries } = await mounted();

    await pick('Time range', 'Last 7 days');

    await waitFor(() => expect(app.timeRange).toEqual({ preset: '7d' }));
    expect(new URLSearchParams(window.location.search).get('range')).toBe('7d');

    await waitFor(() => expect(queries).toHaveLength(2));
  });

  it('filters by one operation, which is what the URL carries', async () => {
    const { queries } = await mounted();

    await pick('Operation', 'Restart in place');

    await waitFor(() => expect(new URLSearchParams(window.location.search).get('operation')).toBe('Restart in place'));

    // Verbatim, because that is the name the backend stored (E11-S1-T1)
    await waitFor(() => expect(queries.at(-1)?.operation).toBe('Restart in place'));

    await pick('Operation', 'All operations');

    await waitFor(() => expect(new URLSearchParams(window.location.search).get('operation')).toBeNull());
    await waitFor(() => expect(queries.at(-1)?.operation).toBeUndefined());
  });

  it('offers the batch operations under the names the backend records them by', async () => {
    await mounted();

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Operation' }), { key: 'ArrowDown' });

    expect(await screen.findByRole('option', { name: 'Batch terminate' })).toBeInTheDocument();
    // A bare `Batch` would match nothing: the middleware records the action it ran
    expect(screen.queryByRole('option', { name: 'Batch' })).toBeNull();
  });
});

describe('Activity: the table', () => {
  it('is the table of the mockup: seven columns, newest first', async () => {
    await mounted();

    const headers = Array.from(document.querySelectorAll('.tbl thead th')).map((th) => th.textContent?.trim() ?? '');

    expect(headers).toEqual(['', 'time', 'user', 'operation', 'instance', 'outcome', 'details']);

    // The backend orders the rows; the header says which column that order is on (L29)
    expect(document.querySelectorAll('.tbl thead th')[1]).toHaveClass('sort', 'desc');

    expect(cells(rows()[0])).toEqual([
      '',
      '2026-09-04 14:02:41',
      'chandra@contoso.com',
      'Terminate',
      'order-2026-09-04-000911',
      'ok',
      '—',
    ]);
  });

  it('tags the dangerous operations, and only those', async () => {
    await mounted();

    const tagged = rows()
      .filter((row) => row.querySelector('.tag'))
      .map((row) => cells(row)[3]);

    // Replay and Restart in place are Dangerous; Update input and rewind is the third of them
    expect(tagged).toEqual(['Replay dangerous', 'Update input and rewind dangerous', 'Restart in place dangerous']);

    const tag = rows()[2].querySelector('.tag') as HTMLElement;

    // A label, not a control: nothing here is clickable (L40)
    expect(tag.tagName).toBe('SPAN');
    expect(tag.textContent).toBe('dangerous');
  });

  it('chips the outcome, and paints the spine with what happened', async () => {
    await mounted();

    const chips = rows().map((row) => {
      const chip = row.querySelector('td[data-label="outcome"] .chip') as HTMLElement;

      return [chip.textContent?.trim(), chip.className, row.getAttribute('data-st')];
    });

    expect(chips).toEqual([
      ['ok', 'chip sm st-completed', 'Completed'],
      ['ok', 'chip sm st-completed', 'Completed'],
      ['ok', 'chip sm st-completed', 'Completed'],
      // The one call that was refused says which status refused it
      ['409', 'chip sm st-failed', 'Failed'],
      ['ok', 'chip sm st-completed', 'Completed'],
      ['ok', 'chip sm st-completed', 'Completed'],
    ]);
  });

  it('keeps the whole message in reach of a cell that cannot hold it', async () => {
    await mounted();

    const details = rows()[2].querySelector('td[data-label="details"]') as HTMLElement;
    const message = 'from #27 · 14 history rows removed · PaymentApproved raised again';

    expect(details).toHaveClass('trunc');
    expect(within(details).getByTitle(message)).toHaveTextContent(message);
  });

  it('opens the instance a row acted on, and says nothing where there is none', async () => {
    const { app } = await mounted();

    // The purge of history was hub-wide
    expect(cells(rows()[5])[4]).toBe('—');

    await screen.getByRole('button', { name: 'order-2026-09-04-000911' }).click();

    const route = app.router.current;

    expect(route.name).toBe('instance');
    expect('instanceId' in route && route.instanceId).toBe('order-2026-09-04-000911');
  });

  it('says where the order comes from, and offers the next page while there is one', async () => {
    const pages = [
      auditFixture({ rows: [auditRow()], hasMore: true }),
      auditFixture({ rows: [auditRow({ at: '2026-09-01T09:00:00Z', operation: 'Purge' })], hasMore: false }),
    ];
    let next = 0;

    mount({ answer: () => pages[next++] });

    await waitFor(() => expect(rows()).toHaveLength(1));

    expect(document.querySelector('.tfoot .meta')?.textContent).toBe(ORDER_NOTE);

    await screen.getByRole('button', { name: 'Load more' }).click();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(document.querySelector('.ptitle .meta')?.textContent).toBe('2 entries');

    // Nothing more to ask for
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('Activity: when there is nothing to show', () => {
  it('says auditing is off, and how to turn it on, when the backend says so', async () => {
    mount({ response: auditDisabled() });

    await waitFor(() => expect(screen.getByRole('heading', { name: NO_ACTIVITY_TITLE })).toBeInTheDocument());

    // The table it would be written to is named after the hub this screen is on
    expect(document.querySelector('.empty p')?.textContent).toBe(auditingOffText('DurableFunctionsHub'));
    expect(document.querySelector('.empty p')?.textContent).toContain('DurableFunctionsHubDfmAudit');

    expect(document.querySelector('.tbl')).toBeNull();
  });

  it('says the same thing to a backend that cannot audit at all', async () => {
    const { queries } = mount({ capabilities: {} });

    await waitFor(() => expect(screen.getByRole('heading', { name: NO_ACTIVITY_TITLE })).toBeInTheDocument());

    expect(document.querySelector('.empty p')?.textContent).toBe(auditingOffText('DurableFunctionsHub'));
    expect(queries).toEqual([]);
  });

  it('says the range is empty when auditing is on and it is', async () => {
    mount({ response: auditFixture({ rows: [] }) });

    await waitFor(() => expect(screen.getByRole('heading', { name: NO_ACTIVITY_TITLE })).toBeInTheDocument());

    // A recording hub with a quiet day is not a hub that is not recording
    expect(document.querySelector('.empty p')?.textContent).toBe(nothingInRangeText('last 24 hours'));
    expect(document.querySelector('.ptitle .meta')?.textContent).toBe('0 entries');
  });
});
