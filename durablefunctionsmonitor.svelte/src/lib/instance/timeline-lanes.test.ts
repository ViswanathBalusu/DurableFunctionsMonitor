// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import type { Span, SpansResponse } from '$lib/api/types';
import type { Swimlane } from '$lib/charts/swimlane';
import {
  buildTimeline,
  NOW_PERCENT,
  RETRY_BACKOFF_LABEL,
  shortReason,
  timelineDomain,
  TIMER_LABEL,
  UNKNOWN_WAIT_LABEL,
} from './timeline-lanes';
import { history as historyFixture } from '../../../tests/unit/fixtures/history';
import { span, spansResponse } from '../../../tests/unit/fixtures/spans';

/** The workspace's own instance: running, with the history rows the failed bar reads its reason from. */
function mockup(overrides: Partial<SpansResponse> = {}) {
  return buildTimeline({
    spans: spansResponse(overrides),
    name: 'ProcessOrderOrchestrator',
    running: true,
    history: historyFixture,
  });
}

/** One response holding exactly these spans, with a window wide enough for all of them. */
function of(spans: Span[], overrides: Partial<SpansResponse> = {}): SpansResponse {
  return spansResponse({ spans, ...overrides });
}

function labels(lanes: Swimlane[]): string[] {
  return lanes.map((lane) => lane.label);
}

function lane(lanes: Swimlane[], label: string): Swimlane {
  const found = lanes.find((candidate) => candidate.label === label);

  expect(found, `no lane labelled ${label}`).toBeDefined();

  return found as Swimlane;
}

describe('timeline-lanes: the lanes of the mockup', () => {
  it('is ScreenInstance.dc.html L301-L309, in order', () => {
    const { lanes } = mockup();

    // The mockup's ninth lane, `wait ShipmentConfirmed`, has no span behind it: a wait for an event
    // that has not arrived is unnamed, and this history's last row leaves nothing waiting at all
    expect(labels(lanes)).toEqual([
      'ProcessOrderOrchestrator',
      'ReserveInventory',
      'ChargePayment',
      'ChargePayment (retry 2)',
      RETRY_BACKOFF_LABEL,
      'wait PaymentApproved',
      'ChargePayment (retry 3)',
      'NotifyCustomer (sub)',
    ]);
  });

  it('draws the orchestrator as its episodes, and puts the now line on that lane', () => {
    const { lanes } = mockup();
    const orchestrator = lanes[0];

    expect(orchestrator.bars).toHaveLength(4);
    expect(orchestrator.bars.every((bar) => bar.cls === 'orch')).toBe(true);
    expect(orchestrator.bars.every((bar) => bar.text === undefined)).toBe(true);
    expect(orchestrator.bars[0].title).toBe('replay · 91 ms');
    expect(orchestrator.now).toBe(NOW_PERCENT);

    // The lane is keyed by its first span, so entering it names the rows that span was built from
    expect(orchestrator.key).toBe('orch1');

    // ...and it is the only lane with a now line
    expect(lanes.slice(1).every((other) => other.now === undefined)).toBe(true);
  });

  it('places each bar where the mockup places it', () => {
    const { lanes } = mockup();

    const cases: [string, number, number][] = [
      // label, left %, width % (ScreenInstance.dc.html L302-L309)
      ['ReserveInventory', 0.2, 4.0],
      ['ChargePayment', 4.4, 6.5],
      ['ChargePayment (retry 2)', 11.0, 8.5],
      [RETRY_BACKOFF_LABEL, 19.8, 6.3],
      ['ChargePayment (retry 3)', 27.3, 6.5],
      ['NotifyCustomer (sub)', 34.3, 61.7],
    ];

    for (const [label, left, width] of cases) {
      const bar = lane(lanes, label).bars[0];

      expect(bar.left, `${label} left`).toBeCloseTo(left, 0);
      expect(bar.width, `${label} width`).toBeCloseTo(width, 0);
    }
  });

  it('runs an open bar to the now line and no further', () => {
    const { lanes } = mockup();
    const bar = lane(lanes, 'NotifyCustomer (sub)').bars[0];

    // The window reaches past now so the dashed line is visible; the bar does not
    expect(bar.left + bar.width).toBeCloseTo(NOW_PERCENT, 1);
    expect(bar.cls).toBe('st-running');
    expect(bar.text).toBe('running 30 s');
    expect(bar.title).toBe('sub-orchestration running · 30 s');
  });

  it('says why the failed attempt failed, and where the whole reason is', () => {
    const { lanes } = mockup();
    const bar = lane(lanes, 'ChargePayment (retry 2)').bars[0];

    expect(bar.cls).toBe('st-failed');
    expect(bar.text).toBe('Timeout 4 s');
    expect(bar.title).toBe('activity failed · 4 s · TimeoutException: payment gateway did not answer within 4 s');
    expect(bar.sequenceNumbers).toEqual([10, 14]);
  });

  it('is a bar of a duration when there is no history to say more', () => {
    const { lanes } = buildTimeline({ spans: spansResponse(), running: true });

    expect(lane(lanes, 'ChargePayment (retry 2)').bars[0].text).toBe('4 s');
    expect(lane(lanes, 'ChargePayment (retry 2)').bars[0].title).toBe('activity failed · 4 s');
  });

  it('says beside a bar what will not fit inside it', () => {
    const { lanes } = mockup();
    const reserve = lane(lanes, 'ReserveInventory');

    expect(reserve.bars[0].text).toBeUndefined();
    expect(reserve.lbl).toBe('2 s');
    expect(reserve.lblLeft).toBeCloseTo(reserve.bars[0].left + reserve.bars[0].width + 0.6, 2);
  });

  it('puts the raised event on the lane of the wait it ended', () => {
    const { lanes } = mockup();
    const wait = lane(lanes, 'wait PaymentApproved');

    expect(wait.bars.map((bar) => bar.key)).toEqual(['wait-payment', 'event']);
    expect(wait.bars[0].cls).toBe('wait');
    expect(wait.bars[0].title).toBe('waited for PaymentApproved · 503 ms');

    // A moment has no width, so it is drawn as the thinnest bar there is - and not as a wait
    expect(wait.bars[1].width).toBe(1);
    expect(wait.bars[1].cls).toBeUndefined();
    expect(wait.bars[1].title).toBe('PaymentApproved raised');

    // Neither bar is wide enough to hold its own text, so the lane says it once, beside them
    expect(wait.lbl).toBe('503 ms');
  });
});

