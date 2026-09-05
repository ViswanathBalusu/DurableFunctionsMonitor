// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { BackendClient } from './client';
import { createEndpoints, encodeInstanceId, normalizeAbout } from './endpoints';

/** Records every call instead of making one; the URL is what these tests are about. */
function recordingClient() {
  const calls: { method: string; url: string; body?: unknown; opts?: unknown }[] = [];

  const client: BackendClient = {
    isVsCode: false,
    get: async <T>(url: string, opts?: { conditional?: boolean }) => {
      calls.push({ method: 'GET', url, opts });
      return undefined as T;
    },
    post: async <T>(url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return undefined as T;
    },
    put: async <T>(url: string, body?: unknown) => {
      calls.push({ method: 'PUT', url, body });
      return undefined as T;
    },
    download: async (url: string, fileName: string) => {
      calls.push({ method: 'DOWNLOAD', url, body: fileName });
    },
    host: {
      openInNewWindow: () => {},
      saveAs: async () => {},
      gotoFunctionCode: async () => {},
      gotoBinding: async () => {},
      saveFunctionGraphAsJson: async () => {},
      persistState: () => {},
    },
  };

  return { client, calls, last: () => calls[calls.length - 1] };
}

describe('listOrchestrations', () => {
  it('builds the query in the order of contracts §6', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).listOrchestrations({
      top: 50,
      skip: 0,
      filter: "createdTime ge '2026-09-04T00:00:00Z'",
      orderBy: 'createdTime desc',
      hiddenColumns: ['input', 'output'],
    });

    expect(last().url).toBe(
      "/orchestrations?$top=50&$skip=0&$filter=createdTime ge '2026-09-04T00:00:00Z'&$orderby=createdTime desc&hidden-columns=input|output",
    );
  });

  it('leaves out the optional parameters that were not given', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).listOrchestrations({ top: 20, skip: 40, filter: '' });

    expect(last().url).toBe('/orchestrations?$top=20&$skip=40');
  });
});

describe('instance ids', () => {
  it('percent-encodes a quote so it cannot close the OData segment', () => {
    expect(encodeInstanceId("a'b")).toBe('a%27b');
  });

  it("addresses orchestrations('a%27b') for an id containing a quote", async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).getOrchestration("a'b");

    expect(last().url).toBe("/orchestrations('a%27b')");
  });

  it('encodes the other unsafe characters of an id', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).getOrchestration('a/b c&d');

    expect(last().url).toBe("/orchestrations('a%2Fb%20c%26d')");
  });

  it('asks for a conditional GET only when told to', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.getOrchestration('order-1');
    await endpoints.getOrchestration('order-1', true);

    expect(calls[0].opts).toEqual({ conditional: false });
    expect(calls[1].opts).toEqual({ conditional: true });
  });
});

describe('history', () => {
  it('pages and filters', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).getHistory('order-1', { top: 200, skip: 200, filter: "EventType eq 'TaskFailed'" });

    expect(last().url).toBe("/orchestrations('order-1')/history?$top=200&$skip=200&$filter=EventType eq 'TaskFailed'");
  });

  it('omits an empty filter', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).getHistory('order-1', { top: 200, skip: 0 });

    expect(last().url).toBe("/orchestrations('order-1')/history?$top=200&$skip=0");
  });
});

