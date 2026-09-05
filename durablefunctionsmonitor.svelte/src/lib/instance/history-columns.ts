// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The columns of the History table (ScreenInstance.dc.html L130-L141). The cells themselves are
// snippets in HistoryTab.svelte; this is the part that can be reasoned about without rendering.

import type { HistoryEvent } from '$lib/api/types';
import type { ColumnDef } from '$lib/components/table/columns';
import { fmtTimeMs } from '$lib/format/time';

/** The eight headers of the mockup, in order; the spine is the table's own first column. */
export const HISTORY_COLUMNS = [
  '#',
  'Timestamp',
  'EventType',
  'Name',
  'ScheduledTime',
  'Duration',
  'Result / Details',
] as const;

export type HistoryColumnId = (typeof HISTORY_COLUMNS)[number];

/** The base definitions; `HistoryTab` adds the `cell` snippets. Nothing here is sortable: the backend
 * returns the history in sequence order and has no `$orderby` for it (contracts §6). */
export function historyColumns(): ColumnDef<HistoryEvent>[] {
  return [
    { id: '#', header: '#', mono: true, width: '64px' },
    { id: 'Timestamp', header: 'Timestamp', mono: true },
    { id: 'EventType', header: 'EventType' },
    { id: 'Name', header: 'Name', mono: true },
    { id: 'ScheduledTime', header: 'ScheduledTime', mono: true },
    { id: 'Duration', header: 'Duration', mono: true },
    { id: 'Result / Details', header: 'Result / Details', mono: true, trunc: true },
  ];
}

/**
 * What the row is keyed by. A history has no ids of its own, so it is the sequence number - and,
 * for the rows a provider leaves without one, the moment and the kind of event, which is as unique
 * as anything else the row carries.
 */
export function historyKey(event: HistoryEvent): string {
  return event.SequenceNumber === null ? `${event.Timestamp}:${event.EventType}` : `s${event.SequenceNumber}`;
}

/** What a row shows in `Result / Details`: whichever of the two the runtime filled in. */
export function resultOf(event: HistoryEvent): unknown {
  return event.Result ?? event.Details;
}

/** `TaskCompleted · ChargePayment`, or `TaskCompleted · #9` for a row with no name. */
export function jsonTitle(event: HistoryEvent): string {
  return `${event.EventType} · ${event.Name || `#${event.SequenceNumber ?? ''}`}`;
}

/** `#9 · 14:02:17.106` under the title, which is what says which row is open. */
export function jsonSubtitle(event: HistoryEvent, showTimeAs: 'UTC' | 'Local' = 'UTC'): string {
  return `#${event.SequenceNumber ?? ''} · ${fmtTimeMs(event.Timestamp, showTimeAs)}`;
}
