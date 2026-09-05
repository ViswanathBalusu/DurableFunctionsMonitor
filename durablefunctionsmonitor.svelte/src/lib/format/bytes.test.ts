// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { MAX_INLINE_BYTES, fmtBytes, utf16Bytes } from './bytes';

describe('fmtBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [921, '921 B'],
    [1024, '1.0 KB'],
    [921 * 1024, '921 KB'],
    [42_168, '41.2 KB'],
    [221_249_536, '211 MB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(fmtBytes(bytes)).toBe(expected);
  });

  it('has nothing to say about a missing size', () => {
    expect(fmtBytes(null)).toBe('—');
    expect(fmtBytes(undefined)).toBe('—');
    expect(fmtBytes(Number.NaN)).toBe('—');
  });
});

describe('utf16Bytes', () => {
  it('counts two bytes per character, as Encoding.Unicode does', () => {
    expect(utf16Bytes('abc')).toBe(6);
    expect(utf16Bytes('')).toBe(0);
  });
});

describe('MAX_INLINE_BYTES', () => {
  it('is the 60 KB the backend stores inline', () => {
    expect(MAX_INLINE_BYTES).toBe(60 * 1024);
  });
});
