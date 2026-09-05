// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { FunctionMapResponse } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from '$lib/state/app.svelte';
import { Prefs } from '$lib/state/prefs.svelte';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';
import {
  actionDef,
  actionToast,
  entityKey,
  eventNames,
  type ActionPayload,
  type ActionTarget,
  type InstanceActionsApi,
} from './actions.svelte';

const INSTANCE_ID = 'order-2026-09-04-000913';

const ENTITY_ID = '@counter@warehouse-07';

function target(overrides: Partial<ActionTarget> = {}): ActionTarget {
  return { id: INSTANCE_ID, name: 'ProcessOrderOrchestrator', status: 'Running', ...overrides };
}

function entityTarget(overrides: Partial<ActionTarget> = {}): ActionTarget {
  return target({
    id: ENTITY_ID,
    name: 'counter',
    status: 'Pending',
    isEntity: true,
    key: 'warehouse-07',
    ...overrides,
  });
}

interface Calls {
  actions: { id: string; action: string; body?: unknown }[];
  raised: { id: string; name: string; data: unknown }[];
  customStatus: unknown[];
  restarts: boolean[];
  purges: string[];
}

function makeApp(options: { fail?: string } = {}) {
  window.history.replaceState({}, '', '/DurableFunctionsHub/instances');

  const calls: Calls = { actions: [], raised: [], customStatus: [], restarts: [], purges: [] };

  const raise = (what: string) => {
    if (options.fail === what) {
      throw new Error('403 Forbidden');
    }
  };

  const endpoints = {
    postAction: async (id: string, action: string, body?: unknown) => {
      raise(action);
      calls.actions.push({ id, action, body });
    },
    raiseEvent: async (id: string, name: string, data: unknown) => {
      raise('raise-event');
      calls.raised.push({ id, name, data });
    },
    setCustomStatus: async (_id: string, value: unknown) => {
      raise('set-custom-status');
      calls.customStatus.push(value);
    },
    restart: async (_id: string, withNewId: boolean) => {
      raise('restart');
      calls.restarts.push(withNewId);
    },
    purge: async (id: string) => {
      raise('purge');
      calls.purges.push(id);
    },
  } as unknown as Endpoints;

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub' });

  return { app, calls };
}

/** A stand-in for the open workspace: it records what it was asked to do. */
function fakeWorkspace(instanceId = INSTANCE_ID) {
  const done: string[] = [];
  const record = (what: string) => {
    done.push(what);
    return Promise.resolve(true);
  };

  const workspace: InstanceActionsApi = {
    instanceId,
    suspend: (reason) => record(`suspend:${reason ?? ''}`),
    resume: (reason) => record(`resume:${reason ?? ''}`),
    rewind: (reason) => record(`rewind:${reason ?? ''}`),
    terminate: (reason) => record(`terminate:${reason ?? ''}`),
    purge: () => record('purge'),
    restart: (withNewId) => record(`restart:${withNewId}`),
    raiseEvent: (name, data, message) => record(`raise:${name}:${JSON.stringify(data)}:${message ?? ''}`),
    setCustomStatus: (value) => record(`custom:${JSON.stringify(value)}`),
  };

  return { workspace, done };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/DurableFunctionsHub/instances');
});

