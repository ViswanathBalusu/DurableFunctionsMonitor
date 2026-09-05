// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import type { Endpoints } from '$lib/api/endpoints';
import type { HistoryEvent, HistoryQuery } from '$lib/api/types';
import { GUTTER, LANE_WIDTH, SELF_LOOP, arrowOf, laneX } from '$lib/charts/SequenceDiagram.svelte';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instance from '../../routes/Instance.svelte';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture, historyEvent } from '../../../tests/unit/fixtures/history';

const INSTANCE_ID = 'order-2026-09-04-000913';

const PARTICIPANTS = ['ProcessOrderOrchestrator', 'ReserveInventory', 'ChargePayment', 'NotifyCustomer'];

function mount(
  options: {
    history?: HistoryEvent[];
    childHistory?: HistoryEvent[];
    onQuery?: (instanceId: string, query: HistoryQuery) => void;
    saveAs?: (text: string, fileName: string) => void;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Instance,
      path: `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=sequence`,
      client: {
        isVsCode: true,
        host: { saveAs: async (text: string, fileName: string) => options.saveAs?.(text, fileName) },
      } as unknown as Partial<BackendClient>,
      endpoints: {
        getOrchestration: async () => detailsFixture(),
        getHistory: async (instanceId: string, query: HistoryQuery) => {
          options.onQuery?.(instanceId, query);

          if (instanceId !== INSTANCE_ID) {
            return { history: options.childHistory ?? [] };
          }

          return { history: options.history ?? historyFixture };
        },
      } as unknown as Endpoints,
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function parts(): string[] {
  return Array.from(document.querySelectorAll('.seq .part')).map((part) => part.textContent?.trim() ?? '');
}

function arrows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.seq .arrow'));
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=sequence`);
});

describe('the arrow geometry', () => {
  it('puts every lane where the mockup does', () => {
    // ScreenInstance.dc.html L194: lifelines at 170, 330, 490, 650
    expect([0, 1, 2, 3].map(laneX)).toEqual([170, 330, 490, 650]);
    expect(GUTTER + LANE_WIDTH / 2).toBe(170);
  });

  it('draws a call left to right and a return right to left', () => {
    const call = arrowOf({ t: '', from: PARTICIPANTS[0], to: PARTICIPANTS[2], label: '', kind: 'call' }, PARTICIPANTS);

    expect(call).toEqual({ left: 170, width: 320, back: false, failed: false, self: false });

    const back = arrowOf(
      { t: '', from: PARTICIPANTS[2], to: PARTICIPANTS[0], label: '', kind: 'return' },
      PARTICIPANTS,
    );

    expect(back).toEqual({ left: 170, width: 320, back: true, failed: false, self: false });
  });

  it('loops a self message to the left of its own lane', () => {
    const loop = arrowOf({ t: '', from: PARTICIPANTS[0], to: PARTICIPANTS[0], label: '', kind: 'self' }, PARTICIPANTS);

    expect(loop).toEqual({ left: 170 - SELF_LOOP, width: SELF_LOOP, back: false, failed: false, self: true });
  });

  it('marks a failure, whichever way it points', () => {
    const failure = arrowOf(
      { t: '', from: PARTICIPANTS[2], to: PARTICIPANTS[0], label: '', kind: 'failed' },
      PARTICIPANTS,
    );

    expect(failure).toMatchObject({ back: true, failed: true });
  });
});

describe('SequenceTab', () => {
  it('draws the participants and arrows of the mockup', async () => {
    mount();

    await waitFor(() => expect(parts()).toEqual(PARTICIPANTS));

    // The orchestrator's lane is the one that wears the accent
    expect(document.querySelectorAll('.seq .part.n-orchestrator')).toHaveLength(1);
    expect(document.querySelector('.seq .part')).toHaveClass('n-orchestrator');

    await waitFor(() => expect(arrows()).toHaveLength(10));

    // Three returns and the failure, which also points back at the orchestrator
    expect(document.querySelectorAll('.seq .arrow.back')).toHaveLength(4);
    expect(document.querySelectorAll('.seq .arrow.failed')).toHaveLength(1);
    expect(document.querySelectorAll('.seq .life')).toHaveLength(4);

    // Every row carries the moment it happened
    expect(document.querySelector('.smsg .t')?.textContent).toBe('14:02:12.004');
  });

  it('loads the rest of the history before drawing a diagram of the first page', async () => {
    const queries: HistoryQuery[] = [];
    const full = Array.from({ length: 200 }, (_, index) =>
      historyEvent({ SequenceNumber: index + 1, EventType: 'TaskScheduled', Name: 'ReserveInventory' }),
    );

    mount({ history: full, onQuery: (_id, query) => queries.push(query) });

    // The first page said there was more, so the tab asks for the next one itself
    await waitFor(() => expect(queries.some((query) => query.skip === 200)).toBe(true));
  });

  it('asks a sub-orchestration for its own history and draws what it did', async () => {
    const asked: string[] = [];

    mount({
      history: [
        historyEvent({
          SequenceNumber: 4,
          EventType: 'SubOrchestrationInstanceCompleted',
          Name: 'NotifyCustomer',
          SubOrchestrationId: `${INSTANCE_ID}:0`,
          DurationInMs: 1_400,
        }),
      ],
      childHistory: [historyEvent({ EventType: 'TaskScheduled', Name: 'SendEmail' })],
      onQuery: (instanceId) => asked.push(instanceId),
    });

    await waitFor(() => expect(asked).toContain(`${INSTANCE_ID}:0`));
    await waitFor(() => expect(parts()).toEqual(['ProcessOrderOrchestrator', 'NotifyCustomer', 'SendEmail']));
  });

  it('copies the diagram as mermaid source, and says it did', async () => {
    const { app } = mount();

    await waitFor(() => expect(arrows()).toHaveLength(10));

    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy diagram code to clipboard' }));

    await waitFor(() => expect(app.toast.current?.message).toBe('Copied the sequence diagram source'));

    const copied = (navigator.clipboard.writeText as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];

    expect(copied.startsWith('sequenceDiagram\n')).toBe(true);
    expect(copied).toContain('ProcessOrderOrchestrator->>ReserveInventory:ReserveInventory');
  });

  it('saves an SVG of the same diagram, with no script in it', async () => {
    const saved: { text: string; fileName: string }[] = [];

    mount({ saveAs: (text, fileName) => saved.push({ text, fileName }) });

    await waitFor(() => expect(arrows()).toHaveLength(10));

    await fireEvent.click(screen.getByRole('button', { name: 'Save as SVG' }));

    await waitFor(() => expect(saved).toHaveLength(1));

    expect(saved[0].fileName).toBe(`${INSTANCE_ID}-sequence.svg`);
    expect(saved[0].text).toContain('<svg');
    expect(saved[0].text).not.toContain('<script');
    expect(saved[0].text).not.toContain('var(--');

    // One box and one lifeline per participant, one line and one head per message
    expect(saved[0].text.match(/<rect/g)).toHaveLength(PARTICIPANTS.length + 10);
    expect(saved[0].text.match(/stroke-dasharray/g)?.length).toBeGreaterThanOrEqual(PARTICIPANTS.length);
  });

  it('says so rather than drawing an empty frame when there is nothing to draw', async () => {
    mount({ history: [historyEvent({ EventType: 'ExecutionStarted' })] });

    await waitFor(() =>
      expect(screen.getByText('Nothing to draw yet: this execution has recorded no calls.')).toBeInTheDocument(),
    );

    expect(document.querySelector('.seq')).toBeNull();
  });
});
