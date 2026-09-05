# B2 · /spans

Goal: one tested C# model that turns an instance's history into timeline spans and "where the time went" totals, replacing the client-side Gantt merging of the React app.

Prerequisites: B0. Read contracts §6 (`SpansResponse`, `Span`), `dfm-design-system.md` §8 "Timeline swimlane", `dfm-rewrite-plan.md` §5 notes; `Common/OrchestrationHistory.cs` (how rows are merged), `docs/plans/input-events-restart-rewind-replay.md` §2 (episode markers), React `states/details-view/GanttDiagramTabState.ts`.

Exit criteria: `GET orchestrations('{id}')/spans` returns spans for the seeded running instance that match the mockup lanes, totals sum correctly, and the pure builder has table-driven tests for every rule.

### B2-S1 History enrichment

#### B2-S1-T1 TimerId and FireAt on history events
Files: `Common/OrchestrationHistory.cs`, `tests/…core.tests/HistorySequenceNumberTests.cs` (extend)
Depends: none
Do:
1. `HistoryEntity` maps `TimerId` (`int?`) and `FireAt` (`DateTimeOffset?`) columns; `HistoryEvent` gains `TimerId` and `FireAt` (nullable). `ToHistoryEvent` copies them; the MSSQL routine leaves them null (its query has no such columns); the JSON serialisation of history includes them (camelCase is not applied to history: `HistorySerializerSettings` keeps PascalCase, so the UI reads `TimerId`).
Accept:
- [ ] Mocked table rows with `TimerId 3` and `FireAt` produce events carrying both.
Test: as above.

#### B2-S1-T2 Episode markers and instance row info routines
Files: `Common/AzureStorageAggregations.cs` (extend), `Common/DfmExtensionPoints.cs` (defaults), `durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs`, `tests/…integrationtests/EpisodeMarkersTests.cs`
Depends: B0-S1-T1
Do:
1. `GetEpisodeMarkersAsync`: query `{hub}History` with `PartitionKey eq {id} and ExecutionId eq {executionId}` and `select EventType, _Timestamp, RowKey`, keep `OrchestratorStarted`/`OrchestratorCompleted` rows in RowKey order, pair them into `EpisodeMarker { Start, End }` (an unmatched `OrchestratorStarted` at the end is an open episode with `End = null`). MSSQL: `SELECT EventType, Timestamp FROM [{schema}].History WHERE InstanceID=@id AND TaskHub=@hub AND EventType IN ('OrchestratorStarted','OrchestratorCompleted') ORDER BY SequenceNumber`. Netherite: `null`.
2. `GetInstanceRowInfoAsync`: Azure Storage reads the Instances row → `InstanceRowInfo { ExecutionId, Generation (int?), HistoryBytesEstimate = null }`. MSSQL: `ExecutionID` and `Generation` from `[{schema}].Instances`. Netherite: `null`.
3. Set the Azure Storage defaults in the `DfmExtensionPoints` constructor.
Accept:
- [ ] Azurite: the `SeedFailedHistoryAsync` layout yields 5 episodes, the last one open.
Test: as above.

### B2-S2 Span builder

