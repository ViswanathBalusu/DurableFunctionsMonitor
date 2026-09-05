// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import JsonPre from './JsonPre.svelte';

function pre(): HTMLElement {
  return document.querySelector('pre.json') as HTMLElement;
}

describe('JsonPre', () => {
  it('pretty-prints with two spaces and expands everything (contracts §9)', () => {
    render(JsonPre, { props: { value: { a: [1, { b: null }] } } });

    expect(pre().textContent).toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ]\n}');
  });

  it('parses a JSON string the backend sent as a string', () => {
    render(JsonPre, { props: { value: '{"a":1}' } });

    expect(pre().textContent).toBe('{\n  "a": 1\n}');
  });

  it('classifies keys, strings, numbers, booleans and null', () => {
    render(JsonPre, { props: { value: { key: 'text', n: 42, b: true, z: null } } });

    const classOf = (text: string) =>
      Array.from(pre().querySelectorAll('span')).find((s) => s.textContent === text)?.className;

    expect(classOf('"key"')).toBe('jk');
    expect(classOf('"text"')).toBe('js');
    expect(classOf('42')).toBe('jn');
    expect(classOf('true')).toBe('jb');
    expect(classOf('null')).toBe('jz');
  });

  it('clips at a maximum height when asked', () => {
    render(JsonPre, { props: { value: { a: 1 }, maxHeight: '120px' } });

    const style = pre().getAttribute('style')?.replace(/\s/g, '') ?? '';
    expect(style).toContain('max-height:120px');
    expect(style).toContain('overflow:hidden');
  });

  it('drops its background for the panel look', () => {
    render(JsonPre, { props: { value: { a: 1 }, transparent: true } });

    expect(pre().getAttribute('style')?.replace(/\s/g, '')).toContain('background:transparent;padding:0');
  });

  it('wraps long lines when asked', () => {
    render(JsonPre, { props: { value: { a: 1 }, wrap: true } });

    expect(pre().getAttribute('style')?.replace(/\s/g, '')).toContain('white-space:pre-wrap');
  });

  it('shows a plain value as JSON too', () => {
    render(JsonPre, { props: { value: 42 } });

    expect(pre().textContent).toBe('42');
  });
});
