// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  PayloadTooLargeError,
  ServerError,
  UnauthorizedError,
} from './client';
import { apiHubSegment, clientHubSegment } from './hub-segment';
import { HttpBackendClient, RELOAD_GUARD_KEY } from './http-client';

type FetchArgs = [input: string, init: RequestInit];

function fetchMock(...responses: (Response | (() => Response | Promise<Response>))[]) {
  let call = 0;
  return vi.fn(async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    // cloned, so the last response can answer more than one call
    return typeof next === 'function' ? await next() : next.clone();
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function argsOf(fetchSpy: ReturnType<typeof vi.fn>, index: number): FetchArgs {
  return fetchSpy.mock.calls[index] as unknown as FetchArgs;
}

function headersOf(fetchSpy: ReturnType<typeof vi.fn>, index: number): Record<string, string> {
  return (argsOf(fetchSpy, index)[1].headers ?? {}) as Record<string, string>;
}

function newClient(hub: string, authHeaders: Record<string, string> = {}, reload = vi.fn()) {
  return {
    client: new HttpBackendClient(
      () => hub,
      async () => authHeaders,
      { reload },
    ),
    reload,
  };
}

describe('hub-segment', () => {
  it('prefixes a plain hub name with -- and leaves a connection-qualified one alone', () => {
    expect(apiHubSegment('DurableFunctionsHub', 'GET', '/about')).toBe('--DurableFunctionsHub');
    expect(apiHubSegment('conn-hub', 'GET', '/about')).toBe('conn-hub');
  });

  it('lower-cases TestHubName only when POSTing to /orchestrations or /restart', () => {
    expect(apiHubSegment('MyTestHubName', 'POST', '/orchestrations')).toBe('--Mytesthubname');
    expect(apiHubSegment('MyTestHubName', 'POST', "/orchestrations('abc')/restart")).toBe('--Mytesthubname');
    expect(apiHubSegment('MyTestHubName', 'GET', '/orchestrations')).toBe('--MyTestHubName');
    expect(apiHubSegment('MyTestHubName', 'POST', "/orchestrations('abc')/purge")).toBe('--MyTestHubName');
  });

  it('returns the client-side hub segment as typed', () => {
    expect(clientHubSegment('DurableFunctionsHub')).toBe('DurableFunctionsHub');
    expect(clientHubSegment('conn-hub')).toBe('conn-hub');
  });
});

describe('HttpBackendClient', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'x-dfm-xsrf-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('url building', () => {
    it('prefixes a plain hub name with -- and keeps a connection-qualified one as is', async () => {
      const fetchSpy = fetchMock(jsonResponse({ hubName: 'DurableFunctionsHub' }));
      vi.stubGlobal('fetch', fetchSpy);

      const plain = newClient('DurableFunctionsHub').client;
      await plain.get('/about');
      expect(argsOf(fetchSpy, 0)[0]).toBe('/a/p/i/--DurableFunctionsHub/about');

      const qualified = newClient('conn-hub').client;
      await qualified.get('/about');
      expect(argsOf(fetchSpy, 1)[0]).toBe('/a/p/i/conn-hub/about');
    });

    it('applies the TestHubName workaround to POST /orchestrations only', async () => {
      const fetchSpy = fetchMock(jsonResponse({ instanceId: 'x' }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('MyTestHubName');

      await client.post('/orchestrations', { name: 'Order' });
      await client.get('/orchestrations');

      expect(argsOf(fetchSpy, 0)[0]).toBe('/a/p/i/--Mytesthubname/orchestrations');
      expect(argsOf(fetchSpy, 1)[0]).toBe('/a/p/i/--MyTestHubName/orchestrations');
    });

    it('addresses the hub-less calls through a ../ prefix', async () => {
      const fetchSpy = fetchMock(jsonResponse({ clientId: null }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await client.get('../easyauth-config');

      expect(argsOf(fetchSpy, 0)[0]).toBe('/a/p/i/easyauth-config');
    });

    it('honours a non-default DfmApiRoutePrefix', async () => {
      (globalThis as Record<string, unknown>).DfmApiRoutePrefix = 'durable-functions-monitor/a/p/i';
      vi.resetModules();
      try {
        const fetchSpy = fetchMock(jsonResponse({}));
        vi.stubGlobal('fetch', fetchSpy);
        const module = await import('./http-client');
        const client = new module.HttpBackendClient(
          () => 'DurableFunctionsHub',
          async () => ({}),
        );

        await client.get('/about');

        expect(argsOf(fetchSpy, 0)[0]).toBe('/durable-functions-monitor/a/p/i/--DurableFunctionsHub/about');
      } finally {
        delete (globalThis as Record<string, unknown>).DfmApiRoutePrefix;
        vi.resetModules();
      }
    });
  });

  describe('headers and bodies', () => {
    it('sends the xsrf cookie, the auth header, JSON and same-origin credentials', async () => {
      document.cookie = 'x-dfm-xsrf-token=tok%20en';
      const fetchSpy = fetchMock(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub', { Authorization: 'Bearer abc' });

      await client.post('/purge-history', { statuses: ['Failed'] });

      const [, init] = argsOf(fetchSpy, 0);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('same-origin');
      expect(init.body).toBe('{"statuses":["Failed"]}');
      expect(headersOf(fetchSpy, 0)).toMatchObject({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer abc',
        'x-dfm-xsrf-token': 'tok en',
      });
    });

    it('sends no body and no content type when there is nothing to send', async () => {
      const fetchSpy = fetchMock(new Response('', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await client.post("/orchestrations('a')/purge");

      expect(argsOf(fetchSpy, 0)[1].body).toBeUndefined();
      expect(headersOf(fetchSpy, 0)['Content-Type']).toBeUndefined();
    });

    it('resolves a non-JSON response as a string (custom tab markup)', async () => {
      const fetchSpy = fetchMock(
        new Response('<h1>Order</h1>', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      const markup = await client.post<string>("/orchestrations('a')/custom-tab-markup('x')");

      expect(markup).toBe('<h1>Order</h1>');
    });

    it('put sends the JSON body', async () => {
      const fetchSpy = fetchMock(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await client.put('/whatever', { a: 1 });

      expect(argsOf(fetchSpy, 0)[1].method).toBe('PUT');
      expect(argsOf(fetchSpy, 0)[1].body).toBe('{"a":1}');
    });
  });

  describe('error mapping', () => {
    it('maps a 404 text body to NotFoundError with the body as the message', async () => {
      const fetchSpy = fetchMock(
        new Response('Instance order-1 does not exist', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      const error = await client.get("/orchestrations('order-1')").catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).status).toBe(404);
      expect((error as NotFoundError).message).toBe('Instance order-1 does not exist');
      expect((error as NotFoundError).body).toBeUndefined();
    });

    it('maps a 500 JSON body to ServerError and keeps the parsed body', async () => {
      const recovery = { error: 'Rewind failed', sequenceNumber: 27, inputUpdated: true, rewound: false };
      const fetchSpy = fetchMock(jsonResponse(recovery, { status: 500 }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      const error = await client
        .post("/orchestrations('order-1')/update-input-and-rewind", {})
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ServerError);
      expect((error as ServerError).status).toBe(500);
      expect((error as ServerError).body).toEqual(recovery);
      expect((error as ServerError).message).toBe('Rewind failed');
    });

    it('maps every other documented status to its class', async () => {
      const statuses: [number, unknown][] = [
        [400, BadRequestError],
        [401, UnauthorizedError],
        [403, ForbiddenError],
        [409, ConflictError],
        [413, PayloadTooLargeError],
      ];

      for (const [status, ctor] of statuses) {
        const fetchSpy = fetchMock(new Response('nope', { status, headers: { 'content-type': 'text/plain' } }));
        vi.stubGlobal('fetch', fetchSpy);
        const { client } = newClient('DurableFunctionsHub');

        const error = await client.get('/about').catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ctor as new () => Error);
        expect((error as ServerError).status).toBe(status);
        expect((error as ServerError).message).toBe('nope');
      }
    });

    it('throws NetworkError when fetch itself fails', async () => {
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      const error = await client.get('/about').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).status).toBe(0);
    });
  });

  describe('conditional get', () => {
    it('sends If-None-Match on the second call and resolves the cached body on 304', async () => {
      const details = { instanceId: 'order-1', runtimeStatus: 'Running' };
      const fetchSpy = fetchMock(
        jsonResponse(details, { headers: { ETag: 'W/"638000000000000000:Running"' } }),
        new Response(null, { status: 304, headers: { ETag: 'W/"638000000000000000:Running"' } }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      const first = await client.get("/orchestrations('order-1')", { conditional: true });
      const second = await client.get("/orchestrations('order-1')", { conditional: true });

      expect(headersOf(fetchSpy, 0)['If-None-Match']).toBeUndefined();
      expect(headersOf(fetchSpy, 1)['If-None-Match']).toBe('W/"638000000000000000:Running"');
      expect(first).toEqual(details);
      expect(second).toBe(first);
    });

    it('replaces the cached body when the etag changed', async () => {
      const running = { instanceId: 'order-1', runtimeStatus: 'Running' };
      const completed = { instanceId: 'order-1', runtimeStatus: 'Completed' };
      const fetchSpy = fetchMock(
        jsonResponse(running, { headers: { ETag: 'W/"1:Running"' } }),
        jsonResponse(completed, { headers: { ETag: 'W/"2:Completed"' } }),
        new Response(null, { status: 304, headers: { ETag: 'W/"2:Completed"' } }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await client.get("/orchestrations('order-1')", { conditional: true });
      const second = await client.get("/orchestrations('order-1')", { conditional: true });
      const third = await client.get("/orchestrations('order-1')", { conditional: true });

      expect(headersOf(fetchSpy, 2)['If-None-Match']).toBe('W/"2:Completed"');
      expect(second).toEqual(completed);
      expect(third).toBe(second);
    });

    it('never sends If-None-Match for a plain get', async () => {
      const fetchSpy = fetchMock(jsonResponse({ a: 1 }, { headers: { ETag: 'W/"1:Running"' } }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await client.get('/about');
      await client.get('/about');

      expect(headersOf(fetchSpy, 1)['If-None-Match']).toBeUndefined();
    });
  });

  describe('cookie expiry reload guard', () => {
    it('reloads the page once, no matter how many network errors follow', async () => {
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const { client, reload } = newClient('DurableFunctionsHub');
      client.reloadOnNetworkError = true;

      await expect(client.get('/about')).rejects.toBeInstanceOf(NetworkError);
      await expect(client.get('/about')).rejects.toBeInstanceOf(NetworkError);

      expect(reload).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe('1');
    });

    it('does not reload again after the guard survived a reload', async () => {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const { client, reload } = newClient('DurableFunctionsHub');
      client.reloadOnNetworkError = true;

      await expect(client.get('/about')).rejects.toBeInstanceOf(NetworkError);

      expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload before a successful login', async () => {
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const { client, reload } = newClient('DurableFunctionsHub');

      await expect(client.get('/about')).rejects.toBeInstanceOf(NetworkError);

      expect(reload).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBeNull();
    });
  });

  describe('download and host', () => {
    function stubObjectUrl() {
      const createObjectURL = vi.fn(() => 'blob:dfm');
      const revokeObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
      const downloads: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.getAttribute('download') ?? '');
      });
      return { createObjectURL, revokeObjectURL, downloads };
    }

    it('POSTs and names the file by content type', async () => {
      const { downloads } = stubObjectUrl();
      const fetchSpy = fetchMock(
        jsonResponse({ a: 1 }),
        new Response('plain', { status: 200, headers: { 'content-type': 'text/plain' } }),
        new Response('bytes', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await client.download("/orchestrations('order-1')/input", 'input');
      await client.download("/orchestrations('order-1')/output", 'output');
      await client.download("/orchestrations('order-1')/custom-status", 'custom-status');

      expect(argsOf(fetchSpy, 0)[0]).toBe("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/input");
      expect(argsOf(fetchSpy, 0)[1].method).toBe('POST');
      expect(downloads).toEqual(['input.json', 'output.txt', 'custom-status.dat']);
    });

    it('throws the mapped error instead of downloading it', async () => {
      stubObjectUrl();
      const fetchSpy = fetchMock(new Response('gone', { status: 404, headers: { 'content-type': 'text/plain' } }));
      vi.stubGlobal('fetch', fetchSpy);
      const { client } = newClient('DurableFunctionsHub');

      await expect(client.download("/orchestrations('order-1')/input", 'input')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('opens the instance in a new window and saves an svg as a file', async () => {
      const { createObjectURL, downloads } = stubObjectUrl();
      const open = vi.fn();
      vi.stubGlobal('open', open);
      const { client } = newClient('DurableFunctionsHub');

      client.host.openInNewWindow("order/2026'1");
      await client.host.saveAs('<svg/>', 'function-graph.svg');

      expect(open).toHaveBeenCalledWith("/DurableFunctionsHub/instances/order%2F2026'1");
      expect(downloads).toEqual(['function-graph.svg']);
      expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe('image/svg+xml');
    });

    it('resolves the VS Code-only host calls without doing anything', async () => {
      const { client } = newClient('DurableFunctionsHub');

      await expect(client.host.gotoFunctionCode('Order')).resolves.toBeUndefined();
      await expect(client.host.gotoBinding('Order', 0)).resolves.toBeUndefined();
      await expect(client.host.saveFunctionGraphAsJson()).resolves.toBeUndefined();
      expect(client.host.persistState('route', {})).toBeUndefined();
      expect(client.isVsCode).toBe(false);
    });
  });
});
