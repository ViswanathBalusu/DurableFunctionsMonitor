// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The `$filter` clause of GET /orchestrations (contracts §6), a port of React's
// `FilterOperatorEnum.toOdataFilterQuery` and `OrchestrationsState.getFilterClause`. The strings it
// produces are what the backend's own OData parser accepts, down to the URL-encoded values inside
// the quotes - that is React's rule, and changing it would change which rows come back.

import type { RuntimeStatus } from '$lib/api/types';
import { RUNTIME_STATUSES } from '$lib/format/status';

export type FilterOperator =
  'Equals' | 'NotEquals' | 'StartsWith' | 'NotStartsWith' | 'Contains' | 'NotContains' | 'In' | 'NotIn';

/** The operators in the order the rail's select lists them (ScreenInstances.dc.html L56). */
export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'Equals',
  'NotEquals',
  'StartsWith',
  'NotStartsWith',
  'Contains',
  'NotContains',
  'In',
  'NotIn',
];

/** Their labels, which the chip also shows lowercased. */
export const FILTER_OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  Equals: 'Equals',
  NotEquals: 'Not Equals',
  StartsWith: 'Starts With',
  NotStartsWith: 'Not Starts With',
  Contains: 'Contains',
  NotContains: 'Not Contains',
  In: 'In',
  NotIn: 'Not In',
};

/** The one value `runtimeStatus in (…)` takes that is not a runtime status. */
export const DURABLE_ENTITIES = 'DurableEntities';

/**
 * `In` and `NotIn` take a list: a JSON array, or comma-separated values. Quotes the user typed are
 * kept as they are, which is how React let someone paste a list that was already quoted.
 */
export function toArrayOfStrings(value: string): string[] {
  if (value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed.map((item) => `'${String(item)}'`);
      }
    } catch {
      // Not JSON after all: fall through and read it as CSV
    }
  }

  return value.split(',').map((item) => {
    const trimmed = item.trim();

    return trimmed.startsWith("'") ? trimmed : `'${trimmed}'`;
  });
}

/**
 * One column predicate, or `''` when there is nothing to filter on. Values are `encodeURIComponent`d
 * inside the quotes (React parity): the clause is inserted into the URL verbatim by the endpoint.
 */
export function columnPredicate(column: string, operator: FilterOperator, value: string): string {
  if (!value || !column || column === '0') {
    return '';
  }

  const encoded = encodeURIComponent(value);

  switch (operator) {
    case 'Equals':
      return `${column} eq '${encoded}'`;
    case 'NotEquals':
      return `${column} ne '${encoded}'`;
    case 'StartsWith':
      return `startswith(${column}, '${encoded}')`;
    case 'NotStartsWith':
      return `startswith(${column}, '${encoded}') eq false`;
    case 'Contains':
      return `contains(${column}, '${encoded}')`;
    case 'NotContains':
      return `contains(${column}, '${encoded}') eq false`;
    case 'In':
    case 'NotIn': {
      const values = toArrayOfStrings(value)
        .map((item) => encodeURIComponent(item))
        .join(',');

      return `${column} in (${values})${operator === 'NotIn' ? ' eq false' : ''}`;
    }
    default:
      return '';
  }
}

export interface InstancesFilter {
  /** ISO, the resolved window of the shared time range (contracts §4). */
  from: string;
  to: string;
  /** Empty means "every status", which is sent as the full list rather than omitted. */
  statuses?: RuntimeStatus[];
  includeEntities?: boolean;
  column?: string;
  op?: FilterOperator;
  /** The value in force, not the one being typed. */
  value?: string;
}

/**
 * The whole clause. `runtimeStatus in (…)` is always sent - with all eight statuses when the user
 * selected none - because that is how entities are kept out of (or let into) the list: the backend
 * has no other way to tell "no filter" from "orchestrations only".
 */
export function buildInstancesFilter(filter: InstancesFilter): string {
  const statuses: string[] = filter.statuses?.length ? [...filter.statuses] : [...RUNTIME_STATUSES];

  if (filter.includeEntities) {
    statuses.push(DURABLE_ENTITIES);
  }

  let clause = `createdTime ge '${filter.from}' and createdTime le '${filter.to}'`;

  clause += ` and runtimeStatus in (${statuses.map((status) => `'${status}'`).join(',')})`;

  const predicate = columnPredicate(filter.column ?? '', filter.op ?? 'StartsWith', filter.value ?? '');

  if (predicate) {
    clause += ` and ${predicate}`;
  }

  return clause;
}

/** The history tab's own filter: everything since a moment, or nothing at all. */
export function buildHistoryFilter(filter: { timeFrom?: string | null }): string {
  return filter.timeFrom ? `timestamp ge '${filter.timeFrom}'` : '';
}
