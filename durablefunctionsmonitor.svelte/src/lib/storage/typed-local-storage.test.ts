// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it } from 'vitest';
import { TypedLocalStorage } from './typed-local-storage';

interface Fields {
  a: string;
  b: string;
}

function resetUrl() {
  window.history.replaceState(null, '', window.location.pathname);
}

describe('TypedLocalStorage', () => {
  afterEach(() => {
    localStorage.clear();
    resetUrl();
  });

  it('round trips setItem/getItem/removeItem through localStorage', () => {
    resetUrl();
    const storage = new TypedLocalStorage<Fields>('MyState');

    expect(storage.getItem('a')).toBeNull();

    storage.setItem('a', '1');
    expect(storage.getItem('a')).toBe('1');
    expect(localStorage.getItem('MyState::a')).toBe('1');

    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
    expect(localStorage.getItem('MyState::a')).toBeNull();
  });

  it('setItems writes/removes several fields in one call', () => {
    resetUrl();
    const storage = new TypedLocalStorage<Fields>('MyState');

    storage.setItems([
      { fieldName: 'a', value: '1' },
      { fieldName: 'b', value: '2' },
    ]);
    expect(storage.getItem('a')).toBe('1');
    expect(storage.getItem('b')).toBe('2');

    storage.setItems([{ fieldName: 'a', value: null }]);
    expect(storage.getItem('a')).toBeNull();
    expect(storage.getItem('b')).toBe('2');
  });

  it('mirrors every write into the query string', () => {
    resetUrl();
    const storage = new TypedLocalStorage<Fields>('MyState');

    storage.setItem('a', 'hello world');

    expect(window.location.search).toContain('a=hello%20world');
  });

  it('removeItem drops the field from the query string too', () => {
    resetUrl();
    const storage = new TypedLocalStorage<Fields>('MyState');
    storage.setItem('a', '1');

    storage.removeItem('a');

    expect(window.location.search).not.toContain('a=');
  });

  it('getItem prefers the query string over localStorage', () => {
    resetUrl();
    const storage = new TypedLocalStorage<Fields>('MyState');
    storage.setItem('a', 'from-storage');

    // Simulate a shared link: the query string carries a different value than localStorage.
    window.history.replaceState(null, '', '?a=from-query-string');

    expect(storage.getItem('a')).toBe('from-query-string');
    expect(localStorage.getItem('MyState::a')).toBe('from-storage');
  });
});
