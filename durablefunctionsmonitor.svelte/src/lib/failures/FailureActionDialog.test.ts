// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { BatchRequest, BatchResponse, Capabilities } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import FailureActionDialog, { failureActionDef, type FailureActionKind } from './FailureActionDialog.svelte';

const GROUP = [
  'order-2026-09-04-000911',
  'order-2026-09-04-000907',
  'order-2026-09-04-000902',
  'order-2026-09-04-000897',
  'order-2026-09-04-000890',
  'order-2026-09-04-000884',
];

function mount(
  options: {
    kind?: FailureActionKind;
    ids?: string[];
    capabilities?: Partial<Capabilities>;
    batch?: (request: BatchRequest) => Promise<BatchResponse>;
    purge?: (instanceId: string) => Promise<void>;
    postAction?: (instanceId: string, action: string, body?: unknown) => Promise<void>;
    onDone?: () => void;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      // The harness renders one component; the props this one needs go through its `props`
      screen: FailureActionDialog as unknown as Component,
      path: '/DurableFunctionsHub/failures',
      capabilities: options.capabilities ?? {},
      endpoints: {
        batch: options.batch,
        purge: options.purge,
        postAction: options.postAction,
      },
      props: {
        open: true,
        kind: options.kind ?? 'purge',
        ids: options.ids ?? GROUP,
        onDone: options.onDone,
      },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function dialog(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

describe('failureActionDef', () => {
  it('names the instance when there is one, and counts them when there are more', () => {
    // ScreenFailures.dc.html L99-L101
    expect(failureActionDef('rewind', ['order-1'])).toEqual({
      title: 'Rewind order-1',
      body: 'Re-runs only the failed steps. Completed steps keep their results.',
      confirm: 'Rewind',
      variant: 'primary',
      band: false,
      reason: true,
    });

    expect(failureActionDef('rewind', GROUP)).toMatchObject({
      title: 'Rewind 6 instances',
      body: 'Re-runs only the failed steps of each instance. Completed steps keep their results.',
      confirm: 'Rewind all 6',
    });

    expect(failureActionDef('purge', ['order-1'])).toEqual({
      title: 'Purge order-1',
      body: 'Removes the instance, the history and the large-message blobs. This cannot be undone.',
      confirm: 'Purge instance',
      variant: 'destructive',
      band: true,
      reason: false,
    });

    expect(failureActionDef('purge', GROUP)).toMatchObject({
      title: 'Purge 6 instances',
      body: 'Removes these instances, the history and the large-message blobs. This cannot be undone.',
      confirm: 'Purge all 6',
      band: true,
    });
  });
});

describe('FailureActionDialog', () => {
  it('lists what is about to be acted on, and wears the stripe when it cannot be undone', () => {
    mount();

    expect(screen.getByRole('heading', { name: 'Purge 6 instances' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).not.toBeNull();
    expect(dialog().querySelector('.ed.ro pre')?.textContent).toBe(GROUP.join('\n'));

    // Purge takes no reason: there is nothing to explain to an instance that is gone
    expect(screen.queryByLabelText('Reason (optional)')).toBeNull();
  });

  it('summarises the rest when a group is longer than the preview', () => {
    const ids = Array.from({ length: 14 }, (_, index) => `order-${index}`);

    mount({ ids });

    expect(dialog().querySelector('.ed.ro pre')?.textContent).toBe(`${ids.slice(0, 10).join('\n')}\n… and 4 more`);
  });

  it('asks for a reason on a rewind, and sends it', async () => {
    const requests: BatchRequest[] = [];

    mount({
      kind: 'rewind',
      capabilities: { batch: true },
      batch: async (request) => {
        requests.push(request);

        return { action: request.action, results: [], okCount: 6, failedCount: 0, elapsedMs: 4 };
      },
    });

    expect(dialog().querySelector('.warn')).toBeNull();

    await fireEvent.input(screen.getByLabelText('Reason (optional)'), { target: { value: 'gateway is back' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rewind all 6' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({ action: 'rewind', instanceIds: GROUP, payload: { reason: 'gateway is back' } });
  });

  it('purges a whole group in one batch request where the backend has one', async () => {
    const requests: BatchRequest[] = [];
    const onDone = vi.fn();

    const { app } = mount({
      capabilities: { batch: true },
      onDone,
      batch: async (request) => {
        requests.push(request);

        return {
          action: request.action,
          results: request.instanceIds.map((instanceId) => ({ instanceId, ok: true, status: 200 })),
          okCount: request.instanceIds.length,
          failedCount: 0,
          elapsedMs: 12,
        };
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Purge all 6' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());

    expect(requests).toEqual([{ action: 'purge', instanceIds: GROUP, payload: {} }]);
    expect(app.toast.current?.message).toBe('Purge all 6 · 6 ok, 0 failed');
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('falls back to one request per instance on a backend without /batch', async () => {
    const purged: string[] = [];

    mount({
      purge: async (instanceId) => {
        purged.push(instanceId);
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Purge all 6' }));

    await waitFor(() => expect(purged).toHaveLength(6));
    expect([...purged].sort()).toEqual([...GROUP].sort());
  });

  it('lists what failed, because a group action that half worked has to say which half', async () => {
    const { app } = mount({
      capabilities: { batch: true },
      batch: async (request) => ({
        action: request.action,
        results: request.instanceIds.map((instanceId, index) => ({
          instanceId,
          ok: index > 0,
          status: index > 0 ? 200 : 409,
          message: index > 0 ? undefined : 'Instance is running',
        })),
        okCount: request.instanceIds.length - 1,
        failedCount: 1,
        elapsedMs: 9,
      }),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Purge all 6' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Purge all 6' })).toBeInTheDocument());

    expect(app.toast.current?.kind).toBe('error');
    expect(app.toast.current?.message).toBe('Purge all 6 · 5 ok, 1 failed');

    // Failures first, with what the backend said about them
    const first = within(document.querySelector('table.tbl tbody tr') as HTMLElement);

    expect(first.getByText(GROUP[0])).toBeInTheDocument();
    expect(first.getByText('Instance is running')).toBeInTheDocument();
  });

  it('stays open when the call itself failed, so the user can try it again', async () => {
    const { app } = mount({
      capabilities: { batch: true },
      batch: async () => {
        throw new Error('500 Internal Server Error');
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Purge all 6' }));

    await waitFor(() => expect(app.toast.current?.kind).toBe('error'));

    expect(app.toast.current?.message).toBe('Purge all 6. 500 Internal Server Error');
    expect(screen.getByRole('heading', { name: 'Purge 6 instances' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purge all 6' })).toBeEnabled();
  });
});
