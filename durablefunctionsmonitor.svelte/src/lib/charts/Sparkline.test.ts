// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Sparkline from './Sparkline.svelte';
import { sparklinePoints } from './sparkline';

describe('sparklinePoints', () => {
  it('spreads the values across the full width', () => {
    const points = sparklinePoints([0, 5, 10]).split(' ');

    expect(points).toHaveLength(3);
    expect(points[0].split(',')[0]).toBe('0');
    expect(points[2].split(',')[0]).toBe('100');
  });

  it('inverts y, so the biggest value is highest', () => {
    const [low, high] = sparklinePoints([0, 10]).split(' ');

    expect(Number(low.split(',')[1])).toBeGreaterThan(Number(high.split(',')[1]));
  });

  it('keeps the stroke inside the box', () => {
    for (const point of sparklinePoints([0, 3, 9, 1]).split(' ')) {
      const y = Number(point.split(',')[1]);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(y).toBeLessThanOrEqual(22);
    }
  });

  it('draws a flat series along the bottom, not through the middle', () => {
    const points = sparklinePoints([0, 0, 0, 0]).split(' ');

    expect(points.every((point) => point.endsWith(',22'))).toBe(true);
  });

  it('draws a repeated non-zero value along the bottom too', () => {
    expect(
      sparklinePoints([7, 7, 7])
        .split(' ')
        .every((point) => point.endsWith(',22')),
    ).toBe(true);
  });

  it('has nothing to draw for no values', () => {
    expect(sparklinePoints([])).toBe('');
  });
});

describe('Sparkline', () => {
  it('renders one polyline with a point per value', () => {
    render(Sparkline, { props: { values: [3, 1, 4, 1, 5, 9, 2, 6, 5] } });

    const polyline = document.querySelector('svg polyline');
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute('points')?.split(' ')).toHaveLength(9);
  });

  it('is decorative: the number beside it carries the meaning', () => {
    render(Sparkline, { props: { values: [1, 2] } });

    const svg = document.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 26');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
  });
});
