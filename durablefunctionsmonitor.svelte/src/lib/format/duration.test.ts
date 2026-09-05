// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { NO_DURATION, fmtDuration, fmtDurationClock, fmtDurationCompact } from './duration';

describe('fmtDuration', () => {
  it('formats the examples of contracts §10', () => {
    expect(fmtDuration(47_000)).toBe('47 s');
    expect(fmtDuration(138_000)).toBe('2.3 min');
    expect(fmtDuration(2_460_000)).toBe('41 min');
    expect(fmtDuration(50_400_000)).toBe('14 h');
    expect(fmtDuration(172_800_000)).toBe('2 d');
  });

  it('is exact to the millisecond below a second', () => {
    expect(fmtDuration(0)).toBe('0 ms');
    expect(fmtDuration(250)).toBe('250 ms');
    expect(fmtDuration(999.6)).toBe('1000 ms');
  });

  it('drops the decimals of seconds', () => {
    expect(fmtDuration(1000)).toBe('1 s');
    expect(fmtDuration(1900)).toBe('2 s');
    expect(fmtDuration(59_400)).toBe('59 s');
  });

  it('keeps one decimal only where it says something', () => {
    expect(fmtDuration(90_000)).toBe('1.5 min');
    expect(fmtDuration(120_000)).toBe('2 min');
    expect(fmtDuration(600_000)).toBe('10 min');
    expect(fmtDuration(9 * 3_600_000)).toBe('9 h');
    expect(fmtDuration(9.5 * 3_600_000)).toBe('9.5 h');
    expect(fmtDuration(36 * 3_600_000)).toBe('1.5 d');
  });

  it('has nothing to show for a duration that is not one', () => {
    expect(fmtDuration(null)).toBe(NO_DURATION);
    expect(fmtDuration(undefined)).toBe(NO_DURATION);
    expect(fmtDuration(Number.NaN)).toBe(NO_DURATION);
    expect(fmtDuration(-1)).toBe(NO_DURATION);
  });
});

describe('fmtDurationClock', () => {
  it('is a clock, with the days in front when there are any', () => {
    expect(fmtDurationClock(47_000)).toBe('00:00:47');
    expect(fmtDurationClock(3_723_000)).toBe('01:02:03');
    expect(fmtDurationClock(93_784_000)).toBe('1d 02:03:04');
  });

  it('truncates rather than rounds, so the clock never runs ahead of the instance', () => {
    expect(fmtDurationClock(1999)).toBe('00:00:01');
    expect(fmtDurationClock(0)).toBe('00:00:00');
    expect(fmtDurationClock(null)).toBe(NO_DURATION);
  });
});

describe('fmtDurationCompact', () => {
  it('shows the two most significant units, as React did', () => {
    expect(fmtDurationCompact(93_600_000)).toBe('1d2h');
    expect(fmtDurationCompact(8_006_000)).toBe('2h13m');
    expect(fmtDurationCompact(17_000)).toBe('17s');
    expect(fmtDurationCompact(250)).toBe('250ms');
    expect(fmtDurationCompact(17_250)).toBe('17s250ms');
  });

  it('skips the units that are zero', () => {
    expect(fmtDurationCompact(86_400_000 + 60_000)).toBe('1d1m');
    expect(fmtDurationCompact(0)).toBe('0ms');
  });

  it('has nothing to show for a duration that is not one', () => {
    expect(fmtDurationCompact(-5)).toBe(NO_DURATION);
    expect(fmtDurationCompact(null)).toBe(NO_DURATION);
  });
});
