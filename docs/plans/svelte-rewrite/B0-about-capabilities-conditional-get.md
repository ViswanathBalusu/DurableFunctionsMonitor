# B0 · /about capabilities, conditional GET, statics

Goal: the backend tells the UI what it can do. `/about` gains `provider`, `readOnly`, `dangerousOperations`, `capabilities` and `templates`; the extension point slots for every later backend epic are declared once so the MSSQL and Netherite packages compile against them; details and history answer conditional GETs; `ServeStatics` serves fonts; details carry tags.

Prerequisites: none. Read contracts §6 (`About`), `.claude/skills/dfm-backend-endpoint/SKILL.md`, `durablefunctionsmonitor.dotnetisolated.core/Functions/About.cs`, `Common/DfmExtensionPoints.cs`, `Common/ExtensionMethods.cs`, `tests/durablefunctionsmonitor.dotnetisolated.core.tests/AboutTests.cs`.

Exit criteria: `dotnet test` green in both test projects; `/about` on the standalone host returns the new shape; the MSSQL and Netherite packages report their provider name and `false` for the routines they do not set.

### B0-S1 Extension point slots and provider name

#### B0-S1-T1 Declare the new routines on DfmExtensionPoints
Files: `durablefunctionsmonitor.dotnetisolated.core/Common/DfmExtensionPoints.cs`, `Common/AggregationModels.cs` (new), `durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs`, `durablefunctionsmonitor.dotnetisolated.netherite/ExtensionMethods.cs`
Depends: none
Do:
1. Add `public string ProviderName { get; set; } = "AzureStorage";` to `DfmExtensionPoints`. MSSQL sets `"MsSql"`, Netherite sets `"Netherite"` inside their `UseDurableFunctionsMonitorWith…` callbacks.
2. `AggregationModels.cs`: the C# records the later epics fill (`StatsQuery`, `StatsResult`, `FailuresQuery`, `FailuresResult`, `ChildrenResult`, `EpisodeMarker`, `StorageHealthResult`, `AuditRecord`, `AuditQuery`, `AuditPage`, `InstanceRowInfo`) with property names matching contracts §6 (camelCase comes from `Globals.SerializerSettings`). Keep them `public` (the provider packages construct them).
3. Routine slots, all `null` by default in this task (their epics set the Azure Storage defaults): `GetStatsRoutine: Func<DurableTaskClient, string connEnvVar, string hubName, StatsQuery, CancellationToken, Task<StatsResult>>`, `GetFailuresRoutine`, `GetChildrenRoutine: Func<DurableTaskClient, string, string, string instanceId, Task<ChildrenResult>>`, `GetEpisodeMarkersRoutine: Func<DurableTaskClient, string, string, string, Task<IReadOnlyList<EpisodeMarker>>>`, `GetInstanceRowInfoRoutine: Func<DurableTaskClient, string, string, string, Task<InstanceRowInfo>>`, `GetStorageHealthRoutine: Func<string connEnvVar, string hubName, bool counts, string instanceId, CancellationToken, Task<StorageHealthResult>>`, `WriteAuditRecordRoutine: Func<string connEnvVar, string hubName, AuditRecord, Task>`, `ReadAuditRecordsRoutine: Func<string connEnvVar, string hubName, AuditQuery, Task<AuditPage>>`. Document each with the same style as the existing properties (what it does, what null means).
Accept:
- [ ] Solution builds; MSSQL and Netherite packages compile and set `ProviderName`.
- [ ] `DfmExtensionPoints` unit test: defaults are `null` for every new slot and `ProviderName == "AzureStorage"`.
Test: `tests/…core.tests/ExtensionPointsTests.cs` (new).

### B0-S2 /about

#### B0-S2-T1 Capabilities model
Files: `Common/Capabilities.cs` (new), `tests/…core.tests/CapabilitiesTests.cs`
Depends: B0-S1-T1
Do:
1. `internal static class Capabilities { public static CapabilitySet Compute(DfmSettings settings, DfmExtensionPoints ext, DfmMode mode) }` returning a record with the exact property names of contracts §6: `stats = ext.GetStatsRoutine != null`, `failures = ext.GetFailuresRoutine != null`, `spans = true` (pure function over history; every provider has history), `children = ext.GetChildrenRoutine != null`, `batch = true`, `storageHealth = ext.GetStorageHealthRoutine != null`, `audit = settings.AuditEnabled && ext.ReadAuditRecordsRoutine != null` (B5 adds `AuditEnabled`; until then a constant `false` with a TODO naming B5-S1-T1), `entities = true` (B4 implements the endpoint through the client API; keep `false` until B4-S3-T1 flips it), `updateInput = ext.UpdateHistoryEventInputRoutine != null`, `truncateHistory = ext.TruncateHistoryRoutine != null`, `purgeHistory = true`, `purgeEntities = false`, `cleanEntityStorage = false`, `deleteTaskHub = false` (the isolated backend answers 400 for these three today: `PurgeHistory.cs`, `CleanEntityStorage.cs`, `DeleteTaskHub.cs`), `conditionalGet = true` (after B0-S3), `episodeMarkers = ext.GetEpisodeMarkersRoutine != null`.
2. Every flag is independent of `mode`; read-only is reported separately.
Accept:
- [ ] Tests cover Azure Storage defaults, MSSQL-like (null editing routines) and Netherite-like sets.
Test: as above.

