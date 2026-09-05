// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { InstanceSpansState } from './instance-spans.svelte';
import { Prefs } from './prefs.svelte';
import { children as childrenFixture } from '../../../tests/unit/fixtures/children';
import { spansResponse } from '../../../tests/unit/fixtures/spans';

const INSTANCE_ID = 'order-2026-09-04-000913';

const BOTH: Partial<Capabilities> = { spans: true, children: true };

function makeSpans(
  options: {
    capabilities?: Partial<Capabilities>;
    spans?: () => Promise<unknown>;
    children?: () => Promise<unknown>;
  } = {},
) {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({
    hubName: 'DurableFunctionsHub',
    capabilities: (options.capabilities ?? BOTH) as Capabilities,
  });

  const calls = { spans: [] as string[], children: [] as string[] };

  const endpoints = {
    spans: async (instanceId: string) => {
      calls.spans.push(instanceId);

      return options.spans ? await options.spans() : spansResponse();
    },
    children: async (instanceId: string) => {
      calls.children.push(instanceId);

      return options.children ? await options.children() : childrenFixture();
    },
  } as unknown as Endpoints;

  Object.defineProperty(app, 'endpoints', { value: endpoints, configurable: true });

  return { app, calls, state: new InstanceSpansState({ app, instanceId: INSTANCE_ID }) };
}

describe('InstanceSpansState: loading', () => {
  it('asks for both, and says what they add to the workspace', async () => {
    const { state, calls } = makeSpans();

    expect(state.historyRows).toBeNull();
    expect(state.childrenCount).toBeNull();

    await state.load();

    expect(calls.spans).toEqual([INSTANCE_ID]);
    expect(calls.children).toEqual([INSTANCE_ID]);
    expect(state.spans).toHaveLength(8);
    expect(state.totals?.totalMs).toBe(47_000);
    expect(state.historyRows).toBe(31);
    expect(state.childrenCount).toBe(2);
    expect(state.loading).toBe(false);
  });

  it('asks for nothing the backend has not announced', async () => {
    const { state, calls } = makeSpans({ capabilities: {} });

    expect(state.supported).toBe(false);

    await state.load();

    expect(calls.spans).toEqual([]);
    expect(calls.children).toEqual([]);
    expect(state.response).toBeNull();
    expect(state.children).toBeNull();
  });

  it('loses only the half that failed', async () => {
    const { app, state } = makeSpans({
      spans: async () => {
        throw new Error('500 Internal Server Error');
      },
    });

    await state.load();

    expect(state.response).toBeNull();
    expect(state.childrenCount).toBe(2);
    expect(app.toast.current?.message).toBe('Timeline failed. 500 Internal Server Error');
  });

  it('says a part failed once per outage, not once per refresh', async () => {
    let failing = true;

    const { app, state } = makeSpans({
      children: async () => {
        if (failing) {
          throw new Error('503 Service Unavailable');
        }

        return childrenFixture();
      },
    });

    await state.load();

    expect(app.toast.current?.message).toBe('Children failed. 503 Service Unavailable');

    app.toast.dismiss();
    await state.load();

    // Still broken, already said so
    expect(app.toast.current).toBeNull();

    failing = false;
    await state.load();
    failing = true;
    await state.load();

    // A part that recovered and broke again is news again
    expect(app.toast.current?.message).toBe('Children failed. 503 Service Unavailable');
  });

  it('keeps the answer of the last request, whichever order they come back in', async () => {
    const pending: (() => void)[] = [];
    let started = 0;

    const { state } = makeSpans({
      spans: async () => {
        started += 1;

        const rows = started;

        await new Promise<void>((resolve) => pending.push(resolve));

        return spansResponse({ historyRows: rows });
      },
    });

    const first = state.load();
    const second = state.load();

    // The first request answers last, and is dropped: it is not the one on screen any more
    pending.reverse().forEach((resolve) => resolve());

    await Promise.all([first, second]);

    expect(state.historyRows).toBe(2);
  });
});

describe('InstanceSpansState: the hover linkage', () => {
  it('finds the span a history row belongs to, by its sequence number', async () => {
    const { state } = makeSpans();

    await state.load();

    expect(state.spanForSequence(5)?.id).toBe('reserve');
    expect(state.spanForSequence(5)?.name).toBe('ReserveInventory');
    expect(state.spanForSequence(14)?.id).toBe('charge2');

    // A row no span covers, and a row with no sequence number at all
    expect(state.spanForSequence(999)).toBeNull();
    expect(state.spanForSequence(null)).toBeNull();
  });

  it('names the rows of the hovered span, in the keys the history table uses', async () => {
    const { state } = makeSpans();

    await state.load();

    expect(state.hoveredRowKeys).toEqual([]);

    state.hover = 'charge2';

    expect(state.hoveredRowKeys).toEqual(['s10', 's14']);
    expect(state.rowKeyForSequence(14)).toBe('s14');
  });

  it('follows the spans it is given: a reload with fewer of them forgets the rest', async () => {
    let full = true;

    const { state } = makeSpans({
      spans: async () => {
        const response = spansResponse();

        return full ? response : { ...response, spans: response.spans.slice(0, 2) };
      },
    });

    await state.load();

    expect(state.spanForSequence(14)?.id).toBe('charge2');

    full = false;
    await state.load();

    expect(state.spanForSequence(14)).toBeNull();
    expect(state.spanForSequence(5)?.id).toBe('reserve');
  });
});
