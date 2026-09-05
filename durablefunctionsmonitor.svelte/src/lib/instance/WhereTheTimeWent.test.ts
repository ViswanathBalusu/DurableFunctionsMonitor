// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { SpansTotals } from '$lib/api/types';
import WhereTheTimeWent, { MIN_SLICE, timeSlices } from './WhereTheTimeWent.svelte';
import { totals as totalsFixture } from '../../../tests/unit/fixtures/spans';

/** The mockup's own numbers (L59-L64), which happen to tile the run exactly. */
function mockupTotals(overrides: Partial<SpansTotals> = {}): SpansTotals {
  return totalsFixture({
    activitiesMs: 9_100,
    externalEventWaitMs: 31_000,
    timersMs: 3_000,
    orchestratorMs: 4_100,
    subOrchestrationsMs: 0,
    totalMs: 47_200,
    ...overrides,
  });
}

function mount(totals: SpansTotals) {
  return render(WhereTheTimeWent, { props: { totals } });
}

function terms(): string[] {
  return Array.from(document.querySelectorAll('dl.kv dt')).map((dt) => dt.textContent?.trim() ?? '');
}

function column(index: 0 | 1): string[] {
  const cells = Array.from(document.querySelectorAll('dl.kv dd'));

  return cells.filter((_, position) => position % 2 === index).map((dd) => dd.textContent?.trim() ?? '');
}

describe('WhereTheTimeWent', () => {
  it('is the panel of the mockup: a stacked bar and the same numbers under it', () => {
    mount(mockupTotals());

    expect(screen.getByRole('heading', { name: 'Where the time went', level: 3 })).toBeInTheDocument();
    expect(document.querySelector('.panel-h .fine.muted')?.textContent).toBe('/spans · 47 s');

    expect(terms()).toEqual(['activities', 'external event', 'timers', 'orchestrator']);
    expect(column(0)).toEqual(['9 s', '31 s', '3 s', '4 s']);

    const shares = column(1).map((text) => Number(text.replace(' %', '')));

    expect(shares).toEqual([19.3, 65.7, 6.4, 8.7]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(100, 0);
  });

  it('fills each slice the way the swimlane fills that kind', () => {
    mount(mockupTotals());

    const slices = Array.from(document.querySelectorAll<HTMLElement>('.wbar i'));

    expect(slices.map((slice) => slice.className)).toEqual(['st-completed', 'wait', 'st-suspended', 'orch']);
    expect(slices[0].style.width).toBe('19.28%');

    // The bar is decoration: the same thing is said in words in the list under it
    expect(document.querySelector('.wbar')).toHaveAttribute('aria-hidden', 'true');

    // The swatch beside each row carries the same fill as the slice it explains (dfm-ext.css)
    const swatches = Array.from(document.querySelectorAll<HTMLElement>('dl.kv .swq'));

    expect(swatches.map((swatch) => swatch.className)).toEqual([
      'swq st-completed',
      'swq wait',
      'swq st-suspended',
      'swq orch',
    ]);
  });

  it('leaves out the kinds that took no time', () => {
    mount(mockupTotals({ timersMs: 0, subOrchestrationsMs: 12_000 }));

    expect(terms()).toEqual(['activities', 'external event', 'orchestrator', 'sub-orchestrations']);
    expect(document.querySelectorAll('.wbar i')).toHaveLength(4);
  });

  it('says nothing about the orchestrator when the provider counts no episodes', () => {
    mount(mockupTotals({ orchestratorMs: null }));

    // MSSQL and Netherite have no episode markers, and "0 s in the orchestrator" would be a claim
    expect(terms()).not.toContain('orchestrator');
    expect(terms()).toEqual(['activities', 'external event', 'timers']);
  });

  it('draws a slice too thin to see at the width it can be seen at', () => {
    mount(mockupTotals({ timersMs: 100 }));

    const timers = Array.from(document.querySelectorAll<HTMLElement>('.wbar i'))[2];

    expect(timers.style.width).toBe('0.21%');
    expect(timers.style.minWidth).toBe(MIN_SLICE);
  });

  it('is the run it was measured against, gaps and all', () => {
    // The spans fixture: 16.3 s of a 47 s run accounted for, because the rest was the orchestrator
    // waiting on nothing in particular. The bar is short, and says so by being short
    mount(totalsFixture());

    const widths = Array.from(document.querySelectorAll<HTMLElement>('.wbar i')).map((slice) =>
      Number.parseFloat(slice.style.width),
    );

    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(34.7, 1);
  });
});

describe('timeSlices', () => {
  it('has no share to give when the run has no length', () => {
    const slices = timeSlices(totalsFixture({ totalMs: 0 }));

    expect(slices.map((slice) => slice.share)).toEqual([0, 0, 0, 0]);
  });

  it('can add up to more than the run, and says so rather than hiding it', () => {
    // Ten activities of a minute each, run in parallel inside a one-minute orchestration
    const slices = timeSlices(totalsFixture({ activitiesMs: 600_000, totalMs: 60_000 }));

    expect(slices[0].share).toBe(10);
  });
});