describe('timeline-lanes: the grouping rules', () => {
  it('keeps a name in one lane, with the retry numbered, when the attempts are not one span each', () => {
    // Two spans of the first attempt (a fan-out, or two folded together) and one of the second
    const { lanes } = buildTimeline({
      spans: of([
        span({
          id: 'a1',
          name: 'Charge',
          start: '2026-09-04T14:02:12.000Z',
          end: '2026-09-04T14:02:16.000Z',
          durationMs: 4_000,
        }),
        span({
          id: 'a2',
          name: 'Charge',
          start: '2026-09-04T14:02:17.000Z',
          end: '2026-09-04T14:02:21.000Z',
          durationMs: 4_000,
        }),
        span({
          id: 'a3',
          name: 'Charge',
          attempt: 2,
          start: '2026-09-04T14:02:22.000Z',
          end: '2026-09-04T14:02:26.000Z',
          durationMs: 4_000,
        }),
      ]),
    });

    expect(labels(lanes)).toEqual(['Charge']);
    expect(lanes[0].bars.map((bar) => bar.text)).toEqual(['4 s', '4 s', 'retry 2']);
  });

  it('splits spans that overlap in time, whatever they are called', () => {
    const { lanes } = buildTimeline({
      spans: of([
        span({ id: 'f1', name: 'Fan', start: '2026-09-04T14:02:12.000Z', end: '2026-09-04T14:02:20.000Z' }),
        span({ id: 'f2', name: 'Fan', start: '2026-09-04T14:02:13.000Z', end: '2026-09-04T14:02:21.000Z' }),
        span({ id: 'f3', name: 'Fan', start: '2026-09-04T14:02:14.000Z', end: '2026-09-04T14:02:22.000Z' }),
      ]),
    });

    // One track cannot hold three bars at once without drawing them over each other
    expect(labels(lanes)).toEqual(['Fan', 'Fan', 'Fan']);
    expect(lanes.map((one) => one.bars.map((bar) => bar.key))).toEqual([['f1'], ['f2'], ['f3']]);
  });

  it('names a timer for what it is doing there', () => {
    const between = buildTimeline({
      spans: of([
        span({ id: 'c1', name: 'Charge', end: '2026-09-04T14:02:14.000Z' }),
        span({
          id: 't',
          kind: 'timer',
          name: '',
          start: '2026-09-04T14:02:14.100Z',
          end: '2026-09-04T14:02:17.100Z',
          status: 'fired',
          durationMs: 3_000,
        }),
        span({ id: 'c2', name: 'Charge', attempt: 2, start: '2026-09-04T14:02:17.200Z' }),
      ]),
    });

    expect(labels(between.lanes)).toContain(RETRY_BACKOFF_LABEL);

    const alone = buildTimeline({
      spans: of([
        span({
          id: 't',
          kind: 'timer',
          name: '',
          start: '2026-09-04T14:02:14.100Z',
          end: '2026-09-04T14:02:17.100Z',
          status: 'fired',
          durationMs: 3_000,
        }),
      ]),
    });

    // A timer with no retry around it is a durable timer, and saying "retry backoff" would be a guess
    expect(labels(alone.lanes)).toEqual([TIMER_LABEL]);
    expect(alone.lanes[0].bars[0].cls).toBe('st-suspended');
  });

  it('calls a wait what it is waiting for, once something has named it', () => {
    const open = buildTimeline({
      name: 'ProcessOrderOrchestrator',
      running: true,
      spans: of([
        span({
          id: 'w',
          kind: 'eventWait',
          name: '',
          start: '2026-09-04T14:02:28.000Z',
          end: null,
          status: 'waiting',
          durationMs: null,
        }),
      ]),
    });

    // The provider only learns an event's name when it arrives, so an open wait has none
    expect(labels(open.lanes)).toEqual(['ProcessOrderOrchestrator', UNKNOWN_WAIT_LABEL]);
    expect(open.lanes[1].bars[0].text).toBe('waiting 30 s');
    expect(open.lanes[1].bars[0].title).toBe('external event, still waiting');
  });

  it('has an orchestrator lane for a provider that reports no episodes at all', () => {
    const { lanes } = buildTimeline({
      spans: of([span()]),
      name: 'ProcessOrderOrchestrator',
      running: true,
    });

    expect(labels(lanes)).toEqual(['ProcessOrderOrchestrator', 'ReserveInventory']);
    expect(lanes[0].bars).toEqual([]);
    expect(lanes[0].now).toBe(NOW_PERCENT);
  });

  it('draws nothing at all when there are no spans to draw', () => {
    expect(buildTimeline({ spans: null }).lanes).toEqual([]);
    expect(buildTimeline({ spans: of([]) }).lanes).toEqual([]);
  });
});

