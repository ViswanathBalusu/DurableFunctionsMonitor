// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { FunctionMapResponse } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from './app.svelte';
import { Prefs } from './prefs.svelte';
import { StartInstance, isJsonInput, orchestratorNames, parseInput } from './start-instance.svelte';

function makeApp(endpoints: Partial<Endpoints> = {}) {
  window.history.replaceState({}, '', '/DurableFunctionsHub/instances');

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: endpoints as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub' });

  return app;
}

const functionMap: FunctionMapResponse = {
  functions: {
    ProcessOrderOrchestrator: { bindings: [{ type: 'orchestrationTrigger', direction: 'in' }] },
    ChargePayment: { bindings: [{ type: 'activityTrigger', direction: 'in' }] },
    OnboardTenantOrchestrator: { bindings: [{ type: 'orchestrationTrigger', direction: 'in' }] },
    Counter: { bindings: [{ type: 'entityTrigger', direction: 'in' }] },
  },
  proxies: {},
};

describe('orchestratorNames', () => {
  it('keeps the functions with an orchestration trigger, in name order', () => {
    expect(orchestratorNames(functionMap)).toEqual(['OnboardTenantOrchestrator', 'ProcessOrderOrchestrator']);
  });

  it('is empty for a map with no functions at all', () => {
    expect(orchestratorNames({ functions: {}, proxies: {} })).toEqual([]);
  });
});

describe('isJsonInput and parseInput', () => {
  it('treats an empty editor as valid input, sent as null', () => {
    expect(isJsonInput('   ')).toBe(true);
    expect(parseInput('   ')).toBeNull();
  });

  it('parses what the editor holds', () => {
    expect(isJsonInput('{ "a": 1 }')).toBe(true);
    expect(parseInput('{ "a": 1 }')).toEqual({ a: 1 });
  });

  it('knows when it is not JSON', () => {
    expect(isJsonInput('{ "a": ')).toBe(false);
  });
});

describe('StartInstance', () => {
  it('opens empty, and opens prefilled with the input pretty-printed', () => {
    const start = new StartInstance({ app: makeApp() });

    start.openWith();

    expect(start.open).toBe(true);
    expect(start.orchestrator).toBe('');
    expect(start.instanceId).toBe('');
    expect(start.inputText).toBe('');

    start.openWith({
      orchestrator: 'ProcessOrderOrchestrator',
      instanceId: 'order-1',
      input: { orderId: 'A-1044' },
    });

    expect(start.orchestrator).toBe('ProcessOrderOrchestrator');
    expect(start.instanceId).toBe('order-1');
    expect(start.inputText).toBe('{\n  "orderId": "A-1044"\n}');
  });

  it('does not ask for a function map when the host has no function graph', async () => {
    const functionMapCall = vi.fn(async () => functionMap);
    const start = new StartInstance({ app: makeApp({ functionMap: functionMapCall }) });

    // The test host is the browser one, which publishes no graph
    expect(host.functionGraphAvailable).toBe(false);

    await start.loadOrchestrators();

    expect(functionMapCall).not.toHaveBeenCalled();
    expect(start.orchestrators).toEqual([]);
  });

  it('starts nothing without an orchestrator', async () => {
    const startNewInstance = vi.fn(async () => ({ instanceId: 'x' }));
    const start = new StartInstance({ app: makeApp({ startNewInstance }) });

    start.openWith({ orchestrator: '   ' });

    expect(await start.start()).toBeNull();
    expect(startNewInstance).not.toHaveBeenCalled();
    expect(start.open).toBe(true);
  });
});
