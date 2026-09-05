// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Capabilities, OrchestrationDetails } from '$lib/api/types';
import type { Endpoints } from '$lib/api/endpoints';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instance from '../../routes/Instance.svelte';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { history as historyFixture } from '../../../tests/unit/fixtures/history';

const INSTANCE_ID = 'order-2026-09-04-000913';

const ENTITY_ID = '@counter@warehouse-07';

function entityDetails(): OrchestrationDetails {
  return detailsFixture({
    instanceId: ENTITY_ID,
    name: 'Counter',
    entityType: 'DurableEntity',
    entityId: { name: 'counter', key: 'warehouse-07' },
    runtimeStatus: 'Pending',
  });
}

function mount(
  options: {
    instanceId?: string;
    query?: string;
    details?: OrchestrationDetails;
    capabilities?: Partial<Capabilities>;
    onLoad?: () => void;
  } = {},
) {
  const id = options.instanceId ?? INSTANCE_ID;

  const rendered = render(ScreenHarness, {
    props: {
      screen: Instance,
      path: `/DurableFunctionsHub/instances/${encodeURIComponent(id)}${options.query ?? ''}`,
      capabilities: options.capabilities ?? {},
      endpoints: {
        getOrchestration: async () => {
          options.onLoad?.();
          return options.details ?? detailsFixture();
        },
        getHistory: async () => ({ history: historyFixture }),
      } as unknown as Endpoints,
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function tabLabels(): string[] {
  return Array.from(document.querySelectorAll('.tabs .tab')).map((tab) => tab.textContent?.trim() ?? '');
}

function selected(): string {
  return document.querySelector('.tabs .tab[aria-selected="true"]')?.textContent?.trim() ?? '';
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

describe('WorkspaceTabs', () => {
  it('lists the tabs of the mockup for an orchestration', async () => {
    mount();

    // Summary is always in the strip and hidden above 1100px by CSS (`.tab.summary-tab`)
    await waitFor(() =>
      expect(tabLabels()).toEqual(['Summary', 'History', 'Inputs', 'Sequence', 'Raw', 'Order summary']),
    );

    expect(document.querySelector('.tabs .tab')).toHaveClass('summary-tab');
    expect(selected()).toBe('History');
  });

  it('opens on Timeline where the backend has spans', async () => {
    mount({ capabilities: { spans: true } });

    await waitFor(() => expect(tabLabels()).toContain('Timeline'));
    expect(tabLabels()[1]).toBe('Timeline');
    expect(selected()).toBe('Timeline');
  });

  it('gives an entity History, Raw and its custom tabs, and nothing else', async () => {
    mount({ instanceId: ENTITY_ID, details: entityDetails(), capabilities: { spans: true } });

    await waitFor(() => expect(tabLabels()).toEqual(['Summary', 'History', 'Raw', 'Order summary']));
  });

  it('puts the tab on the URL, and opens the one the URL asks for', async () => {
    const first = mount();

    await waitFor(() => expect(tabLabels()).toContain('Raw'));

    await fireEvent.click(screen.getByRole('tab', { name: 'Raw' }));

    await waitFor(() => expect(new URLSearchParams(window.location.search).get('tab')).toBe('raw'));
    expect(selected()).toBe('Raw');
    expect(document.querySelector('.ws')).toHaveAttribute('data-tab', 'raw');

    first.unmount();

    // Which is what makes the tab survive a reload, and a shared link open on it
    mount({ query: '?tab=sequence' });

    await waitFor(() => expect(selected()).toBe('Sequence'));
    expect(document.querySelector('.ws')).toHaveAttribute('data-tab', 'sequence');
  });

  it('falls back to the default when the URL asks for a tab this instance has not got', async () => {
    mount({ instanceId: ENTITY_ID, details: entityDetails(), query: '?tab=sequence' });

    // An entity has no Sequence tab, so the link that asked for one opens on the default instead
    await waitFor(() => expect(tabLabels()).not.toContain('Sequence'));
    expect(selected()).toBe('History');
  });

  it('offers the four auto-refresh intervals and remembers the one chosen', async () => {
    let loads = 0;
    const { app } = mount({ onLoad: () => (loads += 1) });

    await waitFor(() => expect(loads).toBe(1));

    const trigger = screen.getByRole('button', { name: 'Auto-refresh' });
    expect(trigger.textContent?.trim()).toBe('Never');

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    expect(
      screen
        .getAllByRole('option')
        .map((option) => option.textContent?.trim())
        .filter(Boolean),
    ).toEqual(['Never', 'Every 1 sec.', 'Every 5 sec.', 'Every 10 sec.']);

    const option = screen.getByRole('option', { name: 'Every 5 sec.' });
    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() => expect(app.prefs.autoRefresh.instance).toBe(5));
  });

  it('reloads the workspace from Refresh', async () => {
    let loads = 0;
    mount({ onLoad: () => (loads += 1) });

    await waitFor(() => expect(loads).toBe(1));

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(loads).toBe(2));
  });
});
