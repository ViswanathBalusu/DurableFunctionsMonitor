// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The status and kind vocabulary of contracts §11: the one place that turns a backend value into a
// dfm-ui.css class. Screens never build these strings themselves.

import type { EntityType, RuntimeStatus } from '$lib/api/types';

/** Every runtime status the backend can report, in the order the filter chips list them. */
export const RUNTIME_STATUSES: readonly RuntimeStatus[] = [
  'Completed',
  'Running',
  'Failed',
  'Pending',
  'Terminated',
  'Canceled',
  'ContinuedAsNew',
  'Suspended',
];

/**
 * The chip class of a runtime status (dfm-ui.css L59-L66). ContinuedAsNew is `st-continued` - the
 * stylesheet also accepts `st-continuedasnew`, but the contract names the short one.
 * An unknown status (a future runtime, or a provider that invents one) gets no class rather than a
 * wrong one: the chip still renders, in the default colours, with the text the backend sent.
 */
export function statusClass(status: string | null | undefined): string {
  if (!status) {
    return '';
  }

  return status === 'ContinuedAsNew' ? 'st-continued' : `st-${status.toLowerCase()}`;
}

/**
 * The value of the `data-st` attribute on a table row's spine cell. The stylesheet colours the spine
 * from it, so it carries the status verbatim - including ContinuedAsNew.
 */
export function spineAttr(status: string | null | undefined): string {
  return status ?? '';
}

/** `kind-entity` or `kind-orchestration` (contracts §11). */
export function kindClass(entityType: EntityType | string | null | undefined): string {
  return entityType === 'DurableEntity' ? 'kind-entity' : 'kind-orchestration';
}

/** True for the eight statuses the UI knows, so a screen can tell "unknown" from "not set". */
export function isKnownStatus(status: string | null | undefined): status is RuntimeStatus {
  return !!status && (RUNTIME_STATUSES as readonly string[]).includes(status);
}