describe('actionDef', () => {
  it('says what the mockup says, word for word', () => {
    expect(actionDef('terminate', target())).toMatchObject({
      title: `Terminate ${INSTANCE_ID}`,
      body:
        'Stops the instance where it is. Running activities finish but their results are ignored. ' +
        'This cannot be undone.',
      band: true,
      confirm: 'Terminate',
      variant: 'destructive',
      reason: true,
    });

    expect(actionDef('rewind', target())).toMatchObject({
      title: `Rewind ${INSTANCE_ID}`,
      body: 'Re-runs only the failed steps. Completed steps keep their results. Available for failed instances.',
      band: true,
      confirm: 'Rewind',
      variant: 'primary',
    });

    expect(actionDef('suspend', target()).body).toBe(
      'Pauses the instance. Timers and external events are held until you resume.',
    );
    expect(actionDef('resume', target()).body).toBe('Resumes the instance. Held timers and events are delivered.');
    expect(actionDef('restart', target())).toMatchObject({ confirm: 'Restart', restartOpts: true, band: false });
    expect(actionDef('raise', target())).toMatchObject({ title: 'Raise event', event: true, band: false });
    expect(actionDef('custom', target())).toMatchObject({ title: 'Set customStatus', custom: true });
  });

  it('says how much the purge is about to remove, and only what it knows', () => {
    expect(actionDef('purge', target()).body).toBe('Removes the instance, its history and its large-message blobs.');

    expect(actionDef('purge', target({ historyRows: 31 })).body).toBe(
      'Removes the instance, its 31 history rows and its large-message blobs.',
    );

    // Children are known only once E8 has loaded them; until then nothing is claimed about them
    expect(actionDef('purge', target({ historyRows: 31, childNames: ['NotifyCustomer'] })).body).toBe(
      'Removes the instance, its 31 history rows and its large-message blobs. ' +
        'The sub-orchestration NotifyCustomer is not purged.',
    );

    expect(actionDef('purge', target({ childNames: ['a', 'b'] })).body).toContain(
      'Its 2 sub-orchestrations are not purged.',
    );
  });

  it('titles the entity dialogs by the key, as the Entities screen does', () => {
    expect(actionDef('signal', entityTarget())).toMatchObject({
      title: 'Send signal to warehouse-07',
      body: 'Raises an operation on the entity. The entity function decides what the signal name means.',
      confirm: 'Send signal',
      signal: true,
    });

    expect(actionDef('purge', entityTarget())).toMatchObject({
      title: 'Purge warehouse-07',
      body: 'Removes the entity row and its history. The next signal recreates it with empty state.',
      confirm: 'Purge entity',
      variant: 'destructive',
      band: true,
    });
  });
});

describe('actionToast and the id helpers', () => {
  it('reports the state it left behind, or what it sent', () => {
    expect(actionToast('suspend', INSTANCE_ID)).toBe(`Suspended ${INSTANCE_ID}`);
    expect(actionToast('resume', INSTANCE_ID)).toBe(`Resumed ${INSTANCE_ID}`);
    expect(actionToast('purge', INSTANCE_ID)).toBe(`Purged ${INSTANCE_ID}`);
    expect(actionToast('raise', INSTANCE_ID)).toBe(`Raise event sent for ${INSTANCE_ID}`);
    expect(actionToast('custom', INSTANCE_ID)).toBe(`Set customStatus sent for ${INSTANCE_ID}`);
    expect(actionToast('signal', ENTITY_ID, 'warehouse-07')).toBe('Signal sent to warehouse-07');
  });

  it('takes the key out of an entity id, and nothing out of an orchestration id', () => {
    expect(entityKey(ENTITY_ID)).toBe('warehouse-07');
    expect(entityKey('@counter@tenant@eu-west')).toBe('tenant@eu-west');
    expect(entityKey(INSTANCE_ID)).toBeUndefined();
  });

  it('offers the signal names the function map knows, deduplicated and in order', () => {
    const map: FunctionMapResponse = {
      functions: {
        ProcessOrderOrchestrator: {
          isSignalledBy: [
            { name: 'RaiseShipment', signalName: 'ShipmentConfirmed' },
            { name: 'RaisePayment', signalName: 'PaymentApproved' },
          ],
        },
        OnboardTenantOrchestrator: { isSignalledBy: [{ name: 'RaisePayment', signalName: 'PaymentApproved' }] },
        ChargePayment: { bindings: [{ type: 'activityTrigger' }] },
      },
      proxies: {},
    };

    expect(eventNames(map)).toEqual(['PaymentApproved', 'ShipmentConfirmed']);
    expect(eventNames(null)).toEqual([]);
  });
});

