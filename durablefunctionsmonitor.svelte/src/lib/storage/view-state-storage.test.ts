// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Host } from '../host.svelte';
import { ViewStateStorage } from './view-state-storage';

interface Fields {
  filter: string;
  tab: string;
}

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

describe('ViewStateStorage (browser)', () => {
  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('round trips set/get/remove through localStorage under dfm.view.<screen>::<field>', () => {
    const storage = new ViewStateStorage<Fields>('instances', fakeHost());

    expect(storage.getItem('filter')).toBeNull();

    storage.setItem('filter', 'status eq Failed');
    expect(storage.getItem('filter')).toBe('status eq Failed');
    expect(localStorage.getItem('dfm.view.instances::filter')).toBe('status eq Failed');

    storage.removeItem('filter');
    expect(storage.getItem('filter')).toBeNull();
  });

  it('scopes the localStorage key by screen name', () => {
    const instances = new ViewStateStorage<Fields>('instances', fakeHost());
    const failures = new ViewStateStorage<Fields>('failures', fakeHost());

    instances.setItem('filter', 'a');
    failures.setItem('filter', 'b');

    // The query string is a flat, field-name-keyed namespace shared by every ViewStateStorage
    // (ported as-is from the React QueryString design), so two screens sharing a field name can
    // only have one value on the URL at a time. Clear it to prove the localStorage keys
    // themselves (`dfm.view.<screen>::<field>`) are scoped per screen.
    window.history.replaceState(null, '', window.location.pathname);

    expect(instances.getItem('filter')).toBe('a');
    expect(failures.getItem('filter')).toBe('b');
  });

  it('the query string takes precedence over localStorage', () => {
    const storage = new ViewStateStorage<Fields>('instances', fakeHost());
    storage.setItem('tab', 'from-storage');

    window.history.replaceState(null, '', '?tab=from-query-string');

    expect(storage.getItem('tab')).toBe('from-query-string');
  });
});

describe('ViewStateStorage (vscode)', () => {
  it('persists through PersistState under key view.<screen>', () => {
    const postMessage = vi.fn();
    const host = fakeHost({ kind: 'vscode', vsCodeApi: { postMessage } });
    const storage = new ViewStateStorage<Fields>('instances', host);

    storage.setItem('filter', 'status eq Failed');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      method: 'PersistState',
      key: 'view.instances',
      data: { filter: 'status eq Failed' },
    });
  });

  it('is seeded from host.stateFromVsCode["view.<screen>"]', () => {
    const host = fakeHost({ kind: 'vscode', stateFromVsCode: { 'view.instances': { tab: 'history' } } });
    const storage = new ViewStateStorage<Fields>('instances', host);

    expect(storage.getItem('tab')).toBe('history');
  });
});
