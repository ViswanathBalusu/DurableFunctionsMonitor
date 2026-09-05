// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What both readers of the audit trail - the Activity screen and the Overview's Recent activity
// panel - need to say about one row.

import type { AuditRow } from '$lib/api/types';

/** What the outcome chip says: `ok`, or the status code that was not ok. */
export function outcomeLabel(row: AuditRow): string {
  return row.outcome === 'ok' ? 'ok' : String(row.status);
}

/**
 * Identity for one row of the trail. An `AuditRow` carries nothing unique of its own - the same user
 * can run the same operation against the same instance twice inside the second the record is stamped
 * with, and a hub that has been through a few runs really does hold such pairs - so identity is the
 * object the page was given, not its contents. The store's own RowKey (reverse ticks plus a random
 * suffix) would do it, but it is not part of the response contract.
 *
 * A reload builds new objects and therefore new keys, which is what a replaced list is.
 */
const keys = new WeakMap<AuditRow, string>();

let next = 0;

export function auditRowKey(row: AuditRow): string {
  let key = keys.get(row);

  if (key === undefined) {
    key = `audit-${next++}`;
    keys.set(row, key);
  }

  return key;
}
