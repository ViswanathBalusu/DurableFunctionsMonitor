// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { InputEventsResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instance from '../../routes/Instance.svelte';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import {
  DANGEROUS_OFF_REASON,
  NO_SEQUENCE_NUMBERS_REASON,
  REPLAY_USE_RESTART_REASON,
  RESTART_EXTERNAL_EVENTS_REASON,
  UPDATE_EXTERNAL_EVENTS_REASON,
} from '../../../tests/unit/fixtures/input-eligibility';
import { eventRaised, executionStarted, inputEvents } from '../../../tests/unit/fixtures/input-events';

const INSTANCE_ID = 'order-2026-09-04-000913';

function mount(
  options: {
    response?: InputEventsResponse;
    readOnly?: boolean;
    dangerous?: boolean;
    query?: string;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Instance,
      path: `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs${options.query ?? ''}`,
      readOnly: options.readOnly ?? false,
      dangerous: options.dangerous ?? true,
      endpoints: {
        getOrchestration: async () => detailsFixture(),
        getHistory: async () => ({ history: [] }),
        inputEvents: async () => options.response ?? inputEvents(),
      } as unknown as Endpoints,
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.card.icard'));
}

function ops(card: HTMLElement): { label: string; disabled: boolean; why: string; danger: boolean }[] {
  return Array.from(card.querySelectorAll('.op')).map((op) => ({
    label: op.querySelector('.btn')?.textContent?.trim() ?? '',
    disabled: (op.querySelector('.btn') as HTMLButtonElement).disabled,
    why: op.querySelector('.why')?.textContent?.trim() ?? '',
    danger: !!op.querySelector('.btn.danger'),
  }));
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs`);
});

describe('InputsTab', () => {
  it('says what the tab is for, and that dangerous operations are on', async () => {
    mount();

    await waitFor(() => expect(cards()).toHaveLength(2));

    expect(screen.getByRole('heading', { name: 'Inputs this instance received', level: 2 })).toBeInTheDocument();
    expect(document.body.textContent).toContain('Sequence numbers are the concurrency token');
    expect(document.querySelector('.dbadge')?.textContent).toBe('Dangerous operations on');
  });

  it('renders the two events as the mockup does, with the backend reasons under the buttons', async () => {
    mount();

    await waitFor(() => expect(cards()).toHaveLength(2));

    const [first, last] = cards();

    expect(first.querySelector('.seq')?.textContent).toBe('#1');
    expect(first.querySelector('.ev')?.textContent).toBe('ExecutionStarted');
    expect(first.querySelector('.when')?.textContent).toBe('2026-09-04 14:02:11.913');
    expect(first.querySelector('.ed')).toHaveClass('ro');

    // Every one of the first card's operations is refused, each with the backend's own reason
    expect(ops(first)).toEqual([
      { label: 'Restart in place', disabled: true, why: RESTART_EXTERNAL_EVENTS_REASON, danger: true },
      { label: 'Update input and rewind', disabled: true, why: UPDATE_EXTERNAL_EVENTS_REASON, danger: false },
      { label: 'Replay from #1', disabled: true, why: REPLAY_USE_RESTART_REASON, danger: true },
    ]);

    expect(last.querySelector('.seq')?.textContent).toBe('#27');
    expect(last.querySelector('.chip')?.textContent?.trim()).toBe('last');
    expect(last.querySelector('.ed')).not.toHaveClass('ro');

    const lastOps = ops(last);

    expect(lastOps.find((op) => op.label === 'Update input and rewind')?.disabled).toBe(false);
    expect(lastOps.find((op) => op.label === 'Replay from #27')).toMatchObject({ disabled: false, danger: true });
  });

  it('says what each editor holds and how big it is', async () => {
    mount();

    await waitFor(() => expect(cards()).toHaveLength(2));

    const [first, last] = cards();

    // A card nothing can be done with says so; the editable one says the text is what was stored
    expect(first.querySelector('.foot')?.textContent).toContain('read only ·');
    expect(last.querySelector('.foot')?.textContent).toContain('stored input');

    for (const card of cards()) {
      expect(card.querySelector('.meter')?.textContent).toContain('of 60.0 KB');
    }

    // Nothing has been edited, so there is nothing to reset to
    expect(screen.queryByRole('button', { name: 'Reset to stored' })).toBeNull();
  });

  it('says Read only above the cards when the hub is', async () => {
    mount({ readOnly: true });

    await waitFor(() => expect(cards()).toHaveLength(2));

    const note = document.querySelector('.note');

    expect(note?.textContent).toContain('Read only');
    expect(note?.textContent).toContain('/about does not list DurableFunctionsMonitor.ReadWrite');

    for (const card of cards()) {
      for (const op of ops(card)) {
        expect(op.disabled).toBe(true);
        expect(op.why).toBe('Read-only mode');
      }
    }
  });

  it('says dangerous operations are off, and why the replay is dead', async () => {
    mount({
      dangerous: false,
      response: inputEvents({
        dangerousOperationsEnabled: false,
        events: [
          eventRaised({
            operations: {
              'restart-in-place': { allowed: false, reason: DANGEROUS_OFF_REASON },
              'update-input-and-rewind': { allowed: true },
              replay: { allowed: false, reason: DANGEROUS_OFF_REASON },
            },
          }),
        ],
      }),
    });

    await waitFor(() => expect(cards()).toHaveLength(1));

    expect(document.querySelector('.dbadge')).toBeNull();
    expect(screen.getByText('Dangerous operations off')).toHaveClass('chip');

    const replay = ops(cards()[0]).find((op) => op.label === 'Replay from #27');

    expect(replay).toMatchObject({ disabled: true, why: DANGEROUS_OFF_REASON });
  });

  it('renders one warning for the whole tab, not one per card', async () => {
    mount({
      response: inputEvents({
        parentInstanceId: 'order-2026-09-04-000900',
        events: [
          executionStarted(),
          eventRaised({
            operations: {
              'restart-in-place': { allowed: false, reason: 'no' },
              'update-input-and-rewind': {
                allowed: true,
                warning: 'This is a sub-orchestration. Its parent will not be re-run.',
              },
              replay: { allowed: true, warning: 'This is a sub-orchestration. Its parent will not be re-run.' },
            },
          }),
        ],
      }),
    });

    await waitFor(() => expect(cards()).toHaveLength(2));

    const notes = document.querySelectorAll('.note');

    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain('This is a sub-orchestration. Its parent will not be re-run.');
  });

  it('offers no buttons at all when the provider numbers nothing, and says why once', async () => {
    mount({
      response: inputEvents({
        events: [
          executionStarted({
            sequenceNumber: null,
            operations: {
              'restart-in-place': { allowed: false, reason: NO_SEQUENCE_NUMBERS_REASON },
              'update-input-and-rewind': { allowed: false, reason: NO_SEQUENCE_NUMBERS_REASON },
              replay: { allowed: false, reason: NO_SEQUENCE_NUMBERS_REASON },
            },
          }),
        ],
      }),
    });

    await waitFor(() => expect(cards()).toHaveLength(1));

    expect(document.querySelector('.note')?.textContent).toContain(NO_SEQUENCE_NUMBERS_REASON);
    expect(cards()[0].querySelectorAll('.op')).toHaveLength(0);
    expect(cards()[0].querySelector('.seq')?.textContent).toBe('#?');
  });

  it('is empty rather than broken when nothing was recorded', async () => {
    mount({ response: inputEvents({ events: [] }) });

    await waitFor(() => expect(screen.getByText('No inputs recorded for this execution yet.')).toBeInTheDocument());
    expect(cards()).toHaveLength(0);
  });

  it('counts the events into the tab label once it has looked', async () => {
    mount();

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Inputs (2)' })).toBeInTheDocument());
  });

  it('scrolls to the card ?seq asked for', async () => {
    mount({ query: '&seq=27' });

    await waitFor(() => expect(cards()).toHaveLength(2));

    // The History tab's `input` tag links here; the card it names is the one to look at
    expect(cards()[1]).toHaveAttribute('data-seq', '27');
  });

  it('reloads with the workspace once it has been opened', async () => {
    let loads = 0;

    const rendered = render(ScreenHarness, {
      props: {
        screen: Instance,
        path: `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=inputs`,
        endpoints: {
          getOrchestration: async () => detailsFixture(),
          getHistory: async () => ({ history: [] }),
          inputEvents: async () => {
            loads += 1;
            return inputEvents();
          },
        } as unknown as Endpoints,
      },
    });

    const app = (rendered.component as unknown as { appState: () => AppState }).appState();

    await waitFor(() => expect(loads).toBe(1));

    // Every run reloads the list, and so does the workspace's own Refresh
    app.refresh();

    await waitFor(() => expect(loads).toBe(2));
  });
});
