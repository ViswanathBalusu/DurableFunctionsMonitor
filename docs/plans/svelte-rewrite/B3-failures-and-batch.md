# B3 · /failures and /orchestrations/batch

Goal: failed instances in a range grouped by orchestrator and normalised error signature, and a bounded batch endpoint for the bulk action bar.

Prerequisites: B0, B1 (cache, projected query). Read contracts §6 (`FailuresResponse`, `BatchRequest`, `BatchResponse`); `Functions/Orchestration.cs` (`DfmPostOrchestrationFunction`), `Common/LargeMessageBlobs.cs`.

Exit criteria: both endpoints work on the standalone host; the signature normaliser has exhaustive tests; batch actions share code with the single-instance actions.

### B3-S1 Failure signatures

#### B3-S1-T1 FailureSignature.Normalize (pure)
Files: `Common/FailureSignature.cs`, `tests/…core.tests/FailureSignatureTests.cs`
Depends: none
Do:
1. `Extract(string output)`: if `output` parses as JSON with an `ErrorMessage` or `message` property (case-insensitive; also `InnerFailure.ErrorMessage` when the outer one is empty), use it; if it is a JSON string, unwrap it; else the raw text. Take the first line, trim, cap at 300 characters.
2. `Normalize(string reason)`: replace GUIDs, then numbers (integers and decimals, including inside identifiers like `SKU-4471` → `SKU-*`), then single/double-quoted values, then long hex runs (≥ 8) with `*`; collapse repeated `*`, collapse whitespace; empty → `(no message)`. Examples from the mockup must hold: `InventoryUnavailable: SKU-4471 has 0 units in warehouse-07` → `InventoryUnavailable: SKU-* has * units in warehouse-*`; `Timeout: ChargePayment did not complete within 20 s` → `Timeout: ChargePayment did not complete within * s`; `Ledger checksum mismatch for account "4471-EU": expected 8f3a…, got 91c0…` → `Ledger checksum mismatch for account *: expected *, got *`.
3. `GroupKey(name, signature)` = `name + "|" + signature`.
Accept:
- [ ] The three examples plus GUID, decimal, quoted, hex and empty cases.
Test: as above.

### B3-S2 Failures endpoint

#### B3-S2-T1 Azure Storage failures routine
Files: `Common/AzureStorageAggregations.cs` (extend), `Common/FailuresAggregator.cs` (pure grouping), `tests/…core.tests/FailuresAggregatorTests.cs`, `tests/…integrationtests/FailuresTests.cs`
Depends: B3-S1-T1, B1-S1-T2
Do:
1. Query `{hub}Instances` with `RuntimeStatus eq 'Failed' and CreatedTime ge {from} and CreatedTime le {to}`, `select Name, CreatedTime, CompletedTime, LastUpdatedTime, Output`, cap `DfmSettings.StatsScanCap`. Skip entity rows.
2. Reason per row: `Output` when inline; when `LargeMessageBlobs.IsUrl(Output)`, download through `DownloadByUrlAsync` and keep the first 2 KB, at most 20 downloads per request (the rest get `(large output)`).
3. `FailuresAggregator.Group(rows)`: groups by `GroupKey`, `count`, `lastSeenAt = max(LastUpdatedTime)`, `sampleIds` (first 5), `instances` (newest 50 per group by `CreatedTime` desc with `durationMs = CompletedTime ?? LastUpdatedTime - CreatedTime`), groups sorted by count desc then lastSeenAt desc; `totalFailed = rows.Count`.
4. Default routine in `DfmExtensionPoints`; MSSQL: `SELECT … FROM Instances WHERE RuntimeStatus='Failed' AND …` joined to the output payload text (optional, same rule as B1-S2-T4); Netherite: null.
Accept:
- [ ] Azurite: 9 seeded failed rows in three signatures produce three groups with counts 6, 2, 1.
Test: as above.

#### B3-S2-T2 GET /failures
Files: `Functions/Failures.cs`, `tests/…core.tests/FailuresFunctionTests.cs`
Depends: B3-S2-T1, B1-S1-T1
Do:
1. Read function, same parameter parsing and cache wrapping as `/stats` (share a `RangeQuery.Parse(req)` helper in `Common/RangeQuery.cs` used by stats, failures and audit). Null routine → 400.
Accept:
- [ ] Unit tests mirror the stats ones.
Test: as above.

### B3-S3 Batch endpoint

#### B3-S3-T1 Extract OrchestrationActions
Files: `Common/OrchestrationActions.cs` (new), `Functions/Orchestration.cs` (refactor), `tests/…core.tests/OrchestrationActionsTests.cs`
Depends: none
Do:
1. Move the `switch (action)` body of `DfmPostOrchestrationFunction` (suspend, resume, purge, rewind, terminate, raise-event, set-custom-status, restart) into `OrchestrationActions.ExecuteAsync(DurableTaskClient client, string connName, string instanceId, string action, JsonNode payload /* may be null */)` where the payload carries `reason`, `name`, `data`, `customStatus`, `restartWithNewInstanceId`; the single-instance function adapts its raw body to that shape (string bodies become `reason`; the raise-event object maps `name`/`data`; set-custom-status maps the whole body to `customStatus`; restart maps the flag). `input`/`output`/`custom-status` downloads stay in the function.
2. Unknown action → `DfmBadRequestException`; `InvalidOperationException` from the client → `DfmConflictException` (status precondition), so callers map to 409.
Accept:
- [ ] Existing behaviour of every single-instance action is unchanged (tests call the function with the old bodies and assert the fake client received the same calls).
Test: as above.

#### B3-S3-T2 POST /orchestrations/batch
Files: `Functions/Batch.cs`, `tests/…core.tests/BatchFunctionTests.cs`, `tests/…core.tests/AuthTests.cs`
Depends: B3-S3-T1
Do:
1. `[OperationKind(Kind = OperationKind.Write)]`, route `Globals.ApiRoutePrefix + "/orchestrations/batch"` (a literal segment beside `orchestrations('{instanceId}')/{action?}`; verify routing precedence with a unit test of the route strings and a manual host check).
2. Body validation: `action` in the eight allowed values (`replay`, `restart-in-place`, `update-input-and-rewind` are refused with 400 "Dangerous operations cannot run in batch"), `instanceIds` non-empty, ≤ 200, distinct, no entity ids for orchestration-only actions (`rewind`, `restart`, `suspend`, `resume`); `payload` object optional.
3. Execute with `SemaphoreSlim(8)`; per id catch and map: `DfmConflictException` → 409, `DfmNotFoundException` → 404, `DfmBadRequestException` → 400, other → 500 with `ex.Message`; success → 200. Response `{ action, results[], okCount, failedCount, elapsedMs }` with `results` in request order. Always HTTP 200 (per-id status inside), except validation errors (400).
4. Add `DfmBatchFunction` to the Write list in `AuthTests`.
Accept:
- [ ] 3 ids where the fake client throws `InvalidOperationException` for one → `okCount 2`, that id `status 409`.
- [ ] 201 ids → 400.
Test: as above.