#### B0-S2-T2 Extend the About function
Files: `Functions/About.cs`, `Common/CustomTemplates.cs` (add `GetTemplateSummaryAsync`), `tests/…core.tests/AboutTests.cs`
Depends: B0-S2-T1
Do:
1. Response adds: `provider = ext.ProviderName`, `readOnly = mode == DfmMode.ReadOnly`, `dangerousOperations = mode == Normal && settings.DangerousOperationsEnabled`, `capabilities = Capabilities.Compute(...)`, `templates = { functionMapAvailable, functionCount (count of top-level keys of the function map JSON's `functions` object, null when unavailable), liquidTabs (template names for entity type "" plus all entity-type-specific names, sorted, distinct), customMetaTag (custom meta tag code present) }` computed from the cached `CustomTemplates` tasks (they never throw).
2. Keep `accountName`, `hubName`, `version`, `permissions` unchanged.
Accept:
- [ ] `AboutTests` assert the new fields for Normal and ReadOnly modes, with and without the dangerous flag.
Test: as above.

### B0-S3 Conditional GET

#### B0-S3-T1 ETag on details and history
Files: `Functions/Orchestration.cs`, `Common/ConditionalGet.cs` (new), `tests/…core.tests/ConditionalGetTests.cs`
Depends: none
Do:
1. `ConditionalGet.ComputeETag(OrchestrationMetadata m)` → `W/"{m.LastUpdatedAt.UtcTicks}:{m.RuntimeStatus}"`. `ConditionalGet.TryNotModified(HttpRequestData req, string etag, out HttpResponseData response)`: when `If-None-Match` equals the etag, `response` is `304` with the `ETag` header and an empty body.
2. `DfmGetOrchestrationFunction`: compute the etag from the metadata, return 304 when it matches, otherwise add the `ETag` header to the JSON response. Entities: no etag (status is synthetic).
3. `DfmGetOrchestrationHistoryFunction`: call `durableClient.GetInstanceAsync(instanceId, false)` first (cheap); same etag; 304 when it matches and `$skip` is 0 and no `$filter` (paged or filtered requests are never conditional).
Accept:
- [ ] Unit tests with `FakeDurableTaskClient`: matching header → 304 with no body; different header → 200 with `ETag`.
Test: as above.

### B0-S4 Statics and details tags

#### B0-S4-T1 static/media in ServeStatics
Files: `Functions/ServeStatics.cs`, `tests/…core.tests/ServeStaticsTests.cs`
Depends: none
Do:
1. Add `static/media` to `FileMap` with a content type chosen by extension: `.woff2` → `font/woff2`, `.woff` → `font/woff`, `.svg` → `image/svg+xml; charset=UTF-8`, `.png` → `image/png`, else `application/octet-stream`. Keep the three-segment limit and the `Path.GetFileName` sanitising.
2. Add `Cache-Control: public, max-age=31536000, immutable` for `static/*` files (they are content-hashed) and `no-cache` for `index.html`.
Accept:
- [ ] Tests: `static/media/archivo.abc123.woff2` served with `font/woff2`; `static/media/../x` still cannot escape.
Test: as above.

#### B0-S4-T2 Tags on details
Files: `Common/DetailedOrchestrationStatus.cs`, `Common/DurableOrchestrationStatus.cs`, tests
Depends: none
Do:
1. `DurableOrchestrationStatus(OrchestrationMetadata)` copies `data.Tags` into `IReadOnlyDictionary<string,string> Tags` (null when empty). Serialised as `tags` on details; the list endpoint hides it (`ExpandedOrchestrationStatus` does not copy it) to keep payloads small.
Accept:
- [ ] Unit test: metadata with two tags serialises `tags` with both keys.
Test: as above.
