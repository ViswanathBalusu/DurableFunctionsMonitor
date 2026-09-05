// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { RuntimeStatus, SpansResponse } from '$lib/api/types';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import TimelineTab, { HOVER_HINT, TIMELINE_LEGEND } from './TimelineTab.svelte';
import { children as childrenFixture } from '../../../tests/unit/fixtures/children';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture } from '../../../tests/unit/fixtures/history';
import { spansResponse } from '../../../tests/unit/fixtures/spans';

const INSTANCE_ID = 'order-2026-09-04-000913';

async function mount(options: { spans?: SpansResponse; status?: RuntimeStatus; spansFail?: boolean } = {}) {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: TimelineTab,
      instanceId: INSTANCE_ID,
      capabilities: { spans: true, children: true },
      endpoints: {
        getOrchestration: async () => detailsFixture({ runtimeStatus: options.status ?? 'Running' }),
        getHistory: async () => ({ history: historyFixture }),
        spans: async () => {
          if (options.spansFail) {
            throw new Error('500 Internal Server Error');
          }

          return options.spans ?? spansResponse();
        },
        children: async () => childrenFixture(),
      } as unknown as Endpoints,
    },
  });

  const instance = (rendered.component as unknown as { instanceState: () => InstanceState }).instanceState();

  await instance.refreshAll();
  await waitFor(() => expect(document.querySelector('.swim .lane')).not.toBeNull());

  return { ...rendered, instance };
}

function lanes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.swim .lane'));
}

function laneLabels(): string[] {
  return lanes().map((lane) => lane.querySelector('.lbl')?.textContent?.trim() ?? '');
}

function row(sequenceNumber: number): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('tbody tr')).find(
    (candidate) => candidate.querySelector('td[data-label="#"]')?.textContent?.trim() === String(sequenceNumber),
  );

  expect(found, `no history row #${sequenceNumber}`).toBeDefined();

  return found as HTMLElement;
}

function highlightedRows(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('tbody tr.hl')).map(
    (tr) => tr.querySelector('td[data-label="#"]')?.textContent?.trim() ?? '',
  );
}

describe('TimelineTab: the picture', () => {
  it('is the swimlane of the mockup, with the axis over it', async () => {
    await mount();

    expect(laneLabels()).toEqual([
      'ProcessOrderOrchestrator',
      'ReserveInventory',
      'ChargePayment',
      'ChargePayment (retry 2)',
      'retry backoff',
      'wait PaymentApproved',
      'ChargePayment (retry 3)',
      'NotifyCustomer (sub)',
    ]);

    // Six ticks in the user's clock, and the axis label of the mockup (L89)
    const ticks = Array.from(document.querySelectorAll('.swim .axis .ticks span')).map((tick) => tick.textContent);

    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toBe('14:02:11');
    expect(document.querySelector('.swim .axis .meta')?.textContent).toBe('span');

    // The instance is still running, so the dashed line says where now is
    expect(document.querySelector('.swim .lane .now')).not.toBeNull();
  });

  it('names the fills under it, and says what hovering one is for', async () => {
    await mount();

    const legend = Array.from(document.querySelectorAll('.legend > span'));

    expect(legend.map((item) => item.textContent?.trim())).toEqual(TIMELINE_LEGEND.map((item) => item.label));
    expect(legend[0].querySelector('i')).toHaveClass('st-completed');
    expect(legend[4].querySelector('i')).toHaveStyle({ borderStyle: 'dotted' });

    expect(screen.getByText(HOVER_HINT)).toHaveClass('meta');
  });
});

describe('TimelineTab: the linkage', () => {
  it('lights the rows of the span whose lane is hovered', async () => {
    await mount();

    await fireEvent.mouseEnter(lanes()[3]);

    // `ChargePayment (retry 2)` was built from the rows that scheduled it and the one that failed
    await waitFor(() => expect(highlightedRows()).toEqual(['10', '14']));

    await fireEvent.mouseLeave(lanes()[3]);

    await waitFor(() => expect(highlightedRows()).toEqual([]));
  });

  it('lights the failed bar when its history row is hovered', async () => {
    await mount();

    await fireEvent.mouseEnter(row(14));

    await waitFor(() => expect(document.querySelector('.bar.hl')).not.toBeNull());

    const bar = document.querySelector('.bar.hl') as HTMLElement;

    expect(bar).toHaveClass('st-failed');
    expect(bar.getAttribute('data-bar')).toBe('charge2');

    // ...and the lane that bar is drawn on, which is the one the eye is looking for
    expect(lanes()[3]).toHaveClass('hl');
    expect(lanes()[2]).not.toHaveClass('hl');
  });

  it('leaves the rows of an event nothing was built from alone', async () => {
    await mount();

    // The orchestrator's episodes come from the markers, so ExecutionStarted belongs to no span
    await fireEvent.mouseEnter(row(1));

    await waitFor(() => expect(document.querySelectorAll('.lane.hl')).toHaveLength(0));

    expect(highlightedRows()).toEqual([]);
  });

  it('scrolls the span of a clicked row into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});

    await mount();

    await fireEvent.click(row(14));

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect((scrollIntoView.mock.instances[0] as HTMLElement).getAttribute('data-lane')).toBe('charge2');

    scrollIntoView.mockRestore();
  });
});

describe('TimelineTab: the history under it', () => {
  it('is the same rows without the rail, and without the column the bars replace', async () => {
    await mount();

    expect(Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent?.trim())).toEqual([
      '',
      '#',
      'Timestamp',
      'EventType',
      'Name',
      'Duration',
      'Result / Details',
    ]);

    // No From/Till rail: the picture above is the whole execution, and a filtered table would not match
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(historyFixture.length);
  });

  it('says how much of the history is on screen, and where the rest of it lives', async () => {
    const { instance } = await mount();

    expect(document.querySelector('.tfoot .meta')?.textContent).toBe(
      `${historyFixture.length} of 31 events · SequenceNumber from the provider`,
    );

    await screen.getByRole('button', { name: 'Open History tab' }).click();

    await waitFor(() => expect(instance.tab).toBe('history'));
  });

  it('counts what it has when there are no spans to count against', async () => {
    await mount({ spansFail: true });

    // The picture is gone with the call that failed; the rows it was drawn over are still here
    expect(laneLabels()).toEqual(['ProcessOrderOrchestrator']);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(historyFixture.length);
    expect(document.querySelector('.tfoot .meta')?.textContent).toBe(
      `${historyFixture.length} events · SequenceNumber from the provider`,
    );
  });
});

describe('TimelineTab: a terminal instance', () => {
  it('draws no now line, and ends where the run ended', async () => {
    await mount({
      status: 'Completed',
      spans: spansResponse({ executionEndedAt: '2026-09-04T14:02:30.000Z' }),
    });

    expect(document.querySelector('.swim .now')).toBeNull();

    const ticks = Array.from(document.querySelectorAll('.swim .axis .ticks span')).map((tick) => tick.textContent);

    expect(ticks[ticks.length - 1]).toBe('14:02:30');
  });
});
