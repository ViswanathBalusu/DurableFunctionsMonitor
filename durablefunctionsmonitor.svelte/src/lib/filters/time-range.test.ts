// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIME_RANGE,
  TIME_RANGE_LABELS,
  TIME_RANGE_PRESETS,
  isPreset,
  label,
  parseTimeRange,
  resolve,
  toQuery,
  type TimeRange,
  type TimeRangePreset,
} from './time-range';

const NOW = new Date('2026-09-04T14:02:00.000Z');

const PRESET_SPANS: Record<TimeRangePreset, { from: string; label: string }> = {
  '15m': { from: '2026-09-04T13:47:00.000Z', label: 'Last 15 minutes' },
  '1h': { from: '2026-09-04T13:02:00.000Z', label: 'Last hour' },
  '24h': { from: '2026-09-03T14:02:00.000Z', label: 'Last 24 hours' },
  '7d': { from: '2026-08-28T14:02:00.000Z', label: 'Last 7 days' },
  '30d': { from: '2026-08-05T14:02:00.000Z', label: 'Last 30 days' },
};

/** What `Router.setQuery` does with a patch: set the values, delete the nulls. */
function applyPatch(patch: Record<string, string | null>, base = new URLSearchParams()): URLSearchParams {
  const query = new URLSearchParams(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      query.delete(key);
    } else {
      query.set(key, value);
    }
  }
  return query;
}

describe('time range presets', () => {
  it('lists the five presets in the mockup order', () => {
    expect(TIME_RANGE_PRESETS).toEqual(['15m', '1h', '24h', '7d', '30d']);
  });

  it('defaults to the last 24 hours', () => {
    expect(DEFAULT_TIME_RANGE).toEqual({ preset: '24h' });
  });

  for (const preset of TIME_RANGE_PRESETS) {
    const expected = PRESET_SPANS[preset];

    it(`parses, resolves, labels and round-trips ${preset}`, () => {
      const range = parseTimeRange(new URLSearchParams(`range=${preset}`));
      expect(range).toEqual({ preset });
      expect(isPreset(range)).toBe(true);

      const { from, to } = resolve(range, NOW);
      expect(from.toISOString()).toBe(expected.from);
      expect(to.toISOString()).toBe(NOW.toISOString());

      expect(label(range)).toBe(expected.label);
      expect(TIME_RANGE_LABELS[preset]).toBe(expected.label);

      expect(toQuery(range)).toEqual({ range: preset, from: null, to: null });
      expect(parseTimeRange(applyPatch(toQuery(range)))).toEqual(range);
    });
  }

  it('resolves against the current clock when no `now` is given', () => {
    const before = Date.now();
    const { from, to } = resolve({ preset: '1h' });
    const after = Date.now();

    expect(to.getTime()).toBeGreaterThanOrEqual(before);
    expect(to.getTime()).toBeLessThanOrEqual(after);
    expect(to.getTime() - from.getTime()).toBe(60 * 60_000);
  });
});

describe('custom time range', () => {
  const custom: TimeRange = { from: '2026-09-04T08:30:00Z', to: '2026-09-04T14:02:00Z' };

  it('parses a from/to pair out of the query', () => {
    const range = parseTimeRange(new URLSearchParams('from=2026-09-04T08:30:00Z&to=2026-09-04T14:02:00Z'));

    expect(range).toEqual(custom);
    expect(isPreset(range)).toBe(false);
  });

  it('prefers an explicit from/to pair over a preset', () => {
    const range = parseTimeRange(new URLSearchParams('range=7d&from=2026-09-04T08:30:00Z&to=2026-09-04T14:02:00Z'));

    expect(range).toEqual(custom);
  });

  it('resolves to the two dates as given', () => {
    const { from, to } = resolve(custom, NOW);

    expect(from.toISOString()).toBe('2026-09-04T08:30:00.000Z');
    expect(to.toISOString()).toBe('2026-09-04T14:02:00.000Z');
  });

  it('labels a same-day window without repeating the date', () => {
    expect(label(custom)).toBe('2026-09-04 08:30 → 14:02');
  });

  it('labels a multi-day window with both dates', () => {
    expect(label({ from: '2026-09-01T08:30:00Z', to: '2026-09-04T14:02:00Z' })).toBe(
      '2026-09-01 08:30 → 2026-09-04 14:02',
    );
  });

  it('labels an unparsable window as empty', () => {
    expect(label({ from: 'yesterday', to: 'today' })).toBe('');
  });

  it('clears the preset when written back to the query', () => {
    expect(toQuery(custom)).toEqual({ range: null, from: '2026-09-04T08:30:00Z', to: '2026-09-04T14:02:00Z' });
  });

  it('round-trips through the query, dropping a preset that was there before', () => {
    const query = applyPatch(toQuery(custom), new URLSearchParams('range=7d'));

    expect(query.has('range')).toBe(false);
    expect(parseTimeRange(query)).toEqual(custom);
  });
});

describe('parseTimeRange fallbacks', () => {
  it('falls back to the default on an empty query', () => {
    expect(parseTimeRange(new URLSearchParams())).toEqual({ preset: '24h' });
  });

  it('falls back to the default on an unknown preset', () => {
    expect(parseTimeRange(new URLSearchParams('range=42y'))).toEqual({ preset: '24h' });
  });

  it('ignores a half or unparsable from/to pair', () => {
    expect(parseTimeRange(new URLSearchParams('from=2026-09-04T08:30:00Z'))).toEqual({ preset: '24h' });
    expect(parseTimeRange(new URLSearchParams('range=7d&from=2026-09-04T08:30:00Z'))).toEqual({ preset: '7d' });
    expect(parseTimeRange(new URLSearchParams('from=nonsense&to=alsononsense'))).toEqual({ preset: '24h' });
  });
});