describe('timeline-lanes: the window', () => {
  it('is the execution, with room for the now line while it is still running', () => {
    const running = timelineDomain(spansResponse(), true);

    expect(running.from.toISOString()).toBe('2026-09-04T14:02:11.913Z');

    // now sits at 96 % of it, which is where the dashed line is drawn
    const span = running.to.getTime() - running.from.getTime();
    const now = Date.parse('2026-09-04T14:02:58.000Z') - running.from.getTime();

    expect((now / span) * 100).toBeCloseTo(NOW_PERCENT, 2);
  });

  it('ends when the execution ended, however long ago that was', () => {
    const domain = timelineDomain(
      spansResponse({
        executionEndedAt: '2026-09-04T14:02:30.000Z',
        now: '2026-09-05T09:00:00.000Z',
      }),
    );

    // A run that finished yesterday is drawn as it ran, not squashed against a day of nothing
    expect(domain.to.toISOString()).toBe('2026-09-04T14:02:30.000Z');
  });

  it('always has a width, whatever it was given', () => {
    const empty = timelineDomain(null);
    const instant = timelineDomain(spansResponse({ executionEndedAt: '2026-09-04T14:02:11.913Z' }));

    expect(empty.to.getTime()).toBeGreaterThan(empty.from.getTime());
    expect(instant.to.getTime()).toBeGreaterThan(instant.from.getTime());
  });
});

describe('shortReason', () => {
  const cases: [unknown, string | null][] = [
    ['TimeoutException: payment gateway did not answer within 4 s', 'Timeout'],
    ['System.InvalidOperationException: nope', 'System.Inval…'],
    ['timeout', 'timeout'],
    ['Exception', 'Exception'],
    ['   ', null],
    [null, null],
    [{ message: 'no' }, null],
  ];

  it.each(cases)('shortens %s', (reason, expected) => {
    expect(shortReason(reason)).toBe(expected);
  });
});
