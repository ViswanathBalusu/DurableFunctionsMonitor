# Editing orchestration inputs: restart in place, update-and-rewind, replay

Status: implemented in the backend (September 2026), as described below. The React UI stays untouched; the API contract is designed so the UI can be wired later without further backend changes. The read endpoint carries no `executionId` field (the isolated client does not expose it), and terminal means Completed, Failed or Terminated (the SDK's `Canceled` value is obsolete).

Scope: `durablefunctionsmonitor.dotnetisolated.core` with the default Azure Storage provider. The MSSQL and Netherite packages opt out of the storage-editing operations until they get their own implementations (section 7).

## 1. Summary

Three new instance operations plus one read endpoint that tells a caller which of them apply to which event.

| Operation | Target event | Allowed when | OperationKind | Mechanism |
|---|---|---|---|---|
| Restart in place | `ExecutionStarted`, and the current execution has received no `EventRaised` | Instance is `Failed`. Not a sub-orchestration. | `Dangerous` (new) | Purge the instance, then schedule a new instance with the same instance ID and the same or edited input. |
| Update input and rewind | The last `EventRaised` (or `ExecutionStarted` when there is none) | Instance is `Failed` | `Write` | Replace the event's `Input` column in the History table, then call the built-in rewind. Only the failed steps run again, now seeing the edited input. |
| Replay | The last `EventRaised` | Instance is terminal, or `terminateIfRunning` is set | `Dangerous` (recommended, see 3.3) | Delete the history rows from that event onward, reopen the instance as Running, then raise the event again with the same or edited input. Everything after the event runs again. |

Two design decisions worth reading before the details:

1. Replay is implemented as "truncate, reopen, re-raise", not as "mark the instance Failed, then rewind". Rewind only rewrites failure rows (`TaskFailed`, `SubOrchestrationInstanceFailed`, and the `ExecutionCompleted` row whose `OrchestrationStatus` is `Failed`) and then wakes the orchestrator with a payload-less `GenericEvent`. After the rows from the event onward are deleted there is nothing failed left to rewrite, and a rewind carries no input, so the edited payload could never reach the orchestrator. Raising the event again delivers the input through the normal `EventRaised` path, and the Durable Task Framework writes that history row itself (including large-payload offloading). The observable result is what was asked for: everything after that event executes again.
2. The three operations share one eligibility model, computed by the backend and returned by the read endpoint. Every write endpoint re-validates the same rules before touching storage, so the UI never has to encode them.

## 2. Verified engine behaviour the design relies on

Checked against the current `Azure/durabletask` (DurableTask.AzureStorage, DurableTask.Core), `Azure/azure-functions-durable-extension` (host) and `microsoft/durabletask-dotnet` (isolated client, resolved version 1.24.1 in this repo) sources.

History table (`{hub}History`):

- `PartitionKey` is the instance ID. `RowKey` is the event's sequence number formatted as 16 upper-case hex digits (`sequenceNumber.ToString("X16")`), so rows sort chronologically and `RowKey ge '0000000000000011'` is a valid range filter. Every row also carries an `ExecutionId` column.
- A new generation of the same instance (ContinueAsNew, or re-creating a terminal instance with the same ID) reuses the same row keys and upserts over them. Rows beyond the new generation's length keep the old `ExecutionId`. Both the engine and DfMon's history reader stop at the first row whose `ExecutionId` differs from the current one, so those rows are inert.
- A row with `RowKey = "sentinel"` holds the current `ExecutionId`, `IsCheckpointComplete` and `CheckpointCompletedTimestamp`. Its ETag is the optimistic-concurrency token: every checkpoint merges the sentinel with `If-Match`, and a mismatch is treated as split-brain and the work item is abandoned. Note that `"sentinel"` sorts after every hex row key, so range filters must exclude it explicitly.
- The next checkpoint writes new rows starting at `allEvents.Count` (the number of rows of the current execution), using upsert-replace. Deleting the tail of a history therefore leaves no gap: the engine continues numbering exactly where the truncated history ends.
- Each episode is bracketed by `OrchestratorStarted` and `OrchestratorCompleted` rows. New messages that arrive together (for example a `TaskCompleted` and an `EventRaised`) are processed in one episode, so an `EventRaised` row is not always the first row of its episode.
- Properties `Name`, `Input`, `Result`, `Output`, `Reason`, `Details`, `Correlation`, `FailureDetails` and `Tags` larger than 60 KB (`Encoding.Unicode.GetByteCount`, so about 30,000 characters) are gzipped into the `{hub}-largemessages` blob container under `{instanceId}/history-{rowKey}-{eventType}-{random}-{property}.json.gz`; the column is set to an empty string and a `{Property}BlobName` column holds the blob name. DfMon's history reader currently ignores `*BlobName` columns.
- `_Timestamp` is the event timestamp (the engine cannot use the reserved `Timestamp` column). `EventId` is `-1` for engine-generated rows such as `OrchestratorStarted` and `OrchestratorCompleted`.

Instances table (`{hub}Instances`, one row per instance, `RowKey = ""`): `ExecutionId`, `Name`, `Version`, `Input`, `Output`, `CustomStatus`, `RuntimeStatus` (string), `CreatedTime`, `LastUpdatedTime`, `CompletedTime`, `TaskHubName`, `Tags`, `Generation`, `ParentInstanceId`, `ScheduledStartTime`. A large `Input` or `Output` is stored as the blob URL of the offloaded payload (the existing `input`/`output` download endpoints already handle that form).

Rewind (`AzureTableTrackingStore.RewindHistoryAsync`): finds the current `ExecutionId` from the newest `OrchestratorStarted` row, then for that execution rewrites each `TaskFailed` row and its matching `TaskScheduled` row (same `EventId`) to `GenericEvent` with `Reason = "Rewound: ..."`, marks `SubOrchestrationInstanceCreated` rows whose child failed and recursively rewinds the child, rewrites the failed `ExecutionCompleted` row to `GenericEvent`, sets the Instances row to `Pending`, and finally sends a `GenericEvent(-1, reason)` to each leaf instance. On replay the orchestrator re-schedules only the tasks whose `TaskScheduled` rows were rewritten; completed steps keep their recorded results.

Host-side preconditions reached through the isolated client (each maps to an `InvalidOperationException` on the caller's side):

- `RewindInstanceAsync`: the Instances row must say `Failed`.
- `RaiseEventAsync`: the Instances row must say Running, Pending, Suspended or ContinuedAsNew (Azure Storage provider, default `ThrowStatusExceptionsOnRaiseEvent`). This is why Replay must reopen the instance before raising.
- `PurgeInstanceAsync(instanceId)`: the instance must be in a terminal state. Restart in place only accepts `Failed` instances, which are terminal, so the purge precondition is always met.
- `ScheduleNewOrchestrationInstanceAsync` with an existing ID: refused only while the existing instance is in a non-overridable state (host default `OverridableExistingInstanceStates = NonRunningStates`). After a purge the Instances row is gone, so no dedupe conflict is possible.
- `TerminateInstanceAsync`: the instance must be running (Running, Pending, Suspended or ContinuedAsNew).
- The existing `RestartAsync(instanceId, restartWithNewInstanceId: false)` re-creates the instance from the Instances row's input without purging, and cannot change the input. That is the difference between the current Restart button and Restart in place.

Sub-orchestrations: a child created without an explicit ID gets `{parentExecutionId}:{n}` where `n` is the parent's action counter. After a Replay the parent keeps its `ExecutionId`, so re-created children reuse their IDs. The engine handles this as a new generation: the child's `ExecutionStarted` carries a fresh `ExecutionId`, history is loaded for that execution only (the sentinel's ID differs, so it loads empty), and `ExecutionStarted` de-duplication applies to top-level instances only. This is the same mechanism ContinueAsNew relies on. It still needs a real-host test (section 9).

Stale messages: when a message batch targets an instance that is not executable, messages whose `ExecutionId` matches the current execution are discarded and the others are deferred. After a Replay the instance is executable again with the same `ExecutionId`, so a late `TaskCompleted` or `TimerFired` from the previous run would be accepted. See risk R1.

## 3. Authorization: `OperationKind.Dangerous` and the opt-in flag

### 3.1 Changes

- `Common/Auth.cs`: add `Dangerous` to `enum OperationKind { Read, Write, Dangerous }`. At the top of `Auth.ValidateIdentityAsync`, before the ReadOnly-mode check, add: if `operationKind == OperationKind.Dangerous` and `!settings.DangerousOperationsEnabled`, throw `DfmAccessViolationException` (the middleware already turns that into 403). Everything that treats "not Read" as a write (ReadOnly mode, read-only app roles) automatically covers `Dangerous`.
- `Common/DfmSettings.cs`: add `public bool DangerousOperationsEnabled { get; set; }` (default false), initialised in the constructor from the new environment variable and overridable from code via `UseDurableFunctionsMonitor((settings, ext) => settings.DangerousOperationsEnabled = true)`.
- `Common/Globals.cs`: add `EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED`. Value `true` (case-insensitive) enables; anything else, empty or unset disables. Treat empty like unset, consistent with the .NET 10 empty-string note already in `DfmSettings`.
- `Functions/About.cs`: when the mode is `Normal` and the flag is on, add `"DurableFunctionsMonitor.DangerousOperations"` to `permissions`. The UI already reads `permissions` to decide `readOnlyMode`, so this is the hook for showing the buttons later.
- Optional audit hook: the middleware in `Common/ExtensionMethods.cs` already stores `DfmMode` in `context.Items`. Store the user name claim too (`Globals.DfmUserNameContextValue`, absent when the nonce path is used), and have every Dangerous function log a Warning with operation, instance ID and user.

### 3.2 Tests to update

`AuthTests.AllModifyingFunctionsAreMarkedAsOperationKindWrite` asserts every non-read function is `Write`. Change it to accept `Write` or `Dangerous`, and add an explicit list of the functions that must be `Dangerous`. Add: Dangerous is rejected with 403 when the flag is off (nonce path and claims path), accepted when on, and still rejected in ReadOnly mode or for a read-only role even when on.

### 3.3 Which operation gets which kind

- Restart in place: `Dangerous`, as requested.
- Replay: `Dangerous` recommended. It deletes history rows and re-executes activities that already completed (side effects run twice). Making it `Write` is a one-attribute change if the team prefers that.
- Update input and rewind: `Write`. It edits one column of one row and otherwise uses the built-in rewind, which the UI already exposes.

## 4. Endpoints

All routes are under the existing prefix `durable-functions-monitor/a/p/i/{connName}-{hubName}`. They live in a new class `Functions/InputEvents.cs` (`InputEvents : DfmFunctionBase`), so each can carry its own `OperationKind`. The write operations sit under `orchestrations('{instanceId}')/input-events/...`, two path segments below the instance, because the Functions host resolves HTTP routes first-match in function-name order rather than by literal precedence: a single-segment action such as `orchestrations('{instanceId}')/replay` is swallowed by the existing `orchestrations('{instanceId}')/{action?}` route, whose function sorts first (verified against a running host). `custom-tab-markup('{templateName}')` only escapes that because its function name sorts before `DfmPostOrchestrationFunction`; `RouteTests` now checks every pair of routes in the assembly for this.

Status codes used by all four: 400 malformed body, entity instance ID (`@name@key`), or storage provider that does not support the operation; 403 from the middleware (dangerous operations disabled, read-only mode or role); 404 instance or event not found; 409 a precondition failed (wrong status, not the last input event, external events present, sub-orchestration, terminate timeout, history changed since the caller read it); 413 input larger than the inline limit (v1, section 6.2).

### 4.1 `GET orchestrations('{instanceId}')/input-events` (Read)

Returns the input-bearing events of the current execution and which operations apply to each, so a caller can render buttons without re-implementing the rules.

```json
{
  "instanceId": "abc",
  "runtimeStatus": "Failed",
  "parentInstanceId": null,
  "dangerousOperationsEnabled": true,
  "storageSupports": { "updateInput": true, "truncateHistory": true },
  "events": [
    {
      "sequenceNumber": 1,
      "eventType": "ExecutionStarted",
      "name": "RequestTrackerOrchestrator",
      "timestamp": "2026-09-02T22:20:42.3590741Z",
      "input": { "ServiceRequestId": 1336 },
      "isLast": false,
      "operations": {
        "restart-in-place": { "allowed": false, "reason": "The instance has received external events; use replay or update-input-and-rewind on the last one." },
        "update-input-and-rewind": { "allowed": false, "reason": "Only the last input-bearing event can be edited." },
        "replay": { "allowed": false, "reason": "Use restart-in-place for the initial input." }
      }
    },
    {
      "sequenceNumber": 27,
      "eventType": "EventRaised",
      "name": "RequestTrackerApproval",
      "timestamp": "2026-09-04T22:14:34.8154818Z",
      "input": { "UserId": 10003740 },
      "isLast": true,
      "operations": {
        "update-input-and-rewind": { "allowed": true },
        "replay": { "allowed": true, "requiresTerminate": false }
      }
    }
  ]
}
```

Rules (pure function over runtime status, parent ID, history and the two capability flags; see section 5):

- `events` contains the `ExecutionStarted` event of the current execution and every `EventRaised` event, in sequence order. `isLast` marks the last `EventRaised`, or `ExecutionStarted` when there is none.
- `ExecutionStarted`: `restart-in-place` allowed when status is `Failed`, there is no `EventRaised`, `parentInstanceId` is null and the flag is on. `update-input-and-rewind` allowed when there is no `EventRaised`, status is `Failed` and `storageSupports.updateInput`. `replay` never (it is the same thing as restart in place).
- Last `EventRaised`: `update-input-and-rewind` allowed when status is `Failed` and `storageSupports.updateInput`. `replay` allowed when the flag is on and `storageSupports.truncateHistory`; `requiresTerminate` is true when the instance is Running, Pending or Suspended (replay is the only operation that offers `terminateIfRunning`).
- Earlier `EventRaised` events: no operations, with a reason.
- Sub-orchestrations (`parentInstanceId` set): `replay` and `update-input-and-rewind` stay allowed but the response carries `"warning": "The parent orchestration will not be re-run."`.

`input` is the parsed JSON when the stored string is JSON, otherwise the raw string; payloads stored in blob form are downloaded (section 6.1).

### 4.2 `POST orchestrations('{instanceId}')/input-events/restart-in-place` (Dangerous)

Request: `{ "input": <any JSON value, optional> }`. When `input` is omitted the current execution's `ExecutionStarted` input is reused verbatim.

Validation, in order: not an entity; instance exists; status is `Failed` (409 for every other status, Completed and Terminated included); the current execution has no `EventRaised` (409); `ParentInstanceId` is empty (409). The parent lookup and the read of the stored input must succeed (500 otherwise, nothing touched): an unknown parent is not treated as "no parent", and a payload that cannot be read is not treated as empty, because the purge would delete it.

Steps:

1. Capture what the new instance needs before anything is deleted: orchestrator name and `Tags` (`OrchestrationMetadata`; the isolated client does not expose the version, so the host's default version applies), and the input (body, or the `ExecutionStarted` row's `Input`, with `InputBlobName` handled; fall back to the Instances row).
2. `PurgeInstanceAsync(instanceId)`. `Failed` is a terminal state, so the host's purge precondition holds; the status check in the validation is what keeps running instances out, and the host's own check is the safety net behind it. The purge deletes all History rows for the partition (all generations), the Instances row and the instance's large-message blobs.
3. `ScheduleNewOrchestrationInstanceAsync(name, input, new StartOrchestrationOptions(instanceId) { Version, Tags })`. Pass the input as a `JsonNode`, as `DfmStartNewOrchestrationFunction` does, so it is not double-encoded.
4. Return `200 { "instanceId": "abc", "purged": true, "input": <the input used> }`.

Failure window: if step 3 fails after step 2 succeeded, the instance is gone. Return 500 with the captured name and input in the body so the caller can re-create it through the existing start endpoint, and log at Error. Child sub-orchestrations of the old execution (`{oldExecutionId}:n`) are not purged; the client SDK exposes a recursive purge option but the host ignores it in the version read, so an optional follow-up is to find children through a `PartitionKey ge '{executionId}:'` range on the Instances table and purge them one by one.

### 4.3 `POST orchestrations('{instanceId}')/input-events/update-input-and-rewind` (Write)

Request: `{ "sequenceNumber": 27, "input": <any JSON value>, "reason": "optional rewind reason" }`.

Validation: not an entity; instance exists; status is `Failed` (409, the host would refuse the rewind anyway); `storageSupports.updateInput` (400); `sequenceNumber` identifies the last input-bearing event of the current execution (409 if it is not, which also catches "history changed since you looked"); input within the inline limit (413).

Steps:

1. `UpdateHistoryEventInputRoutine(instanceId, sequenceNumber, inputJson)` (section 6.2). For `ExecutionStarted` it also updates the Instances row's `Input`, so the details page and the initial-input download stay consistent.
2. `RewindInstanceAsync(instanceId, reason ?? "Rewound by Durable Functions Monitor after an input update")`.
3. Return `200 { "sequenceNumber": 27, "inputUpdated": true, "rewound": true }`.

If step 2 fails, the input stays updated. Return 409 or 500 with a message saying so; the existing Rewind button can be used to retry.

What the user sees afterwards is the normal rewind picture: the failed steps re-run, `TaskScheduled`/`TaskFailed` rows show as `GenericEvent` "Rewound: ...", and the orchestrator's code after the event computes its activity inputs from the edited payload during replay. Steps that already completed are not re-run and keep their results.

### 4.4 `POST orchestrations('{instanceId}')/input-events/replay` (Dangerous recommended)

Request: `{ "sequenceNumber": 27, "input": <any JSON value, optional>, "terminateIfRunning": false }`. When `input` is omitted the event's stored input is raised again unchanged.

Validation: not an entity; instance exists; `storageSupports.truncateHistory` (400); `sequenceNumber` is the last `EventRaised` of the current execution (409; `ExecutionStarted` gets "use restart-in-place"); status terminal or `terminateIfRunning` (409); the stored input must be readable (500 otherwise, nothing touched). The storage routine itself refuses with 409 when work scheduled before the event has no completion recorded before it (section 6.3, step 4).

Steps:

1. Read the event row now (name and stored input, `InputBlobName` handled) and keep the original input for the re-raise when the body has none. Parse the stored string with `JsonNode.Parse` before passing it on, so it is not double-encoded.
2. If not terminal and `terminateIfRunning`: `TerminateInstanceAsync(instanceId, "Replay by DfMon")`, then `WaitForInstanceCompletionAsync` with a 30 second cancellation token. Still not terminal after that: 409, nothing else has been touched.
3. `TruncateHistoryRoutine(instanceId, sequenceNumber)` (section 6.3): delete the rows from the cut point onward, close the last kept episode, delete offloaded blobs of deleted rows, and reopen the Instances row as `Running` with `Output` and `CompletedTime` removed.
4. `RaiseEventAsync(instanceId, eventName, input)`. The host's status check now passes, and the engine appends the new `EventRaised` row at the next sequence number, replays the kept history, and the orchestrator continues from its `WaitForExternalEvent`.
5. Return `200 { "sequenceNumber": 27, "eventName": "RequestTrackerApproval", "deletedRows": 14, "raised": true }`.

If step 4 fails after step 3, the instance is reopened but waiting. Return 500 saying the event can be raised manually with the existing Raise Event dialog (the response includes `eventName` and the input that should be sent).

## 5. Core changes, file by file

| File | Change |
|---|---|
| `Common/Auth.cs` | `OperationKind.Dangerous`; flag check in `ValidateIdentityAsync`. |
| `Common/DfmSettings.cs`, `Common/Globals.cs` | `DangerousOperationsEnabled`; `DFM_DANGEROUS_OPERATIONS_ENABLED`; optional `DfmUserNameContextValue`. |
| `Common/ExtensionMethods.cs` | Optional: store the user name in `context.Items` for audit logging. |
| `Functions/About.cs` | `DurableFunctionsMonitor.DangerousOperations` permission. |
| `Common/OrchestrationHistory.cs` | `HistoryEvent.SequenceNumber` (`long?`, from `RowKey` parsed as hex; for merged task rows use the `TaskScheduled` row's key). `HistoryEntity.InputBlobName` and the other `*BlobName` columns, resolved on read. Add `SequenceNumber` to `ToHistoryEvent(JToken)`. |
| `Common/InputEvents.cs` (new) | The response model and the pure eligibility computation from section 4.1. No storage access, fully unit-testable. |
| `Common/OrchestrationHistoryEditor.cs` (new) | Azure Storage implementations: `ReadEventInputAsync`, `UpdateEventInputAsync`, `TruncateHistoryAsync`, `ReopenInstanceAsync`, blob helpers (download by name or URL, delete by name). |
| `Common/TableClient.cs` | `ITableClient` additions: `UpsertEntityAsync(table, entity)`, `DeleteEntitiesAsync(table, entities)` (transaction batches of up to 100 within one partition), and `MergeEntityAsync(table, entity, etag)` if the optional sentinel touch is kept. Keep `MockedTableClient` usable by the unit tests. |
| `Common/DfmExtensionPoints.cs` | Three new routines, defaulting to the Azure Storage implementations: `GetHistoryEventInputRoutine` `(DurableTaskClient, connEnvVar, hubName, instanceId, long sequenceNumber) => Task<string>` (resolves payloads kept outside the history record; null means `HistoryEvent.Input` is always complete), `UpdateHistoryEventInputRoutine` `(..., long sequenceNumber, string inputJson) => Task` and `TruncateHistoryRoutine` `(..., long fromSequenceNumber) => Task<int>` (rows deleted). A null editing routine means "not supported by this storage provider". |
| `Functions/InputEvents.cs` (new) | The four functions from section 4. |
| `Functions/Orchestration.cs` | Extract the blob download from `DownloadFieldValue` into a shared helper (URL check, container/blob split, gzip) so the editor can reuse it. No behaviour change. |
| `durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs` | Select `h.SequenceNumber` and map it, so the read endpoint works; set the two new routines to null until section 7 is done. |
| `durablefunctionsmonitor.dotnetisolated.netherite/ExtensionMethods.cs` | Set the two new routines to null. |
| `README.md` | Document the flag and the three operations, with the warnings from section 8. |

## 6. Azure Storage routines in detail

### 6.1 Reading

Row lookup by sequence number: `GetEntityAsync($"{hub}History", instanceId, sequenceNumber.ToString("X16"))`, then check that the row's `ExecutionId` equals the Instances row's `ExecutionId` (404 otherwise, the row belongs to an older generation).

Input resolution, used by the read endpoint, restart in place and replay: if the row has `InputBlobName`, download `{hub}-largemessages/{InputBlobName}` through the authenticated `BlobServiceClient` and gunzip it; otherwise take `Input`. For the Instances row, `Input` can be inline JSON or a blob URL; the URL form goes through the existing URL check and download. One special case: a URL ending in `ExecutionStarted.json.gz` is a whole queue-message envelope, and the input is the `TaskMessage.Event.Input` field inside it.

### 6.2 `UpdateEventInputAsync(instanceId, sequenceNumber, inputJson)`

1. Load the row and verify the execution as above; verify `EventType` is `EventRaised` or `ExecutionStarted`.
2. v1 limit: if `Encoding.Unicode.GetByteCount(inputJson) > 60 * 1024`, throw a typed exception that the function turns into 413. The engine would have offloaded a payload of that size; writing it inline would break the 64 KB property limit. Supporting large edited payloads means uploading a gzip blob named after the row and setting `InputBlobName`, which is a contained follow-up.
3. Set `Input = inputJson`. If `InputBlobName` exists, remove the property and remember the blob name.
4. `ReplaceEntityAsync` with the row's ETag (drops the removed column; a concurrent change yields 412, surfaced as 409).
5. Delete the old blob, best effort.
6. If the row is `ExecutionStarted`, load the Instances row, set `Input = inputJson`, remove `InputBlobName` if present, replace with ETag.

The rewind that follows reads the row through the engine's normal path (`DecompressLargeEntityProperties` only looks at `*BlobName` columns), so the inline value is picked up unchanged.

### 6.3 `TruncateHistoryAsync(instanceId, fromSequenceNumber)`

Let `S` be the sequence number of the target `EventRaised` row and `X = X16(S)`.

1. Read the Instances row (ETag, `ExecutionId`, `RuntimeStatus`) and the target row; verify it is an `EventRaised` of the current execution.
2. Choose the cut point `C`. If row `S-1` is `OrchestratorStarted` (the event opened its episode), `C = S-1`, so the dangling episode opener goes too. Otherwise `C = S`.
3. Query the rows to delete: `PartitionKey eq {instanceId} and RowKey ge {X16(C)} and RowKey ne 'sentinel' and ExecutionId eq {executionId}`, built with `Azure.Data.Tables.TableClient.CreateQueryFilter` so the values are escaped, ordered by `RowKey` descending. Collect every `*BlobName` value from those rows. Older-generation rows beyond the current execution are left alone; both readers already ignore them, and the engine's upsert-replace overwrites them as the history grows again.
4. Refuse (409) when the kept rows contain a `TaskScheduled` or `SubOrchestrationInstanceCreated` whose completion (`TaskCompleted`, `TaskFailed`, `SubOrchestrationInstanceCompleted` or `SubOrchestrationInstanceFailed` with the same id) is not among the kept rows, for example because the event arrived while a `Task.WhenAll` activity was still running. After a replay the orchestrator would wait for that completion forever. Timers are exempt: a timer the orchestrator no longer awaits can fire or not without consequence.
5. First write, conditional: replace the Instances row (`LastUpdatedTime = now`) with the ETag from step 1. A 412 means someone else is working on the instance (a rewind, a restart), so stop with 409 before anything is deleted. Re-read the row for the ETag the reopen needs.
6. Write the sentinel back unchanged, with its ETag. That bumps the ETag the engine checkpoints against, so a worker that still holds a session for this instance fails its next checkpoint as split-brain instead of writing stale rows over the edit.
7. Delete the rows in transaction batches of up to 100 (same partition), highest key first, with the remainder in the first batch so that the last batch is a full one. The target row and the episode opener it may drag along are deleted last, together, so an interrupted run leaves a contiguous prefix that still contains the target, and the same request can simply be retried.
8. If row `C-1` is not `OrchestratorCompleted` (the event arrived mid-batch, after other events of the same episode), upsert an `OrchestratorCompleted` row at `C`: `EventType = OrchestratorCompleted`, `EventId = -1`, `IsPlayed = true`, `_Timestamp = now`, `ExecutionId = executionId`. The kept history is then a sequence of complete episodes, and the engine's next checkpoint starts at `C+1`.
9. Delete the collected blobs, best effort.
10. Reopen the instance: on the Instances row set `RuntimeStatus = "Running"`, `LastUpdatedTime = now`, remove `Output` and `CompletedTime`, keep everything else, and replace with the ETag from step 5. On a 412, re-read once and retry only if the instance is still terminal; otherwise 409.
11. Return the number of deleted rows.

Worked example on the history in the request: rows `... OrchestratorStarted (k) | EventRaised RequestTrackerApproval (k+1) | SubOrchestrationInstanceCreated 4 | OrchestratorCompleted | ... | ExecutionCompleted | OrchestratorCompleted`. `S = k+1`, row `k` is `OrchestratorStarted`, so `C = k`; every row from `k` on is deleted, row `k-1` is the previous episode's `OrchestratorCompleted`, so nothing is added. After the re-raise the engine writes `OrchestratorStarted (k) | EventRaised (k+1) | SubOrchestrationInstanceCreated 4 (k+2) | ...`, and child `{executionId}:4` starts a new generation.

## 7. Other storage providers

- MSSQL: the read endpoint works once `SequenceNumber` is mapped (`dt.History.SequenceNumber` is already in the query's `ORDER BY`). Restart in place needs no storage access beyond the history read, so it works too. Update and replay need SQL equivalents: update `dt.Payloads.Text` for the event's `DataPayloadID` (and `dt.Instances.InputText`/payload for `ExecutionStarted`); delete `dt.History` rows with `SequenceNumber >= C` for the current execution together with their orphaned payloads, and set `dt.Instances.RuntimeStatus = 'Running'`, `CompletedTime = NULL`, `OutputPayloadID = NULL`. Defer until the Azure Storage version has been exercised; until then the package sets all three routines to null and the editing endpoints answer 400.
- Netherite: history lives in FASTER storage and cannot be edited from outside; all three routines stay null. Restart in place still works through the client API.

## 8. Risks and mitigations

- R1, stale messages after replay. Activity results or timer messages from the previous run carry the same `ExecutionId` and would be accepted by the replayed instance; a `TaskCompleted` for scheduled ID 5 could complete the re-scheduled task 5 with the old result. Mitigation: restart in place requires a `Failed` instance, replay requires a terminal one, `terminateIfRunning` (replay only) is opt-in, and the docs recommend waiting for in-flight activities to finish before replaying an instance that was just terminated. Peeking the work-item queue for messages of this instance is possible but out of scope.
- R2, side effects run twice. Replay re-executes activities and re-creates sub-orchestrations after the event. That is the requested behaviour; the Dangerous kind and the flag exist to make it a deliberate deployment choice.
- R3, control-flow changes. After update-and-rewind the orchestrator replays with the edited input. If the edit changes which activities the code calls before the failed step, the engine reports non-determinism and the instance fails again; the answer is Replay. Same for orchestrator code that changed since the instance ran.
- R4, failures inside a sub-orchestration. Rewind re-runs the child with the child's original input; the parent's edited input does not reach it. Use Replay to re-create the child with new input.
- R5, sub-orchestrations as targets. Restart in place is refused for them (the parent would never hear back). Replay and update-and-rewind are allowed with a warning; the child's completion message still reaches a parent that is waiting.
- R6, extended sessions. An in-memory session that survived while the instance was edited would checkpoint over the edit. Terminal instances have no live session, and the sentinel rewrite in 6.3 step 6 turns any survivor's next checkpoint into a split-brain failure rather than a corrupted history.
- R7, purge-then-schedule window in restart in place. Covered in 4.2: the response carries what is needed to re-create the instance by hand.
- R8, large payloads. v1 rejects edited inputs over the inline limit; stored large inputs are still read correctly. Replay and restart are unaffected because the engine writes those payloads itself.
- R9, concurrency. Every write re-validates status and "is still the last input event" and uses ETags on the rows it replaces; replay additionally makes a conditional write on the Instances row before its first delete. A concurrent change is a 409, never a silent overwrite.
- R10, work still running when the event arrived. A `TaskScheduled` or `SubOrchestrationInstanceCreated` before the cut whose completion is not before the cut would leave the replayed orchestrator waiting forever, so replay refuses those instances (6.3 step 4). Update-input-and-rewind and restart-in-place remain available for them.
- R11, degraded reads on destructive paths. The read endpoint falls back to the history record when an offloaded payload cannot be downloaded, and says so in `inputError`. Restart in place and replay never fall back: they stop with 500 and touch nothing, because their next step deletes the payload. Likewise, restart in place stops when it cannot determine whether the instance is a sub-orchestration, instead of assuming it is not.

## 9. Tests

Unit (`tests/durablefunctionsmonitor.dotnetisolated.core.tests`, MSTest and Moq, no storage):

- `AuthTests`: the cases in 3.2, plus `DfmSettings` parsing of the flag (unset, empty, `true`, `TRUE`, `false`).
- `RouteTests`: every pair of HTTP routes in the assembly, checked the way the host resolves them (first match, function-name order): a route that also accepts another function's paths must belong to the function that sorts first.
- `InputEventsTests`: the eligibility matrix over synthetic `HistoryEvent[]` and statuses: no `EventRaised`; several `EventRaised` (only the last gets operations); Failed vs Completed vs Running (restart in place only on Failed; `requiresTerminate` only on replay); flag off; capability flags off; sub-orchestration warning.
- `OrchestrationHistoryTests`: `SequenceNumber` parsed from `RowKey` (`0000000000000011` gives 17, `sentinel` gives null) and carried through the merged task rows.
- `InputEventsFunctionTests` with a mocked `DurableTaskClient` and a mocked `ITableClient`: status codes for each validation branch, and the ordering guarantees (terminate before purge, truncate before raise, input updated before rewind).

Integration (`tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests`, Azurite, already wired in CI through `DFM_TEST_REQUIRE_STORAGE`):

- Seed a synthetic History and Instances layout that mimics the engine (X16 row keys, sentinel, `ExecutionId`, `_Timestamp`, episode brackets, an older-generation tail) and drive the editor: update inline input; update a row with `InputBlobName` (blob removed, column dropped); `ExecutionStarted` update patches the Instances row; truncate at an episode opener; truncate mid-episode (synthetic `OrchestratorCompleted` added); older-generation rows untouched; blobs of deleted rows removed; Instances row reopened with `Output` and `CompletedTime` gone; ETag conflict surfaces as 409.

Real host (manual checklist, no harness in this repo): run the standalone `durablefunctionsmonitor.dotnetisolated` host next to a sample app shaped like the request (orchestrator, an activity that fails on bad event data, sub-orchestrations, an external event) and verify: update-and-rewind re-runs only the failed activity with the edited payload; replay re-runs everything after the event and child `{executionId}:4` starts a new generation with the old rows overwritten; restart in place produces a new `ExecutionId` with a clean history; a replayed instance that had in-flight activities shows the R1 behaviour so the docs stay honest.

## 10. Delivery phases

1. Flag, `OperationKind.Dangerous`, `About` permission, auth tests. Small, independent, unblocks everything else.
2. `HistoryEvent.SequenceNumber`, `*BlobName` resolution on read, the eligibility model and the read endpoint. Small to medium.
3. Restart in place. Small; client APIs only.
4. Update input and rewind. Medium; first storage write, plus the shared blob helper.
5. Replay. Medium to large; truncation, reopen, re-raise, Azurite tests, real-host checklist.
6. README, MSSQL routines (optional), then the UI in a separate piece of work.

## 11. Contract notes for the future UI

- Show the buttons on the history rows whose `eventType` is `ExecutionStarted` or `EventRaised`, driven by `GET input-events`; `operations[*].allowed`, `reason`, `requiresTerminate` and `warning` are meant to be rendered as-is.
- Gate the two dangerous buttons on `permissions` containing `DurableFunctionsMonitor.DangerousOperations` from `/about`.
- Send `sequenceNumber` back exactly as received; it doubles as the concurrency token.
- After any of the three operations, reload details and history; after restart in place the `ExecutionId` changes and the history is short again.

## 12. Assumptions to confirm

1. Replay requires a terminal instance unless `terminateIfRunning` is sent. Restart in place is limited to `Failed` instances, as requested, so a Completed or Terminated instance cannot be restarted in place even though the purge itself would allow it.
2. Replay is marked `Dangerous`. Flip the attribute if it should be `Write`.
3. Update-and-rewind is limited to the last input-bearing event. Allowing any `EventRaised` is the same code path; only the eligibility rule changes.
4. v1 rejects edited inputs above the engine's 60 KB inline limit with 413.
5. MSSQL and Netherite return 400 for update and replay until they get their own routines.
6. Endpoint names: `input-events`, `input-events/restart-in-place`, `input-events/update-input-and-rewind`, `input-events/replay`.
