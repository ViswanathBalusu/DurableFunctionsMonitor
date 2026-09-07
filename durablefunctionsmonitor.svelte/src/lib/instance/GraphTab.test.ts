// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import type { Endpoints } from '$lib/api/endpoints';
import type { Capabilities } from '$lib/api/types';
import { buildFunctionGraph } from '$lib/graph/function-graph-model';
import type { AppState } from '$lib/state/app.svelte';
import { clearFunctionMapCache } from '$lib/state/instance.svelte';
import type { InstanceState } from '$lib/state/instance.svelte';
import WorkspaceHarness from '../../../tests/unit/harnesses/WorkspaceHarness.svelte';
import GraphTab, { AZ_FUNC_AS_A_GRAPH_URL, GRAPH_FOOTER } from './GraphTab.svelte';
import { activePath, activityOf, kindSuffix } from './graph-path';
import { DERIVED_FROM_HISTORY, DURABLE_TIMER, EXTERNAL_EVENTS } from './history-graph';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';
import { functionMap } from '../../../tests/unit/fixtures/function-map';
import { history as historyFixture, historyEvent } from '../../../tests/unit/fixtures/history';
import { stats as statsFixture } from '../../../tests/unit/fixtures/stats';

const INSTANCE_ID = 'order-2026-09-04-000913';

const ORCHESTRATOR = 'ProcessOrderOrchestrator';

const model = buildFunctionGraph(functionMap());

function mount(
  options: {
    capabilities?: Partial<Capabilities>;
    isVsCode?: boolean;
    gotoFunctionCode?: (name: string) => void;
    saveAs?: (text: string, fileName: string) => void;
  } = {},
) {
  const rendered = render(WorkspaceHarness, {
    props: {
      component: GraphTab,
      instanceId: INSTANCE_ID,
      // The tab is only offered where the host publishes a graph at all (contracts §3)
      functionGraph: true,
      capabilities: options.capabilities ?? {},
      client: {
        isVsCode: options.isVsCode ?? true,
        host: {
          saveAs: async (text: string, fileName: string) => options.saveAs?.(text, fileName),
          gotoFunctionCode: async (name: string) => options.gotoFunctionCode?.(name),
        },
      } as unknown as Partial<BackendClient>,
      endpoints: {
        getOrchestration: async () => detailsFixture(),
        getHistory: async () => ({ history: historyFixture }),
        functionMap: async () => functionMap(),
        stats: async () => statsFixture(),
      } as unknown as Endpoints,
    },
  });

  const harness = rendered.component as unknown as {
    appState: () => AppState;
    instanceState: () => InstanceState;
  };

  const instance = harness.instanceState();

  // The path is read off the history the workspace loaded
  void instance.history.load();

  return { ...rendered, app: harness.appState(), instance };
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.graph .node'));
}

function kindOf(name: string): string {
  const card = cards().find((node) => node.querySelector('.name')?.textContent === name);

  return card?.querySelector('.kind')?.textContent ?? '';
}

