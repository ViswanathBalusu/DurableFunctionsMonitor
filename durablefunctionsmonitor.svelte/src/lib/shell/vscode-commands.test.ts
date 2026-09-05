// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import { VsCodeBackendClient, type VsCodeApi } from '$lib/api/vscode-client';
import type { Host } from '$lib/host.svelte';
import { host as browserHost } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from '$lib/state/app.svelte';
import { Prefs } from '$lib/state/prefs.svelte';
import { installVsCodeCommands } from './vscode-commands';

const storage = { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} };

/** A webview: memory routing, the bridge client, and an event target we can post messages on. */
function vsCodeApp() {
  const posted: unknown[] = [];
  const vsCodeApi: VsCodeApi = { postMessage: (message) => void posted.push(message) };
  const messages = new EventTarget();

  const host = { ...browserHost, kind: 'vscode', vsCodeApi } as unknown as Host;
  const client = new VsCodeBackendClient(vsCodeApi, messages);

  const app = new AppState({
    host,
    client,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'memory', hub: 'DurableFunctionsHub', routePrefix: '', storage: null }),
    prefs: new Prefs(host, storage),
  });

  /** What the extension does when the user picks one of its menu commands. */
  const send = (id: string, data: unknown = {}) => {
    messages.dispatchEvent(Object.assign(new Event('message'), { data: { id, data } }));
  };

  return { app, send, posted };
}

describe('installVsCodeCommands', () => {
  it('tells the extension it is ready for them', () => {
    const { app, posted } = vsCodeApp();

    installVsCodeCommands(app);

    expect(posted).toContainEqual({ method: 'IAmReady' });
  });

  it('sends batchOps to Instances with everything selected', () => {
    const { app, send } = vsCodeApp();

    installVsCodeCommands(app);
    send('batchOps', { ids: ['order-1'] });

    expect(app.router.current.name).toBe('instances');
    expect(app.router.current.query.get('selectAll')).toBe('1');
  });

  it('sends startNewInstance to Instances with its dialog', () => {
    const { app, send } = vsCodeApp();

    installVsCodeCommands(app);
    send('startNewInstance', { name: 'ProcessOrder' });

    expect(app.router.current.name).toBe('instances');
    expect(app.router.current.query.get('start')).toBe('1');
  });

  it('sends the two storage commands to Settings, naming the dialog', () => {
    const { app, send } = vsCodeApp();

    installVsCodeCommands(app);

    send('purgeHistory', { hubName: 'DurableFunctionsHub' });
    expect(app.router.current.name).toBe('settings');
    expect(app.router.current.query.get('dialog')).toBe('purge');

    send('cleanEntityStorage');
    expect(app.router.current.query.get('dialog')).toBe('clean');
  });

  it('keeps the hub it is bound to', () => {
    const { app, send } = vsCodeApp();

    installVsCodeCommands(app);
    send('batchOps');

    expect(app.hub).toBe('DurableFunctionsHub');
  });

  it('does nothing in the browser, where there is no extension to talk to', () => {
    const app = new AppState({
      host: browserHost,
      client: { setCustomHandlers: vi.fn() } as never,
      endpoints: {} as Endpoints,
      router: new Router({ mode: 'history', routePrefix: '' }),
      prefs: new Prefs(browserHost, storage),
    });

    installVsCodeCommands(app);

    expect(
      (app.client as unknown as { setCustomHandlers: ReturnType<typeof vi.fn> }).setCustomHandlers,
    ).not.toHaveBeenCalled();
  });
});
