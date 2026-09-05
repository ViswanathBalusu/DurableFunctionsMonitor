// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { AuditRow } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import RecentActivity, { activityMeta, outcomeLabel, rowKey } from './RecentActivity.svelte';
import { audit as auditFixture, auditRow } from '../../../tests/unit/fixtures/audit';

/** The harness takes a screen, and this one has a prop the harness passes through. */
const Activity = RecentActivity as unknown as Component;

function mount(options: { rows?: AuditRow[] } = {}) {
  return render(ScreenHarness, {
    props: {
      screen: Activity,
      path: '/DurableFunctionsHub',
      capabilities: { stats: true, audit: true },
      props: { rows: options.rows ?? auditFixture().rows },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

/** One column of every row, by the label its cells carry. */
function column(label: string): string[] {
  return Array.from(document.querySelectorAll(`tbody td[data-label="${label}"]`)).map(
    (cell) => cell.textContent?.trim() ?? '',
  );
}

describe('activity lines', () => {
  it('says how many rows are on screen, and does not invent a total', () => {
    expect(activityMeta(auditFixture().rows)).toBe('audit · last 6 in range');
    expect(activityMeta([])).toBe('audit · last 0 in range');
  });

  it('says ok, or the status that was not ok', () => {
    expect(outcomeLabel(auditRow())).toBe('ok');
    expect(outcomeLabel(auditRow({ outcome: 'failed', status: 409 }))).toBe('409');
  });

  it('tells two rows of the same second apart', () => {
    expect(rowKey(auditRow())).not.toBe(rowKey(auditRow({ operation: 'Purge' })));
    expect(rowKey(auditRow({ instanceId: null }))).toContain('|');
  });
});

describe('Recent activity', () => {
  it('is the table of the mockup: five columns and no header over them', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Recent activity', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('audit · last 6 in range');

    expect(document.querySelector('table.tbl thead')).toBeNull();
    expect(document.querySelector('.tbl-wrap')).toHaveClass('flat');

    expect(column('time')).toEqual(['14:02:41', '13:58:02', '13:41:22', '13:20:11', '11:02:31', '02:44:00']);

    // The names the middleware writes, spaces and all (Common/AuditOperations.cs)
    expect(column('operation')).toEqual([
      'Terminate',
      'Raise event',
      'Replay',
      'Update input and rewind',
      'Restart in place',
      'Purge history',
    ]);
  });

  it('chips the outcome, in the colour of what happened', () => {
    mount();

    const chips = Array.from(document.querySelectorAll('tbody td[data-label="outcome"] .chip')).map((chip) => [
      chip.textContent?.trim(),
      chip.className,
    ]);

    expect(chips).toEqual([
      ['ok', 'chip sm st-completed'],
      ['ok', 'chip sm st-completed'],
      ['ok', 'chip sm st-completed'],
      ['409', 'chip sm st-failed'],
      ['ok', 'chip sm st-completed'],
      ['ok', 'chip sm st-completed'],
    ]);
  });

  it('opens the instance a row acted on, and says nothing where there is none', async () => {
    const rendered = mount();

    // The purge-history row is hub-wide: it acted on no instance at all
    expect(column('instance')[5]).toBe('—');

    await screen.getByRole('button', { name: 'order-2026-09-04-000911' }).click();

    const route = appOf(rendered).router.current;

    expect(route.name).toBe('instance');
    expect('instanceId' in route && route.instanceId).toBe('order-2026-09-04-000911');
  });

  it('offers the whole trail, which is a screen of its own', async () => {
    const rendered = mount();

    await screen.getByRole('button', { name: 'Activity' }).click();

    expect(appOf(rendered).router.current.name).toBe('activity');
  });

  it('renders an empty table rather than an error when the range holds nothing', () => {
    mount({ rows: [] });

    expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('audit · last 0 in range');
  });
});
