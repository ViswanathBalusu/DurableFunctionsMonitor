// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, describe, expect, it } from 'vitest';
import { QueryString } from './query-string';

function setSearch(search: string) {
  window.history.replaceState(null, '', search ? `${search}` : window.location.pathname);
}

describe('QueryString', () => {
  afterEach(() => {
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('parses key=value pairs from the current query string', () => {
    setSearch('?a=1&b=hello');

    const qs = new QueryString();

    expect(qs.values).toEqual({ a: '1', b: 'hello' });
  });

  it('url-decodes values on parse', () => {
    setSearch('?filter=a%20b%2Fc');

    const qs = new QueryString();

    expect(qs.values.filter).toBe('a b/c');
  });

  it('ignores pairs with no value', () => {
    setSearch('?flag&a=1');

    const qs = new QueryString();

    expect(qs.values).toEqual({ a: '1' });
  });

  it('is empty when there is no query string', () => {
    setSearch('');

    const qs = new QueryString();

    expect(qs.values).toEqual({});
  });

  it('setValue adds a key, and removes it when val is falsy', () => {
    setSearch('');
    const qs = new QueryString();

    qs.setValue('x', 'y');
    expect(qs.values.x).toBe('y');

    qs.setValue('x', '');
    expect(qs.values.x).toBeUndefined();
  });

  it('apply() writes the values back to the url as a query string, url-encoded', () => {
    setSearch('');
    const qs = new QueryString();
    qs.setValue('a', '1');
    qs.setValue('b', 'x y');

    qs.apply();

    expect(window.location.search).toBe('?a=1&b=x%20y');
  });

  it('apply() clears the query string entirely when there are no values left', () => {
    setSearch('?a=1');
    const qs = new QueryString();
    qs.setValue('a', '');

    qs.apply();

    expect(window.location.search).toBe('');
  });

  it('apply() defaults to replaceState (does not grow history)', () => {
    setSearch('');
    const before = window.history.length;

    const qs = new QueryString();
    qs.setValue('a', '1');
    qs.apply();

    expect(window.history.length).toBe(before);
  });

  it('apply(true) uses pushState (grows history)', () => {
    setSearch('');
    const before = window.history.length;

    const qs = new QueryString();
    qs.setValue('a', '1');
    qs.apply(true);

    expect(window.history.length).toBe(before + 1);
  });
});
