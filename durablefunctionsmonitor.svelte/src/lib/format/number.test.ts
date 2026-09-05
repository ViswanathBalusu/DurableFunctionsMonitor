// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { fmtInt, fmtPct } from './number';

describe('fmtInt', () => {
  it('separates the thousands, in en-US wherever the browser is', () => {
    expect(fmtInt(1204)).toBe('1,204');
    expect(fmtInt(0)).toBe('0');
    expect(fmtInt(1_000_000)).toBe('1,000,000');
  });

  it('rounds rather than showing a count with a fraction', () => {
    expect(fmtInt(1204.6)).toBe('1,205');
  });

  it('has nothing to show for a number that is not one', () => {
    expect(fmtInt(null)).toBe('—');
    expect(fmtInt(undefined)).toBe('—');
    expect(fmtInt(Number.NaN)).toBe('—');
  });
});

describe('fmtPct', () => {
  it('is one decimal with a space before the sign', () => {
    expect(fmtPct(0.007)).toBe('0.7 %');
    expect(fmtPct(0)).toBe('0.0 %');
    expect(fmtPct(1)).toBe('100.0 %');
  });

  it('has nothing to show for a rate that is not one', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(Number.NaN)).toBe('—');
  });
});
