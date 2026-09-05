// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { Host } from '../host.svelte';
import { createStorages, VsCodeTypedLocalStorage } from './vscode-typed-local-storage';
import { TypedLocalStorage } from './typed-local-storage';

interface Fields {
  a: string;
  b: string;
}

function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    kind: 'vscode',
    vsCodeApi: { postMessage: vi.fn() },
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

describe('VsCodeTypedLocalStorage', () => {
  it('round trips setItem/getItem/removeItem in memory', () => {
    const host = fakeHost();
    const storage = new VsCodeTypedLocalStorage<Fields>('MyState', host);

    expect(storage.getItem('a')).toBeNull();

    storage.setItem('a', '1');
    expect(storage.getItem('a')).toBe('1');

    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
  });

  it('is seeded from host.stateFromVsCode[prefix]', () => {
    const host = fakeHost({ stateFromVsCode: { MyState: { a: 'seeded' } } });
    const storage = new VsCodeTypedLocalStorage<Fields>('MyState', host);

    expect(storage.getItem('a')).toBe('seeded');
  });

  it('setItem posts one PersistState message with the prefix as key and the whole state as data', () => {
    const host = fakeHost();
    const storage = new VsCodeTypedLocalStorage<Fields>('MyState', host);

    storage.setItem('a', '1');

    expect(host.vsCodeApi).toHaveProperty('postMessage');
    const postMessage = (host.vsCodeApi as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ method: 'PersistState', key: 'MyState', data: { a: '1' } });
  });

  it('setItems posts exactly one PersistState message per call, regardless of item count', () => {
    const host = fakeHost();
    const storage = new VsCodeTypedLocalStorage<Fields>('MyState', host);

    storage.setItems([
      { fieldName: 'a', value: '1' },
      { fieldName: 'b', value: '2' },
    ]);

    const postMessage = (host.vsCodeApi as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ method: 'PersistState', key: 'MyState', data: { a: '1', b: '2' } });
  });

  it('setItems with a null value removes the field before saving', () => {
    const host = fakeHost();
    const storage = new VsCodeTypedLocalStorage<Fields>('MyState', host);
    storage.setItem('a', '1');

    storage.setItems([{ fieldName: 'a', value: null }]);

    expect(storage.getItem('a')).toBeNull();
  });

  it('does not throw when host.vsCodeApi is missing', () => {
    const host = fakeHost({ vsCodeApi: null });
    const storage = new VsCodeTypedLocalStorage<Fields>('MyState', host);

    expect(() => storage.setItem('a', '1')).not.toThrow();
  });
});

describe('createStorages', () => {
  it('picks VsCodeTypedLocalStorage for a vscode host', () => {
    const host = fakeHost({ kind: 'vscode' });

    const storage = createStorages<Fields>(host, 'MyState');

    expect(storage).toBeInstanceOf(VsCodeTypedLocalStorage);
  });

  it('picks TypedLocalStorage for a browser host', () => {
    const host = fakeHost({ kind: 'browser' });

    const storage = createStorages<Fields>(host, 'MyState');

    expect(storage).toBeInstanceOf(TypedLocalStorage);
  });
});
