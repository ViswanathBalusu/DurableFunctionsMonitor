// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Which columns the Instances table has, what they show, and which of them the backend can sort by.
// The cells themselves are snippets declared in InstancesTable.svelte - this file is the part that
// can be reasoned about without rendering anything.

import type { OrchestrationStatus } from '$lib/api/types';
import type { ColumnDef } from '$lib/components/table/columns';
import type { PeekItem } from '$lib/state/peek.svelte';

/** The columns, in the order the mockup draws them (ScreenInstances.dc.html L78-L88). */
export const INSTANCE_COLUMNS = [
  'instanceId',
  'name',
  'createdTime',
  'lastUpdatedTime',
  'runtimeStatus',
  'duration',
  'customStatus',
  'lastEvent',
  'parentInstanceId',
  'input',
  'output',
] as const;

export type InstanceColumnId = (typeof INSTANCE_COLUMNS)[number];

/** The header each column carries, which is also its `data-label` in the mobile card layout. */
export const COLUMN_HEADERS: Readonly<Record<InstanceColumnId, string>> = {
  instanceId: 'instanceId',
  name: 'name',
  createdTime: 'createdTime',
  lastUpdatedTime: 'lastUpdatedTime',
  runtimeStatus: 'runtimeStatus',
  duration: 'duration',
  customStatus: 'customStatus',
  lastEvent: 'lastEvent',
  parentInstanceId: 'parentInstanceId',
  input: 'input',
  output: 'output',
};

/**
 * The backend sorts by property name, so only the columns that are properties of the row can be
 * sorted; the payload columns are not, and a header that cannot sort must not offer to.
 */
export const SORTABLE_COLUMNS: readonly InstanceColumnId[] = [
  'instanceId',
  'name',
  'createdTime',
  'lastUpdatedTime',
  'runtimeStatus',
  'duration',
  'lastEvent',
  'parentInstanceId',
];

export function isSortable(id: string): boolean {
  return (SORTABLE_COLUMNS as readonly string[]).includes(id);
}

/** True for the two columns whose text is monospace throughout. */
export function isMono(id: string): boolean {
  return id !== 'name' && id !== 'runtimeStatus';
}

/** The base definitions; `InstancesTable` adds the `cell` snippets. */
export function baseColumns(): ColumnDef<OrchestrationStatus>[] {
  return INSTANCE_COLUMNS.map((id) => ({
    id,
    header: COLUMN_HEADERS[id],
    mono: isMono(id),
    sortable: isSortable(id),
    trunc: id === 'customStatus' || id === 'input' || id === 'output',
  }));
}

/** An entity's name is its entity name, not the `@name@key` instance id it is listed under. */
export function displayName(row: OrchestrationStatus): string {
  return row.entityType === 'DurableEntity' ? (row.entityId?.name ?? row.name) : row.name;
}

/** Entities have no duration worth showing: they are never "done" (contracts §11). */
export function durationOf(row: OrchestrationStatus): number | null {
  return row.entityType === 'DurableEntity' ? null : row.duration;
}

/** What the peek panel is opened with; the entity's state is the input column it comes back in. */
export function toPeekItem(row: OrchestrationStatus): PeekItem {
  return {
    id: row.instanceId,
    name: displayName(row),
    kind: row.entityType,
    status: row.runtimeStatus,
    created: row.createdTime,
    updated: row.lastUpdatedTime,
    duration: durationOf(row),
    customStatus: row.customStatus,
    state: row.entityType === 'DurableEntity' ? row.input : undefined,
  };
}