describe('app.actions', () => {
  it('runs a one-off action against the endpoints, and reloads whatever list is on screen', async () => {
    const { app, calls } = makeApp();

    let refreshes = 0;
    app.onRefresh(() => (refreshes += 1));

    app.actions.open('suspend', target());

    expect(app.actions.isOpen).toBe(true);
    expect(app.actions.def?.title).toBe(`Suspend ${INSTANCE_ID}`);

    expect(await app.actions.run({ reason: 'holding for stock' })).toBe(true);

    expect(calls.actions).toEqual([{ id: INSTANCE_ID, action: 'suspend', body: 'holding for stock' }]);
    expect(app.toast.current?.message).toBe(`Suspended ${INSTANCE_ID}`);
    expect(app.actions.isOpen).toBe(false);
    expect(refreshes).toBe(1);
  });

  it('goes through the workspace when the action is about the instance it has open', async () => {
    const { app, calls } = makeApp();
    const { workspace, done } = fakeWorkspace();

    const unbind = app.actions.bind(workspace);

    app.actions.open('terminate', target());
    await app.actions.run({ reason: 'cancelled' });

    // The workspace reloads itself, so nothing is asked of the endpoints here
    expect(done).toEqual(['terminate:cancelled']);
    expect(calls.actions).toEqual([]);

    // A different instance is not the one the workspace has open
    app.actions.open('purge', target({ id: 'order-2026-09-04-000911' }));
    await app.actions.run();

    expect(calls.purges).toEqual(['order-2026-09-04-000911']);

    unbind();

    app.actions.open('resume', target());
    await app.actions.run();

    expect(done).toEqual(['terminate:cancelled']);
    expect(calls.actions).toEqual([{ id: INSTANCE_ID, action: 'resume', body: undefined }]);
  });

  it('sends an entity signal as a raised event, under its own name', async () => {
    const { app, calls } = makeApp();

    app.actions.open('signal', entityTarget());

    await app.actions.run({ name: 'add', data: { amount: 5 } });

    expect(calls.raised).toEqual([{ id: ENTITY_ID, name: 'add', data: { amount: 5 } }]);
    expect(app.toast.current?.message).toBe('Signal sent to warehouse-07');

    // Through the workspace it is the same endpoint, with the same wording
    const { workspace, done } = fakeWorkspace(ENTITY_ID);
    app.actions.bind(workspace);

    app.actions.open('signal', entityTarget());
    await app.actions.run({ name: 'add', data: null });

    expect(done).toEqual(['raise:add:null:Signal sent to warehouse-07']);
  });

  it('keeps the dialog open when the backend refuses, and says why', async () => {
    const { app } = makeApp({ fail: 'terminate' });

    app.actions.open('terminate', target());

    expect(await app.actions.run({ reason: '' })).toBe(false);
    expect(app.actions.isOpen).toBe(true);
    expect(app.toast.current?.message).toBe('Failed to terminate. 403 Forbidden');
  });

  it('runs one action at a time', async () => {
    const { app, calls } = makeApp();

    app.actions.open('purge', target());
    app.actions.busy = true;

    expect(await app.actions.run()).toBe(false);
    expect(calls.purges).toEqual([]);
  });
});

/** The dialogs are mounted in the shell, which is what makes them reachable from the peek. */
function mountShell(endpoints: Partial<Endpoints> = {}) {
  // The overview route renders a placeholder, so nothing but the dialogs asks anything of the endpoints
  const rendered = render(ShellHarness, { props: { path: '/DurableFunctionsHub', endpoints } });
  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function dialog(): HTMLElement {
  return document.querySelector('.dialog') as HTMLElement;
}

async function openFromPeek(app: AppState, action: string): Promise<void> {
  app.peek.open({
    id: INSTANCE_ID,
    name: 'ProcessOrderOrchestrator',
    kind: 'Orchestration',
    status: 'Running',
    created: '2026-09-04T14:02:11Z',
    updated: '2026-09-04T14:02:58Z',
    duration: 47_000,
    customStatus: { step: 'ChargePayment', attempt: 2 },
  });

  await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeInTheDocument());
  await fireEvent.click(screen.getByRole('button', { name: action }));
  await waitFor(() => expect(dialog()).not.toBeNull());
}

