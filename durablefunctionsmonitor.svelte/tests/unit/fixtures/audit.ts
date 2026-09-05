// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenActivity.dc.html: the audit trail of the writes and dangerous operations someone ran
// against this hub - who, what, when, and whether it worked.
//
// The operation names are the ones the middleware writes (`Common/AuditOperations.cs`): human
// readable, with spaces, and matched verbatim by `/audit?operation=`. Two of them are Dangerous.

import type { AuditResponse, AuditRow } from '$lib/api/types';

export function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    at: '2026-09-04T14:02:41Z',
    user: 'chandra@contoso.com',
    operation: 'Terminate',
    kind: 'Write',
    instanceId: 'order-2026-09-04-000911',
    outcome: 'ok',
    status: 202,
    message: null,
    ...overrides,
  };
}

export function audit(overrides: Partial<AuditResponse> = {}): AuditResponse {
  return {
    rows: [
      auditRow(),
      auditRow({
        at: '2026-09-04T13:58:02Z',
        operation: 'Raise event',
        instanceId: 'order-2026-09-04-000913',
        status: 202,
        message: 'PaymentApproved · 0.1 KB',
      }),
      auditRow({
        at: '2026-09-04T13:41:22Z',
        operation: 'Replay',
        kind: 'Dangerous',
        instanceId: 'order-2026-09-04-000913',
        status: 200,
        message: 'from #27 · 14 history rows removed · PaymentApproved raised again',
      }),
      auditRow({
        at: '2026-09-04T13:20:11Z',
        user: 'ops@contoso.com',
        operation: 'Update input and rewind',
        kind: 'Dangerous',
        instanceId: 'order-2026-09-04-000907',
        outcome: 'failed',
        status: 409,
        message: 'The instance is Running; terminate it first',
      }),
      auditRow({
        at: '2026-09-04T11:02:31Z',
        user: 'ops@contoso.com',
        operation: 'Restart in place',
        kind: 'Dangerous',
        instanceId: 'order-2026-09-04-000880',
        status: 200,
        message: 'purged and restarted with the initial input',
      }),
      auditRow({
        at: '2026-09-03T02:44:00Z',
        user: 'ops@contoso.com',
        operation: 'Purge history',
        instanceId: null,
        status: 200,
        message: 'Completed and Terminated before 2026-08-05 · 1,284 instances',
      }),
    ],
    hasMore: false,
    enabled: true,
    ...overrides,
  };
}

/** What a hub with auditing off answers: an empty page that says why, not an error. */
export function auditDisabled(overrides: Partial<AuditResponse> = {}): AuditResponse {
  return audit({ rows: [], enabled: false, ...overrides });
}
