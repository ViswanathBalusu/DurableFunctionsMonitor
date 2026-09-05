// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Snippet } from 'svelte';

/** One column of the DataTable. `accessor` is what a plain cell shows; `cell` overrides it entirely. */
export interface ColumnDef<Row = Record<string, unknown>> {
  /** Stable id, used by sorting, hiding and the header context menu. */
  id: string;
  /** The header text, which is also the `data-label` every cell carries for the mobile card layout. */
  header: string;
  accessor?: (row: Row) => unknown;
  /** Monospace column (ids, timestamps, durations). */
  mono?: boolean;
  /** Truncates with an ellipsis instead of widening the table (`.trunc`). */
  trunc?: boolean;
  /** Right-aligns the header and every cell: the actions column of ScreenEntities.dc.html L39. */
  align?: 'left' | 'right';
  sortable?: boolean;
  /** Hidden unless the user turns it on (the column chooser starts from this). */
  hidden?: boolean;
  width?: string;
  /** Full control over the cell's content. */
  cell?: Snippet<[Row]>;
}

export interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

/**
 * The three-state cycle of the React app: unsorted → ascending → descending → unsorted. Clicking a
 * different column starts that column at ascending.
 */
export function nextSort(current: SortState | null, id: string): SortState | null {
  if (current?.id !== id) {
    return { id, dir: 'asc' };
  }

  return current.dir === 'asc' ? { id, dir: 'desc' } : null;
}

/** The class a header cell carries while it is the sorted one (dfm-ui.css L164-L165). */
export function sortClass(sort: SortState | null, id: string): string {
  if (sort?.id !== id) {
    return '';
  }

  return sort.dir === 'desc' ? 'sort desc' : 'sort';
}

/** The columns actually rendered, in order, with the hidden ones removed. */
export function visibleColumns<Row>(columns: ColumnDef<Row>[], hidden: string[]): ColumnDef<Row>[] {
  return columns.filter((column) => !hidden.includes(column.id));
}
