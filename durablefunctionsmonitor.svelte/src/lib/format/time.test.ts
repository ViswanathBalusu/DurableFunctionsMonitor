// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { fmtAgo, fmtDateTime, fmtDateTimeMs, fmtTime, fmtTimeMs, timeZoneLabel } from './time';

/** The vitest setup pins TZ to Etc/GMT-2, which is UTC+2 (the POSIX signs are inverted). */
const ISO = '2026-09-04T12:02:11.913Z';

describe('fmtDateTime', () => {
  it('formats UTC by default', () => {
    expect(fmtDateTime(ISO)).toBe('2026-09-04 12:02:11');
  });

  it('formats the local clock when asked', () => {
    expect(fmtDateTime(ISO, 'Local')).toBe('2026-09-04 14:02:11');
  });

  it('has nothing to show for a missing or unparsable value', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime('')).toBe('—');
    expect(fmtDateTime('not-a-date')).toBe('—');
  });

  it('pads every part, so a column of timestamps lines up', () => {
    expect(fmtDateTime('2026-01-02T03:04:05Z')).toBe('2026-01-02 03:04:05');
  });
});

describe('fmtDateTimeMs and fmtTimeMs', () => {
  it('keep the milliseconds that order history events', () => {
    expect(fmtDateTimeMs(ISO)).toBe('2026-09-04 12:02:11.913');
    expect(fmtTimeMs(ISO)).toBe('12:02:11.913');
    expect(fmtTimeMs(ISO, 'Local')).toBe('14:02:11.913');
  });

  it('pad the milliseconds to three digits', () => {
    expect(fmtDateTimeMs('2026-09-04T12:02:11.007Z')).toBe('2026-09-04 12:02:11.007');
  });
});

describe('fmtTime', () => {
  it('is the time alone, for axis ticks and compact tables', () => {
    expect(fmtTime(ISO)).toBe('12:02:11');
  });
});

describe('fmtAgo', () => {
  const now = new Date('2026-09-04T12:00:00Z');

  it.each([
    ['2026-09-04T11:59:13Z', '47 s ago'],
    ['2026-09-04T11:49:00Z', '11 min ago'],
    ['2026-09-04T10:08:00Z', '1 h 52 min ago'],
    ['2026-09-04T11:00:00Z', '1 h ago'],
    ['2026-09-03T12:00:00Z', '1 d ago'],
    ['2026-08-30T12:00:00Z', '5 d ago'],
  ])('reads %s as %s', (iso, expected) => {
    expect(fmtAgo(iso, now)).toBe(expected);
  });

  it('says "just now" rather than a negative age when the clocks disagree', () => {
    expect(fmtAgo('2026-09-04T12:00:30Z', now)).toBe('just now');
  });

  it('has nothing to say about a missing value', () => {
    expect(fmtAgo(null, now)).toBe('—');
  });
});

describe('timeZoneLabel', () => {
  it('names the browser’s offset', () => {
    // The suite runs in Etc/GMT-2, which is UTC+2
    expect(timeZoneLabel()).toBe('UTC+2');
  });

  it('is the same for any instant in a zone without daylight saving', () => {
    expect(timeZoneLabel(new Date('2026-01-04T12:00:00Z'))).toBe('UTC+2');
  });
});
