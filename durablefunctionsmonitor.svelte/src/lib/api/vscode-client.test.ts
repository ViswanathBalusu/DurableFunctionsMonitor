// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, PayloadTooLargeError, ServerError } from './client';
import { VsCodeBackendClient, type VsCodeCustomMessageHandlers } from './vscode-client';

interface BridgeMessage {
  id?: string;
  method?: string;
  url?: string;
  data?: unknown;
  key?: string;
}

function newClient() {
  const posted: BridgeMessage[] = [];
  const vsCodeApi = { postMessage: (message: unknown) => void posted.push(message as BridgeMessage) };
  const client = new VsCodeBackendClient(vsCodeApi);
  return { client, posted };
}

/** The extension answers on the webview's window; ids correlate request and response. */
function answer(message: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

function handlers(): VsCodeCustomMessageHandlers & { calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    purgeHistory: (data) => void calls.push(['purgeHistory', data]),
    cleanEntityStorage: (data) => void calls.push(['cleanEntityStorage', data]),
    startNewInstance: (data) => void calls.push(['startNewInstance', data]),
    batchOps: (data) => void calls.push(['batchOps', data]),
  };
}

describe('VsCodeBackendClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the VS Code client', () => {
    expect(newClient().client.isVsCode).toBe(true);
  });

  it('posts the request and resolves the promise the response id belongs to', async () => {
    const { client, posted } = newClient();

    const about = client.get('/about');
    const history = client.get("/orchestrations('order-1')/history?$top=50");

    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({ method: 'GET', url: '/about' });
    expect(posted[1]).toMatchObject({ method: 'GET', url: "/orchestrations('order-1')/history?$top=50" });
    expect(posted[0].id).not.toBe(posted[1].id);

    // answered out of order on purpose
    answer({ id: posted[1].id, data: { history: [] } });
    answer({ id: posted[0].id, data: { hubName: 'DurableFunctionsHub' } });

    await expect(about).resolves.toEqual({ hubName: 'DurableFunctionsHub' });
    await expect(history).resolves.toEqual({ history: [] });
  });

  it('posts POST and PUT bodies as data', async () => {
    const { client, posted } = newClient();

    const promise = client.post("/orchestrations('order-1')/raise-event", { name: 'Approved', data: 1 });
    client.put('/whatever', { a: 1 });

    expect(posted[0]).toMatchObject({
      method: 'POST',
      url: "/orchestrations('order-1')/raise-event",
      data: { name: 'Approved', data: 1 },
    });
    expect(posted[1]).toMatchObject({ method: 'PUT', url: '/whatever', data: { a: 1 } });

    answer({ id: posted[0].id, data: null });
    await expect(promise).resolves.toBeNull();
  });

  it('rejects with the mapped bridge error, keeping response.data as the body', async () => {
    const { client, posted } = newClient();

    const promise = client.get("/orchestrations('nope')");
    answer({
      id: posted[0].id,
      err: { message: 'Request failed with status code 404', response: { data: 'Instance not found' } },
    });

    const error = await promise.catch((err: unknown) => err);

    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).status).toBe(404);
    expect((error as NotFoundError).message).toBe('Request failed with status code 404');
    expect((error as NotFoundError).body).toBe('Instance not found');
  });

  it('guesses every documented status out of the message and falls back to 500', async () => {
    const cases: [string, number, unknown][] = [
      ['Request failed with status code 409', 409, ConflictError],
      ['Request failed with status code 413', 413, PayloadTooLargeError],
      ['connect ECONNREFUSED 127.0.0.1:7072', 500, ServerError],
    ];

    for (const [message, status, ctor] of cases) {
      const { client, posted } = newClient();
      const promise = client.post('/whatever');
      answer({ id: posted[0].id, err: { message } });

      const error = await promise.catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ctor as new () => Error);
      expect((error as ServerError).status).toBe(status);
      expect((error as ServerError).message).toBe(message);
      expect((error as ServerError).body).toBeUndefined();
    }
  });

  it('posts IAmReady once, however often the handlers are registered', () => {
    const { client, posted } = newClient();

    client.setCustomHandlers(handlers());
    client.setCustomHandlers(handlers());

    expect(posted.filter((message) => message.method === 'IAmReady')).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it('routes the extension menu commands to the custom handlers', () => {
    const { client } = newClient();
    const custom = handlers();
    client.setCustomHandlers(custom);

    answer({ id: 'purgeHistory', data: { hubName: 'DurableFunctionsHub' } });
    answer({ id: 'cleanEntityStorage', data: {} });
    answer({ id: 'startNewInstance', data: { name: 'Order' } });
    answer({ id: 'batchOps', data: { ids: ['order-1'] } });

    expect(custom.calls).toEqual([
      ['purgeHistory', { hubName: 'DurableFunctionsHub' }],
      ['cleanEntityStorage', {}],
      ['startNewInstance', { name: 'Order' }],
      ['batchOps', { ids: ['order-1'] }],
    ]);
  });

  it('survives a throwing handler and an unknown message id', () => {
    const { client } = newClient();
    const custom = handlers();
    custom.purgeHistory = () => {
      throw new Error('boom');
    };
    client.setCustomHandlers(custom);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => answer({ id: 'purgeHistory', data: {} })).not.toThrow();
    expect(() => answer({ id: 'no-such-request', data: {} })).not.toThrow();
    expect(() => answer(null)).not.toThrow();
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('forwards downloads and the host bridge messages', async () => {
    const { client, posted } = newClient();

    const download = client.download("/orchestrations('order-1')/input", 'input');
    const saveAs = client.host.saveAs('<svg/>', 'function-graph.svg');
    const gotoCode = client.host.gotoFunctionCode('OrderOrchestrator');
    const gotoBinding = client.host.gotoBinding('OrderOrchestrator', 2);
    const saveGraph = client.host.saveFunctionGraphAsJson();
    client.host.openInNewWindow('order-1');
    client.host.persistState('route', { name: 'instances' });

    expect(posted[0]).toMatchObject({ method: 'Download', url: "/orchestrations('order-1')/input", data: 'input' });
    expect(posted[1]).toMatchObject({ method: 'SaveAs', url: 'function-graph.svg', data: '<svg/>' });
    expect(posted[2]).toMatchObject({ method: 'GotoFunctionCode', url: 'OrderOrchestrator' });
    expect(posted[3]).toMatchObject({ method: 'GotoBinding', url: 'OrderOrchestrator', data: 2 });
    expect(posted[4]).toMatchObject({ method: 'SaveFunctionGraphAsJson', url: '' });
    expect(posted[5]).toMatchObject({ method: 'OpenInNewWindow', url: 'order-1' });
    expect(posted[6]).toEqual({ method: 'PersistState', key: 'route', data: { name: 'instances' } });
    expect(posted[6].id).toBeUndefined();

    for (const message of posted.slice(0, 5)) {
      answer({ id: message.id, data: undefined });
    }
    await expect(Promise.all([download, saveAs, gotoCode, gotoBinding, saveGraph])).resolves.toHaveLength(5);
  });
});
