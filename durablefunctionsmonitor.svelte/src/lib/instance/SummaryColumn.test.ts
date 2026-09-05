// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { OrchestrationDetails } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import SummaryColumn from './SummaryColumn.svelte';
import { details as detailsFixture, storedInput } from '../../../tests/unit/fixtures/details';
import { history as historyFixture } from '../../../tests/unit/fixtures/history';

const INSTANCE_ID = 'order-2026-09-04-000913';

function mount(
  options: {
    instanceId?: string;
    details?: OrchestrationDetails;
    readOnly?: boolean;
    onDownload?: (instanceId: string, field: string) => void;
  } = {},
) {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: SummaryColumn,
      instanceId: options.instanceId ?? INSTANCE_ID,
      readOnly: options.readOnly ?? false,
      endpoints: {
        getOrchestration: async () => options.details ?? detailsFixture(),
        getHistory: async () => ({ history: historyFixture }),
        downloadField: async (instanceId: string, field: string) => options.onDownload?.(instanceId, field),
      } as unknown as Endpoints,
    },
  });

  const harness = rendered.component as unknown as {
    appState: () => AppState;
    instanceState: () => InstanceState;
  };

  return { ...rendered, app: harness.appState(), instance: harness.instanceState() };
}

function panels(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.summary .panel'));
}

function kv(): Record<string, string> {
  const list: Record<string, string> = {};
  const terms = Array.from(document.querySelectorAll('.summary .kv dt'));

  for (const term of terms) {
    list[term.textContent?.trim() ?? ''] = term.nextElementSibling?.textContent?.trim() ?? '';
  }

  return list;
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

describe('SummaryColumn', () => {
  it('draws the fields and the execution panel, and nothing E8 owns', async () => {
    const { instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    // Two panels: the fields and the execution. "Where the time went" and Children are snippets
    expect(panels()).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Where the time went' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Children' })).toBeNull();

    expect(screen.getByRole('heading', { name: 'Input', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Execution', level: 3 })).toBeInTheDocument();
  });

  it('shows the input pretty-printed, and opens the whole of it', async () => {
    const downloads: string[][] = [];
    const { app, instance } = mount({ onDownload: (id, field) => void downloads.push([id, field]) });

    await waitFor(() => expect(instance.details).not.toBeNull());

    const pre = panels()[0].querySelector('pre.json') as HTMLElement;

    // Contracts §9: two spaces, fully expanded, clipped to a preview by CSS and not by truncation
    expect(pre.textContent).toContain('"orderId": "A-1043"');
    expect(pre.style.maxHeight).toBe('96px');
    expect(pre.style.overflow).toBe('hidden');

    await fireEvent.click(within(panels()[0]).getAllByRole('button', { name: 'open' })[0]);

    const dialog = await screen.findByRole('dialog', { name: 'input' });

    expect(within(dialog).getByText(INSTANCE_ID)).toHaveClass('meta', 'mono');

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(downloads).toEqual([[INSTANCE_ID, 'input']]));

    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() => expect(app.toast.current?.message).toBe('Copied input to the clipboard'));
  });

  it('says the output is not there yet rather than showing an empty block', async () => {
    const { instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    const headings = Array.from(panels()[0].querySelectorAll('.panel-h'));
    const output = headings.find((heading) => heading.textContent?.includes('Output')) as HTMLElement;

    expect(output.textContent).toContain('none yet');
    expect(within(output).queryByRole('button', { name: 'open' })).toBeNull();
  });

  it('opens the output once there is one', async () => {
    const { instance } = mount({
      details: detailsFixture({ runtimeStatus: 'Completed', output: { shipped: true } }),
    });

    await waitFor(() => expect(instance.details).not.toBeNull());

    const headings = Array.from(panels()[0].querySelectorAll('.panel-h'));
    const output = headings.find((heading) => heading.textContent?.includes('Output')) as HTMLElement;

    await fireEvent.click(within(output).getByRole('button', { name: 'open' }));

    expect(await screen.findByRole('dialog', { name: 'output' })).toBeInTheDocument();
  });

  it('edits the customStatus through the confirm every other screen uses', async () => {
    const { app, instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    await fireEvent.click(screen.getByRole('button', { name: 'edit' }));

    expect(app.actions.kind).toBe('custom');
    expect(app.actions.target).toMatchObject({ id: INSTANCE_ID, customStatus: { step: 'ChargePayment', attempt: 2 } });
  });

  it('does not offer to edit anything in a read-only hub', async () => {
    const { instance } = mount({ readOnly: true });

    await waitFor(() => expect(instance.details).not.toBeNull());

    const edit = screen.getByRole('button', { name: 'edit' });

    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute('title', 'Read-only mode');
  });

  it('says what it knows about the execution, and an em dash for what only E8 knows', async () => {
    const { instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());
    await instance.history.load();

    await waitFor(() => expect(kv().history).toBe(`${historyFixture.length} rows`));

    expect(kv().executionId).toBe('—');
    expect(kv().generation).toBe('—');
    expect(kv()['large blobs']).toBe('—');

    // The fixture carries one tag, rendered as a chip
    expect(kv().tags).toBe('channel:web');
  });

  it('leaves the tags row out when the instance has none', async () => {
    const { instance } = mount({ details: detailsFixture({ tags: undefined }) });

    await waitFor(() => expect(instance.details).not.toBeNull());
    await waitFor(() => expect(Object.keys(kv())).not.toContain('tags'));
  });

  it('gives an entity one panel: its state', async () => {
    const { instance } = mount({
      instanceId: '@counter@warehouse-07',
      details: detailsFixture({
        instanceId: '@counter@warehouse-07',
        name: 'Counter',
        entityType: 'DurableEntity',
        entityId: { name: 'counter', key: 'warehouse-07' },
        input: { value: 1284 },
      }),
    });

    await waitFor(() => expect(instance.details).not.toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'State', level: 3 })).toBeInTheDocument());

    expect(screen.queryByRole('heading', { name: 'Input' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'customStatus' })).toBeNull();
    expect(panels()[0].querySelector('pre.json')?.textContent).toContain('1284');
  });

  it('shows the stored input of the fixture verbatim', async () => {
    const { instance } = mount();

    await waitFor(() => expect(instance.details).not.toBeNull());

    const pre = panels()[0].querySelector('pre.json') as HTMLElement;

    for (const key of Object.keys(storedInput)) {
      expect(pre.textContent).toContain(key);
    }
  });
});