beforeEach(() => {
  clearFunctionMapCache();
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=graph`);
});

describe('activityOf', () => {
  it('counts what each function did, retries and all', () => {
    const activity = activityOf(historyFixture);

    expect(activity.ReserveInventory).toEqual({ calls: 1, failed: 0, running: 0, reached: true });

    // Scheduled three times, completed twice, failed once
    expect(activity.ChargePayment).toEqual({ calls: 3, failed: 1, running: 0, reached: true });

    // Created and not finished: still running
    expect(activity.NotifyCustomer).toEqual({ calls: 1, failed: 0, running: 1, reached: true });

    expect(activity.SendConfirmation).toBeUndefined();
  });

  it('ignores the events that are not calls', () => {
    const activity = activityOf([
      historyEvent({ EventType: 'ExecutionStarted', Name: ORCHESTRATOR }),
      historyEvent({ EventType: 'EventRaised', Name: 'PaymentApproved' }),
    ]);

    expect(activity[ORCHESTRATOR]).toEqual({ calls: 0, failed: 0, running: 0, reached: false });
  });
});

describe('kindSuffix', () => {
  it('says what the mockup says, for each state a function can be in', () => {
    const activity = activityOf(historyFixture);

    expect(kindSuffix(ORCHESTRATOR, ORCHESTRATOR, activity)).toBe(' · this instance');
    expect(kindSuffix('ReserveInventory', ORCHESTRATOR, activity)).toBe(' · 1 call');
    expect(kindSuffix('ChargePayment', ORCHESTRATOR, activity)).toBe(' · 3 calls, 1 failed');
    expect(kindSuffix('NotifyCustomer', ORCHESTRATOR, activity)).toBe(' · running');
    expect(kindSuffix('SendConfirmation', ORCHESTRATOR, activity)).toBe(' · not reached');
    expect(kindSuffix('Counter', ORCHESTRATOR, activity)).toBe(' · not reached');
  });
});

describe('activePath', () => {
  it('marks what this instance called, and what started it', () => {
    const path = activePath(model, ORCHESTRATOR, activityOf(historyFixture));

    expect([...path].sort()).toEqual([
      'OnPaymentSettled->ProcessOrderOrchestrator',
      'ProcessOrderOrchestrator->ChargePayment',
      'ProcessOrderOrchestrator->NotifyCustomer',
      'ProcessOrderOrchestrator->ReserveInventory',
      'StartOrder->ProcessOrderOrchestrator',
    ]);
  });

  it('leaves the calls this instance never made out of it', () => {
    const path = activePath(model, ORCHESTRATOR, activityOf(historyFixture));

    expect(path.has('ProcessOrderOrchestrator->SendConfirmation')).toBe(false);
    expect(path.has('ProcessOrderOrchestrator->Counter:add')).toBe(false);
  });
});

describe('GraphTab', () => {
  it('draws the hub graph with this instance own path over it', async () => {
    mount();

    await waitFor(() => expect(cards()).toHaveLength(model.nodes.length));

    expect(kindOf(ORCHESTRATOR)).toBe('Orchestrator · this instance');
    expect(kindOf('ReserveInventory')).toBe('Activity · 1 call');
    expect(kindOf('ChargePayment')).toBe('Activity · 3 calls, 1 failed');
    expect(kindOf('NotifyCustomer')).toBe('Sub-orchestrator · running');
    expect(kindOf('SendConfirmation')).toBe('Activity · not reached');

    // The instance's own orchestrator is the selected card
    expect(document.querySelector('.graph .node.sel .name')?.textContent).toBe(ORCHESTRATOR);

    expect(screen.getByText(GRAPH_FOOTER)).toBeInTheDocument();
  });

  it('counts the orchestrator with /stats, where the backend has it', async () => {
    mount({ capabilities: { stats: true } });

    await waitFor(() => expect(document.querySelector('.graph .metrics')).not.toBeNull());

    const counters = Array.from(document.querySelectorAll('.graph .metrics')).length;

    // One card per orchestrator the stats counted, and none for what they did not
    expect(counters).toBeGreaterThan(0);
    expect(document.querySelector('.graph .node.sel .metrics')).not.toBeNull();
  });

  it('shows no counters at all without the capability', async () => {
    mount();

    await waitFor(() => expect(cards()).toHaveLength(model.nodes.length));

    expect(document.querySelector('.graph .metrics')).toBeNull();
  });

  it('opens the code in VS Code on a double click', async () => {
    const opened: string[] = [];

    mount({ gotoFunctionCode: (name) => opened.push(name) });

    await waitFor(() => expect(cards().length).toBeGreaterThan(0));

    const card = cards().find((node) => node.querySelector('.name')?.textContent === 'ChargePayment') as HTMLElement;

    await fireEvent.dblClick(card);

    await waitFor(() => expect(opened).toEqual(['ChargePayment']));
  });

  it('saves the graph as an SVG named after the instance', async () => {
    const saved: { text: string; fileName: string }[] = [];

    mount({ saveAs: (text, fileName) => saved.push({ text, fileName }) });

    await waitFor(() => expect(cards().length).toBeGreaterThan(0));

    await fireEvent.click(screen.getByRole('button', { name: 'Save as SVG' }));

    await waitFor(() => expect(saved).toHaveLength(1));

    expect(saved[0].fileName).toBe(`${INSTANCE_ID}.svg`);
    expect(saved[0].text).toContain(ORCHESTRATOR);
    expect(saved[0].text).toContain('· this instance');
  });

  it('renders the az-func-as-a-graph link as text inside VS Code, and as a button outside it', async () => {
    const inVsCode = mount({ isVsCode: true });

    await waitFor(() => expect(cards().length).toBeGreaterThan(0));

    expect(screen.queryByRole('button', { name: 'az-func-as-a-graph' })).toBeNull();
    expect(screen.getByText(AZ_FUNC_AS_A_GRAPH_URL)).toBeInTheDocument();

    inVsCode.unmount();
    clearFunctionMapCache();

    mount({ isVsCode: false });

    await waitFor(() => expect(screen.getByRole('button', { name: 'az-func-as-a-graph' })).toBeInTheDocument());

    const open = vi.fn();
    Object.assign(globalThis, { open });

    await fireEvent.click(screen.getByRole('button', { name: 'az-func-as-a-graph' }));

    expect(open).toHaveBeenCalledWith(AZ_FUNC_AS_A_GRAPH_URL, '_blank');
  });
});

describe('GraphTab: without a published function map', () => {
  /** The same workspace, on a host that publishes no graph at all. */
  function mountBare() {
    const rendered = render(WorkspaceHarness, {
      props: {
        component: GraphTab,
        instanceId: INSTANCE_ID,
        functionGraph: false,
        capabilities: {},
        endpoints: {
          getOrchestration: async () => detailsFixture(),
          getHistory: async () => ({ history: historyFixture }),
        } as unknown as Endpoints,
      },
    });

    const harness = rendered.component as unknown as { instanceState: () => InstanceState };
    const instance = harness.instanceState();

    void instance.history.load();

    return { ...rendered, instance };
  }

  it('draws the graph this instance history describes, and says that is what it is', async () => {
    const { instance } = mountBare();

    await waitFor(() => expect(instance.functionName).toBe(ORCHESTRATOR));

    // The orchestrator, the three functions it called, and the two things that are not functions
    await waitFor(() =>
      expect(cards().map((card) => card.querySelector('.name')?.textContent)).toEqual([
        ORCHESTRATOR,
        'ReserveInventory',
        'ChargePayment',
        'NotifyCustomer',
        EXTERNAL_EVENTS,
        DURABLE_TIMER,
      ]),
    );

    expect(kindOf(ORCHESTRATOR)).toBe('Orchestrator · this instance');
    expect(kindOf('ChargePayment')).toBe('Activity · 3 calls, 1 failed');

    // Neither of the two bindings is a function, so neither of them carries a count
    expect(kindOf(EXTERNAL_EVENTS)).toBe('External');
    expect(kindOf(DURABLE_TIMER)).toBe('Timer');

    // The tab is not claiming to be the hub's graph
    expect(screen.getByText(DERIVED_FROM_HISTORY)).toBeInTheDocument();
    expect(screen.queryByText(GRAPH_FOOTER)).toBeNull();
    expect(instance.isOnFunctionMap).toBe(false);
  });

  it('draws nothing that did not happen', async () => {
    const rendered = render(WorkspaceHarness, {
      props: {
        component: GraphTab,
        instanceId: INSTANCE_ID,
        functionGraph: false,
        capabilities: {},
        endpoints: {
          getOrchestration: async () => detailsFixture(),
          getHistory: async () => ({
            history: [historyEvent({ EventType: 'ExecutionStarted', Name: ORCHESTRATOR })],
          }),
        } as unknown as Endpoints,
      },
    });

    const instance = (rendered.component as unknown as { instanceState: () => InstanceState }).instanceState();

    void instance.history.load();

    // SendConfirmation is on the hub's map and is not on this one: it was never called
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(kindOf(ORCHESTRATOR)).toBe('Orchestrator · this instance');
  });
});