describe('ActionDialogs', () => {
  it('raises an event from the peek panel, and posts what was filled in', async () => {
    const raised: ActionPayload[] = [];
    const { app } = mountShell({
      raiseEvent: async (_id: string, name: string, data: unknown) => void raised.push({ name, data }),
    });

    await openFromPeek(app, 'Raise event');

    expect(within(dialog()).getByText('Raise event', { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().textContent).toContain('The orchestrator must be waiting for an event with this exact name.');

    const confirm = within(dialog()).getByRole('button', { name: 'Raise event' });

    // An event with no name is not an event
    expect(confirm).toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Event name'), { target: { value: 'PaymentApproved' } });
    await waitFor(() => expect(confirm).toBeEnabled());

    await fireEvent.click(confirm);

    await waitFor(() => expect(raised).toEqual([{ name: 'PaymentApproved', data: null }]));
    expect(app.toast.current?.message).toBe(`Raise event sent for ${INSTANCE_ID}`);
    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
  });

  it('opens the raise dialog on what a caller prefilled', async () => {
    const raised: ActionPayload[] = [];
    const { app } = mountShell({
      raiseEvent: async (_id: string, name: string, data: unknown) => void raised.push({ name, data }),
    });

    app.actions.open('raise', target(), { prefill: { name: 'PaymentApproved', data: { transactionId: 'tx_9c2d' } } });

    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(screen.getByLabelText('Event name')).toHaveValue('PaymentApproved');

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Raise event' }));

    await waitFor(() => expect(raised).toEqual([{ name: 'PaymentApproved', data: { transactionId: 'tx_9c2d' } }]));
  });

  it('opens Set customStatus on what the instance holds, and clears it when it is emptied', async () => {
    const posted: unknown[] = [];
    const { app } = mountShell({ setCustomStatus: async (_id: string, value: unknown) => void posted.push(value) });

    app.actions.open('custom', target({ customStatus: { step: 'ChargePayment', attempt: 2 } }));

    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(dialog().textContent).toContain('The orchestrator can overwrite it again on its next replay.');
    expect(screen.getByRole('group', { name: 'customStatus (JSON)' })).toBeInTheDocument();

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Set customStatus' }));

    await waitFor(() => expect(posted).toEqual([{ step: 'ChargePayment', attempt: 2 }]));

    // An empty editor is how the status is cleared: null here, and no body at all on the wire
    app.actions.open('custom', target({ customStatus: null }));

    await waitFor(() => expect(dialog()).not.toBeNull());
    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Set customStatus' }));

    await waitFor(() => expect(posted).toEqual([{ step: 'ChargePayment', attempt: 2 }, null]));
  });

  it('restarts with a new id unless the box is unticked', async () => {
    const restarts: boolean[] = [];
    const { app } = mountShell({ restart: async (_id: string, withNewId: boolean) => void restarts.push(withNewId) });

    app.actions.open('restart', target());

    await waitFor(() => expect(dialog()).not.toBeNull());

    const box = within(dialog()).getByRole('checkbox', { name: 'Start with a new instance id' });

    // React parity: a restart makes a new instance unless the user says otherwise
    expect(box).toHaveAttribute('aria-checked', 'true');

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(restarts).toEqual([true]));

    app.actions.open('restart', target());
    await waitFor(() => expect(dialog()).not.toBeNull());

    await fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Start with a new instance id' }));
    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Restart' }));

    await waitFor(() => expect(restarts).toEqual([true, false]));
  });

  it('terminates from the peek behind the hazard band, and cancels back to it', async () => {
    const { app } = mountShell();

    await openFromPeek(app, 'Terminate');

    expect(within(dialog()).getByText(`Terminate ${INSTANCE_ID}`, { selector: 'h3' })).toBeInTheDocument();
    expect(dialog().querySelector('.warn')).not.toBeNull();
    expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument();

    await fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
    expect(app.actions.isOpen).toBe(false);
  });
});