#### B2-S2-T1 SpanBuilder (pure)
Files: `Common/SpanBuilder.cs`, `tests/…core.tests/SpanBuilderTests.cs`
Depends: B2-S1-T1
Do:
1. `SpanBuilder.Build(IReadOnlyList<HistoryEvent> history, IReadOnlyList<EpisodeMarker> markers /* may be null */, OrchestrationRuntimeStatus status, DateTimeOffset now)` → `SpansResult` (`Spans`, `Totals`, `ExecutionStartedAt`, `ExecutionEndedAt`).
2. Rules (history as DfMon's reader returns it: scheduled tasks are merged with their completion row, so a `TaskCompleted`/`TaskFailed` row carries `ScheduledTime` and `DurationInMs`; an unmatched `TaskScheduled` row is still running):
   - `activity`: `TaskCompleted` → `start = ScheduledTime`, `end = Timestamp`, `status completed`; `TaskFailed` → `failed`; `TaskScheduled` (unmatched) → `start = Timestamp`, `end = null`, `running`. `attempt` = 1 + number of earlier spans with the same `Name` and kind. `sequenceNumbers` = `[SequenceNumber]`.
   - `subOrchestration`: `SubOrchestrationInstanceCompleted/Failed/Created` likewise, with `subOrchestrationId = SubOrchestrationId`.
   - `timer`: `TimerCreated` (start = `Timestamp`) paired with the `TimerFired` whose `TimerId == created.EventId` (end = fired `Timestamp`, `status fired`); without `TimerId` (MSSQL) pair FIFO; unpaired `TimerCreated` → `end = FireAt ?? null`, `status running` when `FireAt` is in the future.
   - `eventWait` + `externalEvent`: each `EventRaised` row closes a wait span from the previous history row's `Timestamp` (or the execution start) to the `EventRaised` timestamp, `name = EventRaised.Name`, `status waiting`; the `EventRaised` itself is a zero-length `externalEvent` span `status raised`. When the instance is not terminal and the last history row is not an open activity/sub-orchestration/timer, add an open `eventWait` span (`name = null`, `end = null`) from the last row's timestamp.
   - `orchestrator`: one span per episode marker (`status completed`; open episode `running`); `null` markers → no orchestrator spans and `orchestratorMs = null`.
   - `ExecutionStartedAt` = the last `ExecutionStarted` timestamp (current execution only; ignore rows before it, like `InputEventEligibility`); `ExecutionEndedAt` = the `ExecutionCompleted`/`ExecutionTerminated`/`ExecutionFailed` timestamp when terminal.
   - Totals: sum of durations per kind (open spans count until `now`); `totalMs = (ExecutionEndedAt ?? now) - ExecutionStartedAt`.
   - Span ids: `{kind}:{sequenceNumber ?? index}`; retries keep the same `name`.
3. Robustness: rows with missing timestamps are skipped; `ScheduledTime` after `Timestamp` clamps to zero duration; more than 5,000 rows → aggregate consecutive spans of the same name and kind that start within 500 ms into one span with `attempt` = count (the React `MaxEventsBeforeStartAggregating` rule).
Accept:
- [ ] Table-driven tests: the mockup history (`ScreenInstance.dc.html` L311–L325, encoded as `HistoryEvent`s with `ScheduledTime`/`DurationInMs` on merged rows and `TimerId`) yields nine spans matching L301–L309 (kinds, names, attempts, statuses) and totals `activities ≈ 9.1 s` order of magnitude; timers paired by id and FIFO; open wait for a running instance; markers null → `orchestratorMs null`; 6,000 rows aggregate.
Test: as above.

### B2-S3 Endpoint

Note (B2-S2-T1, landed 2026-09-05): the mockup lane `ship` (ScreenInstance.dc.html L308, "wait ShipmentConfirmed" running concurrently with the `sub` sub-orchestration) is not derivable from history: an orchestration waiting for an external event leaves no history row until the event is raised, and the plan rule adds an open `eventWait` span only when the last row is not an open activity, sub-orchestration or timer. The builder therefore yields 8 history spans + 4 orchestrator spans for the mockup history; the table-driven test asserts that list and documents the missing lane. Spans serialise `start`/`end`/`executionStartedAt`/`executionEndedAt` with millisecond precision through a converter declared in `SpanBuilder.cs`; B2-S3-T1 applies the same converter to `now`.

#### B2-S3-T1 GET orchestrations('{id}')/spans
Files: `Functions/Spans.cs` (new), `tests/…core.tests/SpansFunctionTests.cs`
Depends: B2-S2-T1, B2-S1-T2
Do:
1. Read function. 400 for entity ids; 404 when the instance does not exist. Load history through `GetInstanceHistoryRoutine`, markers through `GetEpisodeMarkersRoutine` (null → null), row info through `GetInstanceRowInfoRoutine` (null → nulls), then `SpanBuilder.Build`. `historyRows = history.Count`, `historyBytes = sum of UTF-16 byte counts of Input/Result/Details strings` (an estimate; null when the history is empty), `largeMessageBlobs = null` (v1), `now`.
2. No caching (single instance; cheap); add `ETag` = details etag so the UI can skip re-render.
Accept:
- [ ] Unit test with mocked routines returns spans for the fixture; entity id → 400.
Test: as above.
