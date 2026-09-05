// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration, parseCount, parseDuration } from './thresholds';

describe('parseDuration', () => {
  it('reads the units the fields are written in', () => {
    expect(parseDuration('1 h')).toBe(60);
    expect(parseDuration('10 min')).toBe(10);
    expect(parseDuration('2 d')).toBe(2880);
    expect(parseDuration('90 min')).toBe(90);

    // Spelt out, abbreviated, cased however, or with no space at all
    expect(parseDuration('2 hours')).toBe(120);
    expect(parseDuration('3D')).toBe(4320);
    expect(parseDuration('45m')).toBe(45);

    // A bare number is minutes, which is the unit everything is stored in
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('  1 h  ')).toBe(60);
  });

  it('refuses what it cannot turn into whole minutes', () => {
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('1 fortnight')).toBeNull();
    expect(parseDuration('1h30')).toBeNull();
    expect(parseDuration('-5 min')).toBeNull();

    // A threshold of zero marks everything as needing attention, which is not a threshold
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('0 h')).toBeNull();

    // Half a minute is not a number of minutes
    expect(parseDuration('1.5 min')).toBeNull();
    expect(parseDuration('1.5 h')).toBe(90);
  });
});

describe('formatDuration', () => {
  it('writes the largest unit the value is a whole number of', () => {
    expect(formatDuration(2880)).toBe('2 d');
    expect(formatDuration(1440)).toBe('1 d');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(90)).toBe('90 min');
    expect(formatDuration(10)).toBe('10 min');
    expect(formatDuration(0)).toBe('0 min');
  });

  it('round-trips whatever it wrote', () => {
    for (const minutes of [1, 10, 59, 60, 90, 1440, 2880, 4321]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});

describe('parseCount and formatCount', () => {
  it('reads the grouped number the mockup shows', () => {
    expect(parseCount('1,000')).toBe(1000);
    expect(parseCount('1000')).toBe(1000);
    expect(parseCount(' 25 ')).toBe(25);

    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(25)).toBe('25');
    expect(parseCount(formatCount(1234567))).toBe(1234567);
  });

  it('refuses anything that is not a positive whole number', () => {
    expect(parseCount('abc')).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount('-1')).toBeNull();
    expect(parseCount('1.5')).toBeNull();
    expect(parseCount('0')).toBeNull();
  });
});
