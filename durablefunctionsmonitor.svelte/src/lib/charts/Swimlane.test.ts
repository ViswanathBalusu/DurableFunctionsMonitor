// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Swimlane from './Swimlane.svelte';
import { domainTicks, isNarrow, placeSpan, type Swimlane as Lane } from './swimlane';

const domain = { from: new Date('2026-09-04T14:02:00Z'), to: new Date('2026-09-04T14:03:00Z') };

const lanes: Lane[] = [
  {
    key: 'ReserveInventory',
    label: 'ReserveInventory',
    bars: [{ key: 'bar-1', left: 25, width: 64, text: '38.4 s', title: 'ReserveInventory' }],
  },
  {
    key: 'ChargePayment',
    label: 'ChargePayment',
    bars: [{ key: 'bar-2', cls: 'wait', left: 89, width: 11 }],
    lbl: '6.6 s',
    lblLeft: 92,
    now: 96,
  },
];

describe('placeSpan', () => {
  it('places a span as percentages of the domain', () => {
    expect(placeSpan('2026-09-04T14:02:15Z', '2026-09-04T14:02:53.4Z', domain)).toEqual({ left: 25, width: 64 });
  });

  it('runs an open span to the right edge, which is what still-running looks like', () => {
    expect(placeSpan('2026-09-04T14:02:30Z', null, domain)).toEqual({ left: 50, width: 50 });
  });

  it('clamps a span that starts before the window instead of dropping it', () => {
    expect(placeSpan('2026-09-04T13:00:00Z', '2026-09-04T14:02:30Z', domain)).toEqual({ left: 0, width: 50 });
  });

  it('clamps a span that ends after it', () => {
    expect(placeSpan('2026-09-04T14:02:30Z', '2026-09-04T15:00:00Z', domain)).toEqual({ left: 50, width: 50 });
  });

  it('gives an instant a zero width rather than a negative one', () => {
    expect(placeSpan('2026-09-04T14:02:30Z', '2026-09-04T14:02:30Z', domain)).toEqual({ left: 50, width: 0 });
  });
});

describe('isNarrow', () => {
  it('knows when a bar cannot hold its own text', () => {
    expect(isNarrow(5.9)).toBe(true);
    expect(isNarrow(6)).toBe(false);
  });
});

describe('domainTicks', () => {
  it('spreads ticks across the domain, both ends included', () => {
    const ticks = domainTicks(domain, 6);

    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toEqual(domain.from);
    expect(ticks[5]).toEqual(domain.to);
    expect(ticks[1].toISOString()).toBe('2026-09-04T14:02:12.000Z');
  });
});

describe('Swimlane', () => {
  it('renders the mockups’ lane structure', () => {
    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline' } });

    expect(document.querySelector('.swim > .swim-in')).not.toBeNull();
    expect(document.querySelectorAll('.lane')).toHaveLength(2);
    expect(document.querySelector('.lane .lbl')?.textContent).toBe('ReserveInventory');
    expect(document.querySelectorAll('.track .bar')).toHaveLength(2);
  });

  it('positions a bar by percentage', () => {
    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline' } });

    const bar = document.querySelector('.track .bar') as HTMLElement;
    expect(bar.getAttribute('style')?.replace(/\s/g, '')).toContain('left:25%;width:64%');
    expect(bar.textContent?.trim()).toBe('38.4 s');
  });

  it('carries the bar class the stylesheet draws waiting bars with', () => {
    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline' } });

    expect(document.querySelectorAll('.bar.wait')).toHaveLength(1);
  });

  it('draws the outside label and the now line', () => {
    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline' } });

    const label = document.querySelector('.blbl') as HTMLElement;
    expect(label.textContent).toBe('6.6 s');
    expect(label.getAttribute('style')?.replace(/\s/g, '')).toContain('left:92%');

    expect(document.querySelector('.now')?.getAttribute('style')?.replace(/\s/g, '')).toContain('left:96%');
  });

  it('shows the axis ticks', () => {
    render(Swimlane, { props: { lanes, domain, ticks: 3, ariaLabel: 'Timeline' } });

    const ticks = document.querySelectorAll('.axis .ticks span');
    expect(ticks).toHaveLength(3);
    expect(ticks[0].textContent).toBe('14:02:00');
    expect(ticks[2].textContent).toBe('14:03:00');
  });

  it('highlights the linked lane and bar', () => {
    const laneHighlight = render(Swimlane, {
      props: { lanes, domain, ariaLabel: 'Timeline', highlightKey: 'ChargePayment' },
    });
    expect(document.querySelectorAll('.lane.hl')).toHaveLength(1);
    laneHighlight.unmount();

    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline', highlightKey: 'bar-1' } });
    expect(document.querySelectorAll('.bar.hl')).toHaveLength(1);
  });

  it('reports hover, so the History table can follow it', async () => {
    const onLaneEnter = vi.fn();
    const onLaneLeave = vi.fn();

    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline', onLaneEnter, onLaneLeave } });

    const lane = document.querySelector('.lane') as HTMLElement;
    await fireEvent.mouseEnter(lane);
    await fireEvent.mouseLeave(lane);

    expect(onLaneEnter).toHaveBeenCalledWith('ReserveInventory');
    expect(onLaneLeave).toHaveBeenCalledOnce();
  });

  it('reports a bar click with its history rows', async () => {
    const onBarClick = vi.fn();
    const withRows: Lane[] = [
      { key: 'lane', label: 'lane', bars: [{ key: 'bar', left: 0, width: 10, sequenceNumbers: [12, 13] }] },
    ];

    render(Swimlane, { props: { lanes: withRows, domain, ariaLabel: 'Timeline', onBarClick } });

    await fireEvent.click(document.querySelector('.bar') as Element);

    expect(onBarClick).toHaveBeenCalledWith('lane', expect.objectContaining({ sequenceNumbers: [12, 13] }));
  });

  it('scrolls rather than squeezing below its minimum width', () => {
    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline', minWidth: 900 } });

    expect(document.querySelector('.swim-in')?.getAttribute('style')?.replace(/\s/g, '')).toContain('min-width:900px');
  });

  it('exports an SVG of the same picture', () => {
    const { component } = render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline' } });

    const svg = (component as unknown as { toSvg: () => SVGSVGElement }).toSvg();

    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('rect')).toHaveLength(2);
    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toContain('ReserveInventory');
  });

  it('is a labelled group', () => {
    render(Swimlane, { props: { lanes, domain, ariaLabel: 'Timeline' } });

    expect(screen.getByRole('group', { name: 'Timeline' })).toHaveClass('swim');
  });
});