describe('instance actions', () => {
  it('posts an action with its reason', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).postAction('order-1', 'terminate', 'because');

    expect(last()).toMatchObject({ method: 'POST', url: "/orchestrations('order-1')/terminate", body: 'because' });
  });

  it('posts a raised event as { name, data }', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).raiseEvent('order-1', 'PaymentApproved', { amount: 42 });

    expect(last()).toMatchObject({
      url: "/orchestrations('order-1')/raise-event",
      body: { name: 'PaymentApproved', data: { amount: 42 } },
    });
  });

  it('passes null through when clearing the custom status', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).setCustomStatus('order-1', null);

    expect(last()).toMatchObject({ url: "/orchestrations('order-1')/set-custom-status", body: null });
  });

  it('restarts with or without a new id', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).restart('order-1', true);

    expect(last()).toMatchObject({
      url: "/orchestrations('order-1')/restart",
      body: { restartWithNewInstanceId: true },
    });
  });

  it('downloads one field under a readable file name', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).downloadField('order-1', 'output');

    expect(last()).toMatchObject({
      method: 'DOWNLOAD',
      url: "/orchestrations('order-1')/output",
      body: 'order-1-output',
    });
  });

  it('encodes the template name of a custom tab', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).customTabMarkup('order-1', 'My Tab');

    expect(last().url).toBe("/orchestrations('order-1')/custom-tab-markup('My%20Tab')");
  });
});

describe('input events', () => {
  it('reads the events of an instance', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).inputEvents('order-1');

    expect(last().url).toBe("/orchestrations('order-1')/input-events");
  });

  it('posts the three recovery operations with their request bodies', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.updateInputAndRewind('order-1', { sequenceNumber: 27, input: { a: 1 } });
    await endpoints.replay('order-1', { sequenceNumber: 27, terminateIfRunning: true });
    await endpoints.restartInPlace('order-1', { input: { a: 1 } });

    expect(calls.map((c) => c.url)).toEqual([
      "/orchestrations('order-1')/update-input-and-rewind",
      "/orchestrations('order-1')/replay",
      "/orchestrations('order-1')/restart-in-place",
    ]);
    expect(calls[0].body).toEqual({ sequenceNumber: 27, input: { a: 1 } });
    expect(calls[1].body).toEqual({ sequenceNumber: 27, terminateIfRunning: true });
  });
});

describe('hub administration', () => {
  it('encodes an id-suggestions prefix', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).idSuggestions('order 2026/09');

    expect(last().url).toBe("/id-suggestions(prefix='order%202026%2F09')");
  });

  it('addresses the two hub-less calls past the hub segment', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.easyAuthConfig();
    await endpoints.taskHubNames();

    expect(calls.map((c) => c.url)).toEqual(['../easyauth-config', '../task-hub-names']);
  });

  it('posts the hub-wide operations', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.purgeHistory({
      timeFrom: '2026-09-01T00:00:00Z',
      timeTill: '2026-09-04T00:00:00Z',
      statuses: ['Completed'],
      entityType: 'Orchestration',
    });
    await endpoints.cleanEntityStorage({ removeEmptyEntities: true, releaseOrphanedLocks: false });
    await endpoints.deleteTaskHub();

    expect(calls.map((c) => c.url)).toEqual(['/purge-history', '/clean-entity-storage', '/delete-task-hub']);
    expect(calls[1].body).toEqual({ removeEmptyEntities: true, releaseOrphanedLocks: false });
  });
});

