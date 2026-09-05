// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ScreenActivity.dc.html: the audit trail of the writes and dangerous operations someone ran
// against this hub - who, what, when, and whether it worked.

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
        operation: 'RaiseEvent',
        instanceId: 'order-2026-09-04-000913',
        status: 202,
      }),
      auditRow({
        at: '2026-09-04T13:20:11Z',
        user: 'ops@contoso.com',
        operation: 'UpdateInputAndRewind',
        kind: 'Dangerous',
        instanceId: 'order-2026-09-04-000907',
        outcome: 'failed',
        status: 409,
        message: 'The instance is Running; terminate it first',
      }),
      auditRow({
        at: '2026-09-03T02:44:00Z',
        user: 'ops@contoso.com',
        operation: 'PurgeHistory',
        instanceId: null,
        status: 200,
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
