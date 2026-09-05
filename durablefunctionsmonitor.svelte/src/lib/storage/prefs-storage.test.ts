// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Host } from '../host.svelte';
import { PrefsStorage } from './prefs-storage';

function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    kind: 'browser',
    vsCodeApi: null,
    routePrefix: '',
    apiRoutePrefix: 'a/p/i',
    clientConfig: {},
    viewMode: 0,
    functionGraphAvailable: false,
    orchestrationIdFromVsCode: '',
    stateFromVsCode: {},
    ...overrides,
  };
}

describe('PrefsStorage (browser)', () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('round trips set/get/remove through plain dfm.<field> localStorage keys', () => {
    const storage = new PrefsStorage(fakeHost());

    expect(storage.getItem('theme')).toBeNull();

    storage.setItem('theme', 'riso');
    expect(storage.getItem('theme')).toBe('riso');
    expect(localStorage.getItem('dfm.theme')).toBe('riso');

    storage.removeItem('theme');
    expect(storage.getItem('theme')).toBeNull();
    expect(localStorage.getItem('dfm.theme')).toBeNull();
  });

  it('setItems writes/removes several fields in one call', () => {
    const storage = new PrefsStorage(fakeHost());

    storage.setItems([
      { fieldName: 'mode', value: 'dark' },
      { fieldName: 'density', value: 'compact' },
    ]);

    expect(storage.getItem('mode')).toBe('dark');
    expect(storage.getItem('density')).toBe('compact');

    storage.setItems([{ fieldName: 'mode', value: null }]);
    expect(storage.getItem('mode')).toBeNull();
  });

  it('never writes to the query string', () => {
    const storage = new PrefsStorage(fakeHost());

    storage.setItem('theme', 'riso');

    expect(window.location.search).toBe('');
  });
});

describe('PrefsStorage (vscode)', () => {
  it('persists through PersistState under the fixed key "prefs"', () => {
    const postMessage = vi.fn();
    const host = fakeHost({ kind: 'vscode', vsCodeApi: { postMessage } });
    const storage = new PrefsStorage(host);

    storage.setItem('theme', 'riso');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ method: 'PersistState', key: 'prefs', data: { theme: 'riso' } });
  });

  it('is seeded from host.stateFromVsCode.prefs', () => {
    const host = fakeHost({ kind: 'vscode', stateFromVsCode: { prefs: { theme: 'blueprint' } } });
    const storage = new PrefsStorage(host);

    expect(storage.getItem('theme')).toBe('blueprint');
  });
});