describe('aggregation endpoints', () => {
  it('sends only the stats parameters that were given', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.stats({ from: '2026-09-04T00:00:00Z', to: '2026-09-04T12:00:00Z' });
    await endpoints.stats({ from: '2026-09-04T00:00:00Z', to: '2026-09-04T12:00:00Z', bins: 24, stuckAfterMinutes: 5 });

    expect(calls[0].url).toBe('/stats?from=2026-09-04T00%3A00%3A00Z&to=2026-09-04T12%3A00%3A00Z');
    expect(calls[1].url).toBe(
      '/stats?from=2026-09-04T00%3A00%3A00Z&to=2026-09-04T12%3A00%3A00Z&bins=24&stuckAfterMinutes=5',
    );
  });

  it('reads children and spans of an instance', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.children('order-1');
    await endpoints.spans('order-1', true);

    expect(calls[0].url).toBe("/orchestrations('order-1')/children");
    expect(calls[1]).toMatchObject({ url: "/orchestrations('order-1')/spans", opts: { conditional: true } });
  });

  it('sends the failures range', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).failures({ from: '2026-09-04T00:00:00Z', to: '2026-09-04T12:00:00Z' });

    expect(last().url).toBe('/failures?from=2026-09-04T00%3A00%3A00Z&to=2026-09-04T12%3A00%3A00Z');
  });

  it('posts a batch request', async () => {
    const { client, last } = recordingClient();

    await createEndpoints(client).batch({ action: 'terminate', instanceIds: ['a', 'b'], payload: { reason: 'x' } });

    expect(last()).toMatchObject({
      method: 'POST',
      url: '/orchestrations/batch',
      body: { action: 'terminate', instanceIds: ['a', 'b'], payload: { reason: 'x' } },
    });
  });

  it('asks for storage counts and a scoped instance only when requested', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.storage();
    await endpoints.storage({ counts: true, instanceId: "a'b" });

    expect(calls[0].url).toBe('/storage');
    expect(calls[1].url).toBe("/storage?counts=true&instanceId=a'b");
  });

  it('builds the entities query', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.entities();
    await endpoints.entities({ name: 'Counter', keyPrefix: 'warehouse-', top: 50, skip: 0 });

    expect(calls[0].url).toBe('/entities');
    expect(calls[1].url).toBe('/entities?name=Counter&keyPrefix=warehouse-&$top=50&$skip=0');
  });

  it('builds the audit query', async () => {
    const { client, calls } = recordingClient();
    const endpoints = createEndpoints(client);

    await endpoints.audit();
    await endpoints.audit({ from: '2026-09-04T00:00:00Z', operation: 'Batch terminate', top: 100 });

    expect(calls[0].url).toBe('/audit');
    expect(calls[1].url).toBe('/audit?from=2026-09-04T00%3A00%3A00Z&operation=Batch%20terminate&$top=100');
  });
});

describe('normalizeAbout', () => {
  it('fills every missing field of a pre-B0 backend', () => {
    const about = normalizeAbout({ permissions: [] });

    expect(about.provider).toBe('unknown');
    expect(about.readOnly).toBe(true);
    expect(about.dangerousOperations).toBe(false);
    expect(Object.values(about.capabilities).every((c) => c === false)).toBe(true);
    expect(about.templates).toEqual({
      functionMapAvailable: false,
      functionCount: null,
      liquidTabs: [],
      customMetaTag: false,
    });
  });

  it('derives readOnly and dangerousOperations from the permissions when the backend does not say', () => {
    const about = normalizeAbout({
      permissions: ['DurableFunctionsMonitor.ReadWrite', 'DurableFunctionsMonitor.DangerousOperations'],
    });

    expect(about.readOnly).toBe(false);
    expect(about.dangerousOperations).toBe(true);
  });

  it('keeps what a B0 backend actually said', () => {
    const about = normalizeAbout({
      accountName: 'mystorageaccount',
      hubName: 'DurableFunctionsHub',
      version: '6.9.0 (isolated)',
      permissions: ['DurableFunctionsMonitor.ReadWrite'],
      provider: 'AzureStorage',
      readOnly: false,
      dangerousOperations: false,
      capabilities: { stats: true, spans: true } as never,
      templates: { functionMapAvailable: true, functionCount: 12, liquidTabs: ['My Tab'], customMetaTag: false },
    });

    expect(about.provider).toBe('AzureStorage');
    expect(about.capabilities.stats).toBe(true);
    expect(about.capabilities.spans).toBe(true);

    // The capabilities it did not mention stay off rather than becoming undefined
    expect(about.capabilities.audit).toBe(false);

    expect(about.templates.functionCount).toBe(12);
  });

  it('survives a completely empty body', () => {
    const about = normalizeAbout(null);

    expect(about.hubName).toBe('');
    expect(about.readOnly).toBe(true);
    expect(about.permissions).toEqual([]);
  });
});
