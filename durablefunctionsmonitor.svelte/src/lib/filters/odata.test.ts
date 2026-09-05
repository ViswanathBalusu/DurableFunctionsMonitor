// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import {
  DURABLE_ENTITIES,
  FILTER_OPERATORS,
  FILTER_OPERATOR_LABELS,
  buildHistoryFilter,
  buildInstancesFilter,
  columnPredicate,
  toArrayOfStrings,
} from './odata';

const window = { from: '2026-09-03T14:00:00.000Z', to: '2026-09-04T14:00:00.000Z' };
const everyStatus =
  "runtimeStatus in ('Completed','Running','Failed','Pending','Terminated','Canceled','ContinuedAsNew','Suspended')";

describe('the operators', () => {
  it('are the eight of the rail, in the order the mockup lists them', () => {
    expect(FILTER_OPERATORS).toEqual([
      'Equals',
      'NotEquals',
      'StartsWith',
      'NotStartsWith',
      'Contains',
      'NotContains',
      'In',
      'NotIn',
    ]);

    expect(FILTER_OPERATORS.map((op) => FILTER_OPERATOR_LABELS[op])).toEqual([
      'Equals',
      'Not Equals',
      'Starts With',
      'Not Starts With',
      'Contains',
      'Not Contains',
      'In',
      'Not In',
    ]);
  });
});

describe('columnPredicate', () => {
  it('writes what React wrote, operator for operator', () => {
    expect(columnPredicate('instanceId', 'Equals', 'order-1')).toBe("instanceId eq 'order-1'");
    expect(columnPredicate('instanceId', 'NotEquals', 'order-1')).toBe("instanceId ne 'order-1'");
    expect(columnPredicate('instanceId', 'StartsWith', 'order-')).toBe("startswith(instanceId, 'order-')");
    expect(columnPredicate('instanceId', 'NotStartsWith', 'order-')).toBe("startswith(instanceId, 'order-') eq false");
    expect(columnPredicate('name', 'Contains', 'Order')).toBe("contains(name, 'Order')");
    expect(columnPredicate('name', 'NotContains', 'Order')).toBe("contains(name, 'Order') eq false");
  });

  it('encodes the value inside the quotes, as the backend expects', () => {
    expect(columnPredicate('instanceId', 'Equals', '@counter@warehouse-07')).toBe(
      "instanceId eq '%40counter%40warehouse-07'",
    );

    expect(columnPredicate('customStatus', 'Contains', 'a b&c')).toBe("contains(customStatus, 'a%20b%26c')");
  });

  it('reads an In list as CSV', () => {
    expect(columnPredicate('runtimeStatus', 'In', 'a, b')).toBe("runtimeStatus in ('a','b')");
  });

  it('reads an In list as JSON when it looks like JSON', () => {
    expect(columnPredicate('runtimeStatus', 'In', '["a","b"]')).toBe("runtimeStatus in ('a','b')");
  });

  it('negates NotIn the way OData wants it', () => {
    expect(columnPredicate('instanceId', 'NotIn', 'order-1,order-2')).toBe(
      "instanceId in ('order-1','order-2') eq false",
    );
  });

  it('has no predicate for an empty value or an unset column', () => {
    expect(columnPredicate('instanceId', 'Equals', '')).toBe('');
    expect(columnPredicate('', 'Equals', 'order-1')).toBe('');

    // React's own guard: the select's "no column" value was the string '0'
    expect(columnPredicate('0', 'Equals', 'order-1')).toBe('');
  });
});

describe('toArrayOfStrings', () => {
  it('quotes what is not quoted, and leaves what is', () => {
    expect(toArrayOfStrings('a, b')).toEqual(["'a'", "'b'"]);
    expect(toArrayOfStrings("'a','b'")).toEqual(["'a'", "'b'"]);
  });

  it('falls back to CSV for something that starts like JSON but is not', () => {
    expect(toArrayOfStrings('[a, b')).toEqual(["'[a'", "'b'"]);
  });

  it('reads a JSON array of anything as strings', () => {
    expect(toArrayOfStrings('[1, 2]')).toEqual(["'1'", "'2'"]);
  });
});

describe('buildInstancesFilter', () => {
  it('always sends the window and a status list', () => {
    expect(buildInstancesFilter(window)).toBe(
      `createdTime ge '${window.from}' and createdTime le '${window.to}' and ${everyStatus}`,
    );
  });

  it('sends the statuses that are selected', () => {
    expect(buildInstancesFilter({ ...window, statuses: ['Running', 'Failed'] })).toContain(
      "runtimeStatus in ('Running','Failed')",
    );
  });

  it('lets the entities in through the same list', () => {
    expect(buildInstancesFilter({ ...window, statuses: ['Running', 'Failed'], includeEntities: true })).toContain(
      `runtimeStatus in ('Running','Failed','${DURABLE_ENTITIES}')`,
    );

    // And with no status selected: all eight, plus the entities
    expect(buildInstancesFilter({ ...window, includeEntities: true })).toContain(`'Suspended','${DURABLE_ENTITIES}')`);
  });

  it('appends the column predicate when there is a value in force', () => {
    const clause = buildInstancesFilter({ ...window, column: 'name', op: 'Contains', value: 'Order' });

    expect(clause.endsWith(" and contains(name, 'Order')")).toBe(true);
  });

  it('appends nothing while the value is empty', () => {
    expect(buildInstancesFilter({ ...window, column: 'name', op: 'Contains', value: '' })).toBe(
      buildInstancesFilter(window),
    );
  });
});

describe('buildHistoryFilter', () => {
  it('filters the history from a moment, or not at all', () => {
    expect(buildHistoryFilter({ timeFrom: '2026-09-04T14:02:11Z' })).toBe("timestamp ge '2026-09-04T14:02:11Z'");
    expect(buildHistoryFilter({})).toBe('');
    expect(buildHistoryFilter({ timeFrom: null })).toBe('');
  });
});
