// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { HistoryEvent, HistoryQuery, RuntimeStatus } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import { HISTORY_PAGE_SIZE } from '$lib/state/instance-history.svelte';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import HistoryTab from './HistoryTab.svelte';
import { historyKey, jsonSubtitle, jsonTitle, resultOf } from './history-columns';
import { isInputEvent, isRewound, spineOf } from './history-spine';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture, historyEvent } from '../../../tests/unit/fixtures/history';

const INSTANCE_ID = 'order-2026-09-04-000913';

function mount(
  options: {
    history?: HistoryEvent[] | ((query: HistoryQuery) => HistoryEvent[]);
    status?: RuntimeStatus;
    query?: string;
    onQuery?: (query: HistoryQuery) => void;
  } = {},
) {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: HistoryTab,
      instanceId: INSTANCE_ID,
      path: `/DurableFunctionsHub/instances/${INSTANCE_ID}${options.query ?? ''}`,
      endpoints: {
        getOrchestration: async () => detailsFixture({ runtimeStatus: options.status ?? 'Running' }),
        getHistory: async (_id: string, query: HistoryQuery) => {
          options.onQuery?.(query);

          const rows = options.history ?? historyFixture;

          return { history: typeof rows === 'function' ? rows(query) : rows };
        },
      } as unknown as Endpoints,
    },
  });

  const harness = rendered.component as unknown as {
    appState: () => AppState;
    instanceState: () => InstanceState;
  };

  const instance = harness.instanceState();

  void instance.history.load();

  return { ...rendered, app: harness.appState(), instance };
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('table.tbl tbody tr'));
}

function headers(): string[] {
  return Array.from(document.querySelectorAll('table.tbl thead th')).map((th) => th.textContent?.trim() ?? '');
}

