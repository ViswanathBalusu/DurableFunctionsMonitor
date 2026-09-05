// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';

// host.svelte.ts reads globals once, at module-evaluation time, so every test that changes
// the globals must reset the module registry and re-import it dynamically.
const GLOBAL_KEYS = [
  'acquireVsCodeApi',
  'DfmRoutePrefix',
  'DfmApiRoutePrefix',
  'DfmClientConfig',
  'DfmViewMode',
  'IsFunctionGraphAvailable',
  'OrchestrationIdFromVsCode',
  'StateFromVsCode',
] as const;

function clearGlobals() {
  for (const key of GLOBAL_KEYS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

async function importHost() {
  vi.resetModules();
  const mod = await import('./host.svelte');
  return mod.host;
}

describe('host', () => {
  afterEach(() => {
    clearGlobals();
    vi.resetModules();
  });

  it('is the browser host with no globals defined', async () => {
    clearGlobals();

    const host = await importHost();

    expect(host.kind).toBe('browser');
    expect(host.vsCodeApi).toBeNull();
    expect(host.routePrefix).toBe('');
    expect(host.apiRoutePrefix).toBe('a/p/i');
    expect(host.clientConfig).toEqual({});
    expect(host.viewMode).toBe(0);
    expect(host.functionGraphAvailable).toBe(false);
    expect(host.orchestrationIdFromVsCode).toBe('');
    expect(host.stateFromVsCode).toEqual({});
  });

  it('is the vscode host when acquireVsCodeApi is defined, and caches its return value', async () => {
    clearGlobals();
    const fakeApi = { postMessage: vi.fn() };
    const acquire = vi.fn(() => fakeApi);
    (globalThis as Record<string, unknown>).acquireVsCodeApi = acquire;

    const host = await importHost();

    expect(host.kind).toBe('vscode');
    expect(host.vsCodeApi).toBe(fakeApi);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('stays vscode with a null vsCodeApi when acquireVsCodeApi throws', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).acquireVsCodeApi = () => {
      throw new Error('not available in this webview');
    };

    const host = await importHost();

    expect(host.kind).toBe('vscode');
    expect(host.vsCodeApi).toBeNull();
  });

  it('derives apiRoutePrefix from routePrefix when DfmApiRoutePrefix is empty', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).DfmRoutePrefix = 'dfm';

    const host = await importHost();

    expect(host.routePrefix).toBe('dfm');
    expect(host.apiRoutePrefix).toBe('dfm/a/p/i');
  });

  it('falls back to a/p/i when both routePrefix and DfmApiRoutePrefix are empty', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).DfmRoutePrefix = '';

    const host = await importHost();

    expect(host.apiRoutePrefix).toBe('a/p/i');
  });

  it('prefers DfmApiRoutePrefix over the derived prefix', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).DfmRoutePrefix = 'dfm';
    (globalThis as Record<string, unknown>).DfmApiRoutePrefix = 'custom/a/p/i';

    const host = await importHost();

    expect(host.apiRoutePrefix).toBe('custom/a/p/i');
  });

  it('reads clientConfig, viewMode, functionGraphAvailable, orchestrationIdFromVsCode and stateFromVsCode', async () => {
    clearGlobals();
    (globalThis as Record<string, unknown>).DfmClientConfig = { theme: 'dark', dfmTheme: 'blueprint' };
    (globalThis as Record<string, unknown>).DfmViewMode = 1;
    (globalThis as Record<string, unknown>).IsFunctionGraphAvailable = true;
    (globalThis as Record<string, unknown>).OrchestrationIdFromVsCode = 'order-1';
    (globalThis as Record<string, unknown>).StateFromVsCode = { prefs: { theme: 'riso' } };

    const host = await importHost();

    expect(host.clientConfig).toEqual({ theme: 'dark', dfmTheme: 'blueprint' });
    expect(host.viewMode).toBe(1);
    expect(host.functionGraphAvailable).toBe(true);
    expect(host.orchestrationIdFromVsCode).toBe('order-1');
    expect(host.stateFromVsCode).toEqual({ prefs: { theme: 'riso' } });
  });
});
