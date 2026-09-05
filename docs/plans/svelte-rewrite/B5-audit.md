# B5 · Audit

Goal: every Write and Dangerous call through DfMon is recorded (who, what, which instance, outcome) in a `{hub}DfmAudit` table when `DFM_AUDIT_ENABLED=true`, and `GET /audit` reads it for the Activity screen and the Overview panel.

Prerequisites: B0 (routine slots, capabilities). Read contracts §6 (`AuditResponse`); `Common/ExtensionMethods.cs` (middleware), `Common/Auth.cs` (`GetClaimsPrincipal`), `Common/TableClient.cs`, `docs/plans/input-events-restart-rewind-replay.md` §3.1 (the optional audit hook this epic makes real).

Exit criteria: performing actions on the standalone host with auditing on produces rows readable through `/audit`; the middleware never fails a request because of auditing; `capabilities.audit` is true only when enabled and supported.

### B5-S1 Settings and model

#### B5-S1-T1 AuditEnabled setting
Files: `Common/DfmSettings.cs`, `Common/Globals.cs` (`EnvVariableNames.DFM_AUDIT_ENABLED`), `tests/…core.tests/SetupTests.cs`
Depends: none
Do:
1. `public bool AuditEnabled { get; set; }` initialised from `DFM_AUDIT_ENABLED` with the same "literal true, any casing" rule as `DangerousOperationsEnabled`; overridable from code.
2. `Capabilities.audit` (B0-S2-T1) now reads `settings.AuditEnabled && ext.ReadAuditRecordsRoutine != null`.
Accept:
- [ ] Parsing tests for unset, empty, `true`, `TRUE`, `false`.
Test: as above.

#### B5-S1-T2 Operation naming
Files: `Common/AuditOperations.cs`, `tests/…core.tests/AuditOperationsTests.cs`
Depends: none
Do:
1. `AuditOperations.FromRequest(string method, string absolutePath, string action /* route value when present */)` → `(string operation, bool dangerous, string instanceId)`: parse `orchestrations('{id}')` from the path (URL-decoded) and map the trailing segment: `suspend` → "Suspend", `resume` → "Resume", `rewind` → "Rewind", `terminate` → "Terminate", `raise-event` → "Raise event", `set-custom-status` → "Set customStatus", `restart` → "Restart", `purge` → "Purge", `update-input-and-rewind` → "Update input and rewind", `replay` → "Replay" (dangerous), `restart-in-place` → "Restart in place" (dangerous); `POST /orchestrations` → "Start new instance"; `/orchestrations/batch` → "Batch" (the function appends the action: "Batch terminate"); `/purge-history` → "Purge history"; `/clean-entity-storage` → "Clean entity storage"; `/delete-task-hub` → "Delete task hub"; anything else → the last path segment.
Accept:
- [ ] Every mapping above has a test, including an instance id containing `%27`.
Test: as above.

### B5-S2 Writer

#### B5-S2-T1 Azure Table audit writer and reader
Files: `Common/AuditStore.cs`, `Common/DfmExtensionPoints.cs` (defaults), `durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs` (set `null` for both), `tests/…integrationtests/AuditStoreTests.cs`
Depends: B0-S1-T1
Do:
1. Table `{hub}DfmAudit`, created on first write (cache the "created" flag per table name in a `ConcurrentDictionary`). Row: `PartitionKey = at.ToString("yyyyMMdd")` (UTC), `RowKey = $"{DateTime.MaxValue.Ticks - at.UtcTicks:D19}-{Guid.NewGuid():N}[..8]"` (newest first within the day), columns `At` (DateTimeOffset), `User`, `Operation`, `Kind` ("Write"/"Dangerous"), `InstanceId` (may be empty), `Outcome` ("ok"/"failed"), `Status` (int), `Message` (≤ 8 KB, truncated), `Route`.
2. Reader `ReadAsync(connEnvVar, hub, AuditQuery { From, To, Operation, Top, Skip })`: iterate day partitions from `To`'s day back to `From`'s day (at most 92), query each with `PartitionKey eq {day}` (+ `and Operation eq {op}` when given), rows already sort newest first by RowKey; stop when `Skip + Top + 1` rows are collected across days; return `AuditPage { Rows, HasMore }`. Filter `At` inside `[From, To]` client-side for the boundary days.
3. Netherite keeps the default (it has a storage account); MSSQL sets both routines to `null` until a SQL store exists.
Accept:
- [ ] Azurite: write 3 rows across two days, read newest first, `Top 2` → `HasMore true`, operation filter works.
Test: as above.

#### B5-S2-T2 Middleware hook
Files: `Common/ExtensionMethods.cs`, `Common/AuditWriter.cs` (new), `tests/…core.tests/AuditMiddlewareTests.cs`
Depends: B5-S1-T2, B5-S2-T1, B5-S1-T1
Do:
1. In the DfMon middleware, after `await next()` (and in the catch blocks), when `operationKind` is `Write` or `Dangerous` and `settings.AuditEnabled` and `extensionPoints.WriteAuditRecordRoutine != null`: build an `AuditRecord` from `AuditOperations.FromRequest`, the user (`Auth.GetClaimsPrincipal` user-name claim when available; `"vscode"` when the nonce path authenticated the call; `"anonymous"` when authentication is disabled), the hub from the route (`Auth.ConnNameAndHubNameRegex` already parses `/a/p/i/{conn}-{hub}/`), the response status from `context.GetInvocationResult().Value as HttpResponseData` (500 when the function threw), `Outcome = status < 400 ? "ok" : "failed"`, and a message: for failures the response body text (read a copy; ≤ 8 KB), for `batch` the counts (the batch function stores a summary in `context.Items["DfmAuditMessage"]`; any function may set that key to enrich its row), for `replay` the deleted row count likewise.
2. Fire-and-forget with `Task.Run` + logging on failure; auditing must never change the response or its timing beyond building the record.
3. Store the user name in `context.Items[Globals.DfmUserNameContextValue]` (new constant) so functions can use it too.
Accept:
- [ ] Unit test with a fake routine: a Write function call records one row with the operation name, status and user; a Read call records nothing; a throwing routine does not affect the response.
Test: as above.

**Gap, found by E11-S2-T1 (2026-09-05).** Point 1 asks the replay endpoint to store its deleted-row
count in `DfmAuditMessage`, the way `Functions/Batch.cs` stores its counts. It does not
(`Functions/InputEvents.cs` computes `deletedRows` and returns it, but never puts it in
`context.Items`), so a successful replay is audited with no message at all and the Activity screen
shows an em dash in its details cell. Two lines in the replay function would close it; nothing else
in this epic depends on it.

### B5-S3 Endpoint

#### B5-S3-T1 GET /audit
Files: `Functions/Audit.cs`, `tests/…core.tests/AuditFunctionTests.cs`
Depends: B5-S2-T1, B3-S2-T2 (`RangeQuery`)
Do:
1. Read function, route `Globals.ApiRoutePrefix + "/audit"`; `from`/`to` (default: last 24 hours), `operation`, `$top` (default 100, max 500), `$skip`. When `!settings.AuditEnabled` or the reader is null → 200 `{ rows: [], hasMore: false, enabled: false }` (the UI shows the "auditing is off" empty state). Otherwise map `AuditRecord` → `AuditRow` (contracts §6) and return `{ rows, hasMore, enabled: true }`.
Accept:
- [ ] Unit tests: disabled → `enabled false`; fake reader → rows mapped with `kind` and `outcome`.
Test: as above.