function cell(row: HTMLElement, label: string): string {
  return row.querySelector(`[data-label="${label}"]`)?.textContent?.trim() ?? '';
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

describe('the history spine', () => {
  it.each([
    ['TaskCompleted', 'Completed'],
    ['SubOrchestrationInstanceCompleted', 'Completed'],
    ['TaskFailed', 'Failed'],
    ['SubOrchestrationInstanceFailed', 'Failed'],
    ['TimerFired', 'Suspended'],
    ['TaskScheduled', 'Running'],
    ['SubOrchestrationInstanceCreated', 'Running'],
    ['ExecutionStarted', ''],
    ['EventRaised', ''],
    ['OrchestratorStarted', ''],
  ])('colours %s as %s', (EventType, expected) => {
    expect(spineOf(historyEvent({ EventType }))).toBe(expected);
  });

  it('reads ExecutionCompleted as the instance itself ended', () => {
    const event = historyEvent({ EventType: 'ExecutionCompleted' });

    expect(spineOf(event, 'Completed')).toBe('Completed');
    expect(spineOf(event, 'Failed')).toBe('Failed');
  });

  it('marks the rewound GenericEvent, wherever the reason arrived', () => {
    const details = historyEvent({ EventType: 'GenericEvent', Details: 'Rewound: bad rate card' });
    const result = historyEvent({ EventType: 'GenericEvent', Result: 'Rewound: bad rate card' });
    const plain = historyEvent({ EventType: 'GenericEvent', Details: 'Something else' });

    expect(spineOf(details)).toBe('ContinuedAsNew');
    expect(spineOf(result)).toBe('ContinuedAsNew');
    expect(isRewound(details)).toBe(true);
    expect(spineOf(plain)).toBe('');
    expect(isRewound(plain)).toBe(false);
  });

  it('knows which rows carry an input', () => {
    expect(isInputEvent(historyEvent({ EventType: 'ExecutionStarted' }))).toBe(true);
    expect(isInputEvent(historyEvent({ EventType: 'EventRaised' }))).toBe(true);
    expect(isInputEvent(historyEvent({ EventType: 'TaskCompleted' }))).toBe(false);
  });
});

describe('the history columns', () => {
  it('shows whichever of Result and Details the runtime filled in', () => {
    expect(resultOf(historyEvent({ Result: { ok: true } }))).toEqual({ ok: true });
    expect(resultOf(historyEvent({ Details: 'boom' }))).toBe('boom');
    expect(resultOf(historyEvent())).toBeNull();
  });

  it('titles the viewer by the row it was opened from', () => {
    const event = historyEvent({ SequenceNumber: 9, EventType: 'TaskCompleted', Name: 'ChargePayment' });

    expect(jsonTitle(event)).toBe('TaskCompleted · ChargePayment');
    expect(jsonSubtitle(event)).toBe('#9 · 14:02:11.913');
    expect(jsonTitle(historyEvent({ SequenceNumber: 4, EventType: 'GenericEvent', Name: null }))).toBe(
      'GenericEvent · #4',
    );
  });

  it('keys a row by its sequence number, and by what it has when there is none', () => {
    expect(historyKey(historyEvent({ SequenceNumber: 9 }))).toBe('s9');
    expect(historyKey(historyEvent({ SequenceNumber: null }))).toBe('2026-09-04T14:02:11.913Z:ExecutionStarted');
  });
});

describe('HistoryTab', () => {
  it('draws the table of the mockup, spine and all', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(historyFixture.length));

    expect(headers().slice(1)).toEqual([
      '#',
      'Timestamp',
      'EventType',
      'Name',
      'ScheduledTime',
      'Duration',
      'Result / Details',
    ]);

    const started = rows()[0];
    expect(cell(started, '#')).toBe('1');
    expect(cell(started, 'Timestamp')).toBe('14:02:11.913');
    expect(cell(started, 'EventType')).toContain('ExecutionStarted');
    expect(cell(started, 'Name')).toBe('ProcessOrderOrchestrator');
    expect(cell(started, 'Duration')).toBe('');

    // A scheduled step is running, a completed one is completed (the spine of L133)
    expect(rows()[1]).toHaveAttribute('data-st', 'Running');
    expect(rows()[2]).toHaveAttribute('data-st', 'Completed');
    expect(cell(rows()[2], 'Duration')).toBe('2 s');
  });

  it('links the input rows to the Inputs tab, at their own event', async () => {
    mount();

    await waitFor(() => expect(rows()).toHaveLength(historyFixture.length));

    const tags = document.querySelectorAll('.tag');

    // ExecutionStarted #1 and EventRaised #27, and nothing else
    expect(tags).toHaveLength(2);

    await fireEvent.click(tags[1]);

    const query = new URLSearchParams(window.location.search);

    expect(query.get('tab')).toBe('inputs');
    expect(query.get('seq')).toBe('27');
  });

  it('opens a result in the viewer, titled by its row', async () => {
    const { app } = mount();

    await waitFor(() => expect(rows()).toHaveLength(historyFixture.length));

    await fireEvent.click(rows()[2].querySelector('[data-label="Result / Details"] .link') as HTMLElement);

    const dialog = await screen.findByRole('dialog', { name: 'TaskCompleted · ReserveInventory' });

    expect(within(dialog).getByText('#5 · 14:02:13.917')).toHaveClass('meta', 'mono');
    expect(dialog.querySelector('.jse-theme-dfm')).not.toBeNull();

    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() =>
      expect(app.toast.current?.message).toBe('Copied TaskCompleted · ReserveInventory to the clipboard'),
    );
  });

  it('filters from a moment, and says so on the URL', async () => {
    const queries: HistoryQuery[] = [];
    mount({ onQuery: (query) => queries.push(query) });

    await waitFor(() => expect(rows()).toHaveLength(historyFixture.length));

    expect(screen.getByLabelText('From')).toHaveTextContent('now');

    // Turning it on seeds it with the first row on screen (React `timeFromEnabled`)
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Set' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('timeFrom')).toBe(historyFixture[0].Timestamp),
    );
    await waitFor(() => expect(queries.at(-1)?.filter).toBe(`timestamp ge '${historyFixture[0].Timestamp}'`));
  });

  it('says the Till field is not something the backend has', async () => {
    mount();

    const till = screen.getByLabelText('Till');

    expect(till).toBeDisabled();
    expect(till).toHaveAttribute('placeholder', 'now');
    expect(till).toHaveAttribute('title', 'The backend filters history from a start time only');
  });

  it('counts what it has, offers more while there is more, and explains the rewound rows', async () => {
    const full = Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) =>
      historyEvent({ SequenceNumber: index + 1, EventType: 'TaskScheduled' }),
    );

    mount({ history: (query) => (query.skip === 0 ? full : [historyEvent({ SequenceNumber: 999 })]) });

    await waitFor(() =>
      expect(document.querySelector('.row .meta')?.textContent?.trim()).toBe('200 events shown so far'),
    );

    expect(document.querySelector('.tfoot .meta')?.textContent).toContain('Rewound rows arrive as GenericEvent');

    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(document.querySelector('.row .meta')?.textContent?.trim()).toBe('201 events shown'));
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});
