// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { StatsByName } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import TopOrchestrators, { DEFAULT_SORT, SUB_ORCHESTRATOR, TOP_META, sortRows } from './TopOrchestrators.svelte';
import { byName, stats as statsFixture } from '../../../tests/unit/fixtures/stats';

/** The harness takes a screen, and this one has props the harness passes through. */
const Top = TopOrchestrators as unknown as Component;

function mount(options: { rows?: StatsByName[]; subOrchestrators?: string[]; path?: string } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Top,
      path: options.path ?? '/DurableFunctionsHub',
      capabilities: { stats: true },
      props: {
        rows: options.rows ?? statsFixture().byName,
        subOrchestrators: options.subOrchestrators ?? [],
      },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/** One column of every row, by its header. */
function column(header: string): string[] {
  return Array.from(document.querySelectorAll(`tbody td[data-label="${header}"]`)).map(
    (cell) => cell.textContent?.trim() ?? '',
  );
}

describe('sortRows', () => {
  const rows = [
    byName({ name: 'B', started: 2, p50Ms: null, lastFailedAt: null }),
    byName({ name: 'A', started: 9, p50Ms: 500, lastFailedAt: '2026-09-04T01:00:00Z' }),
    byName({ name: 'C', started: 5, p50Ms: 100, lastFailedAt: '2026-09-04T02:00:00Z' }),
  ];

  it('sorts by the column that was asked for, either way', () => {
    expect(sortRows(rows, { id: 'started', dir: 'desc' }).map((row) => row.name)).toEqual(['A', 'C', 'B']);
    expect(sortRows(rows, { id: 'started', dir: 'asc' }).map((row) => row.name)).toEqual(['B', 'C', 'A']);
    expect(sortRows(rows, { id: 'name', dir: 'asc' }).map((row) => row.name)).toEqual(['A', 'B', 'C']);
  });

  it('leaves the rows alone when nothing is sorted', () => {
    expect(sortRows(rows, null)).toBe(rows);
  });

  it('puts the rows the backend has no value for last, whichever way the column points', () => {
    expect(sortRows(rows, { id: 'p50', dir: 'asc' }).map((row) => row.name)).toEqual(['C', 'A', 'B']);
    expect(sortRows(rows, { id: 'p50', dir: 'desc' }).map((row) => row.name)).toEqual(['A', 'C', 'B']);
    expect(sortRows(rows, { id: 'last', dir: 'desc' }).map((row) => row.name)).toEqual(['C', 'A', 'B']);
  });
});

describe('Top orchestrators', () => {
  it('is the panel of the mockup: the columns, in the order it lists them', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Top orchestrators', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe(TOP_META);

    expect(Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim())).toEqual([
      '',
      'name',
      'started',
      'completed',
      'failed',
      'failure rate',
      'p50',
      'p95',
      'last failure',
    ]);

    // Flat inside a panel, and out of the mobile card layout
    expect(document.querySelector('.tbl-wrap')).toHaveClass('keep', 'flat');
  });

  it('opens sorted by started, newest work first', () => {
    mount();

    expect(column('started')).toEqual(['1,102', '1,096', '24', '7']);
    expect(document.querySelector('thead th.sort')).toHaveTextContent(DEFAULT_SORT.id);
  });

  it('formats every number the way the mockup writes it', () => {
    mount({
      rows: [
        byName({
          name: 'ProcessOrderOrchestrator',
          started: 1_102,
          completed: 1_088,
          failed: 8,
          failureRate: 0.007,
          p50Ms: 4_100,
          p95Ms: 22_000,
          lastFailedAt: '2026-09-04T13:51:19Z',
        }),
      ],
    });

    expect(column('started')).toEqual(['1,102']);
    expect(column('failure rate')).toEqual(['0.7 %']);
    expect(column('p50')).toEqual(['4 s']);
    expect(column('p95')).toEqual(['22 s']);
    expect(column('last failure')).toEqual(['13:51:19']);
  });

  it('says an em dash where the backend had nothing to say', () => {
    mount({ rows: [byName({ p50Ms: null, p95Ms: null, lastFailedAt: null })] });

    expect(column('p50')).toEqual(['—']);
    expect(column('p95')).toEqual(['—']);
    expect(column('last failure')).toEqual(['—']);
  });

  it('re-sorts on a header click, without asking the backend for anything', async () => {
    mount();

    await screen.getByRole('button', { name: 'p95' }).click();

    // First click is ascending, and the fastest p95 of the fixture is NotifyCustomer's
    expect(column('name')[0]).toContain('NotifyCustomer');
  });

  it('marks the orchestrators the function map says run inside another one', () => {
    mount({ subOrchestrators: ['NotifyCustomer'] });

    const chips = Array.from(document.querySelectorAll('tbody td[data-label="name"] .chip'));

    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe(SUB_ORCHESTRATOR);
    expect(chips[0].closest('td')?.textContent).toContain('NotifyCustomer');
  });

  it('opens the instances of the orchestrator that was clicked, over the range on screen', async () => {
    const rendered = mount({ path: '/DurableFunctionsHub?range=7d' });

    await screen.getByRole('button', { name: 'ProcessOrderOrchestrator' }).click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('instances');
    expect(route.query.get('name')).toBe('ProcessOrderOrchestrator');
    expect(route.query.get('range')).toBe('7d');
  });
});
