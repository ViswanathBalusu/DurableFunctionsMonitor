# B1 · /stats and /children

Goal: hub statistics for the Overview and Functions screens with one bounded Instances scan, cached; sub-orchestration lookup for the workspace.

Prerequisites: B0. Read contracts §6 (`StatsResponse`, `ChildrenResponse`), README D10, `dfm-rewrite-plan.md` §5; `Common/TableClient.cs`, `Common/OrchestrationHistory.cs`, `Functions/Orchestrations.cs`, `tests/…integrationtests/OrchestrationHistoryEditorTests.cs` (seeding pattern), `tests/…integrationtests/StorageEmulator.cs`.

Exit criteria: `GET /stats` and `GET orchestrations('{id}')/children` work on the standalone host against Azurite; `/about.capabilities.stats` and `.children` are true for Azure Storage, `children` true for MSSQL, both false for Netherite; unit and Azurite tests green.

### B1-S1 Cache and table query

#### B1-S1-T1 AggregationCache
Files: `Common/AggregationCache.cs`, `tests/…core.tests/AggregationCacheTests.cs`
Depends: B0-S1-T1
Do:
1. `internal static class AggregationCache { public static Task<T> GetOrAddAsync<T>(string key, TimeSpan ttl, Func<Task<T>> factory) }` over a `ConcurrentDictionary<string, CacheEntry>`; in-flight de-duplication (the stored value is the `Task<T>` itself), expiry by `DateTime.UtcNow`, faulted tasks are evicted immediately, a sweep of expired entries every 100 calls. Key format `"{endpoint}|{connEnvVar}|{hub}|{query}"`.
2. TTL from `DfmSettings.AggregationCacheSeconds` (new, default 30, env `DFM_AGGREGATION_CACHE_SECONDS`). Responses carry `cached: true` when served from the cache (the factory result is cloned with `cached = false` first time; simplest: the DTO has a settable `Cached` property and the function sets it based on whether the task was already present).
Accept:
- [ ] Two concurrent calls with the same key run the factory once; after the TTL the factory runs again; a throwing factory does not poison the key.
Test: as above.

#### B1-S1-T2 Projected, capped table query
Files: `Common/TableClient.cs`, `tests/…core.tests/TableClientTests.cs` (mock support), `tests/…integrationtests/TableClientTests.cs`
Depends: none
Do:
1. `ITableClient.QueryAsync(string tableName, string filter, IEnumerable<string> select, int maxRows, CancellationToken ct)` → `Task<(IReadOnlyList<TableEntity> rows, bool truncated)>`: uses `Query<TableEntity>(filter, maxPerPage: 1000, select, ct)` and stops enumerating after `maxRows` rows (`truncated = true` when more were available: read one extra row).
2. Update every `ITableClient` mock in the unit tests (Moq `Setup` for the new member is only needed where called).
Accept:
- [ ] Azurite test: 25 seeded rows, `maxRows 10` → 10 rows, `truncated true`; `select` limits properties (a non-selected column is absent).
Test: as above.

### B1-S2 Stats

#### B1-S2-T1 StatsAggregator (pure)
Files: `Common/StatsAggregator.cs`, `tests/…core.tests/StatsAggregatorTests.cs`
Depends: B0-S1-T1
Do:
1. Input rows: `InstanceRowLite { PartitionKey (instanceId), Name, RuntimeStatus, CreatedTime, LastUpdatedTime, CompletedTime? }` (an internal record built from `TableEntity` or SQL). `StatsAggregator.Aggregate(rows, StatsQuery q, DateTimeOffset now, bool truncated, int cap)` → `StatsResult`.
2. Rules: entity rows (`PartitionKey` matches `ExpandedOrchestrationStatus.EntityIdRegex`) count into `totals.entities` and `entitiesByName` (name = the `@name@` part) and nowhere else. `totals[status]` per `RuntimeStatus` string plus `all`. `bins`: `q.Bins` equal buckets between `from` and `to` on `CreatedTime`; rows outside are ignored. `byName`: per `Name`: `started` (all rows), `completed`, `failed`, `running` (Running+Pending+ContinuedAsNew+Suspended), `failureRate = failed / max(1, completed + failed)`, `p50Ms`/`p95Ms` over `CompletedTime - CreatedTime` of Completed and Failed rows (nearest-rank percentile; null when no terminal rows), `lastFailedAt` = max `LastUpdatedTime` among failed. Sorted by `started` desc. `stuck`: Running rows with `LastUpdatedTime < now - stuckAfterMinutes`, `oldestLastUpdatedAt`, first 10 ids. `oldestPending`: Pending rows with `CreatedTime < now - pendingAfterMinutes`. `suspended`: Suspended rows, oldest `LastUpdatedTime`, ids. `scanned = rows.Count`, `partial = truncated`, `cap`.
3. Defaults: `bins 48` (max 366), `stuckAfterMinutes 60`, `pendingAfterMinutes 10`; `from`/`to` required, `to - from` at most 92 days (400 otherwise).
Accept:
- [ ] Synthetic 40 rows across 4 names, 3 statuses and 2 entities produce the expected totals, bins, percentiles (assert p50/p95 against a hand-computed value), stuck and pending sets.
Test: as above.

#### B1-S2-T2 Azure Storage stats routine
Files: `Common/AzureStorageAggregations.cs` (new), `Common/DfmExtensionPoints.cs` (default), `tests/…integrationtests/StatsTests.cs`
Depends: B1-S1-T2, B1-S2-T1
Do:
1. `AzureStorageAggregations.GetStatsAsync(client, connEnvVar, hub, query, ct)`: filter `CreatedTime ge {from} and CreatedTime le {to}` built with `TableClient.CreateQueryFilter`, `select` = `Name, RuntimeStatus, CreatedTime, LastUpdatedTime, CompletedTime` (PartitionKey always comes back), `maxRows = settings cap` (`DfmSettings.StatsScanCap`, default 50000, env `DFM_STATS_CAP`), then `StatsAggregator.Aggregate`.
2. Set `extPoints.GetStatsRoutine` default to it in the `DfmExtensionPoints` constructor. Netherite sets it to `null`. MSSQL: leave the Azure Storage default? No: MSSQL has no Instances table in the storage account; set `null` in the MSSQL package (B1-S4-T1 adds the SQL version).
Accept:
- [ ] Azurite: seed 30 instance rows (mirror `SeedInstanceAsync`) and 2 entities; the routine returns totals 30 and entities 2; with cap 10 → `partial true, scanned 10`.
Test: as above.

#### B1-S2-T3 GET /stats function
Files: `Functions/Stats.cs` (new), `tests/…core.tests/StatsFunctionTests.cs`, `tests/…core.tests/AuthTests.cs` (read list)
Depends: B1-S1-T1, B1-S2-T2
Do:
1. `[Function(nameof(DfmGetStatsFunction))] [OperationKind(Kind = OperationKind.Read)]` route `Globals.ApiRoutePrefix + "/stats"`. Parse `from`, `to` (ISO, required, `DateTimeOffset.Parse` with invariant culture; 400 on failure or when `to <= from` or span > 92 days), `bins`, `stuckAfterMinutes`, `pendingAfterMinutes` (ints with defaults and bounds 1..366, 1..100000).
2. When `ExtensionPoints.GetStatsRoutine == null` → 400 "Hub statistics are not supported for this storage provider".
3. Wrap in `AggregationCache` with key from the normalised query (round `from`/`to` down to the minute so auto-refreshing clients hit the cache) and the settings TTL; set `elapsedMs`, `generatedAt`, `cached`.
4. Serialise with `req.ReturnJson`.
Accept:
- [ ] Unit tests: missing `from` → 400; provider null → 400; a fake routine is invoked once for two calls within the TTL.
- [ ] `AuthTests.AllModifyingFunctionsAreMarkedAsOperationKindWrite` still passes (Read function).
Test: as above.

#### B1-S2-T4 MSSQL stats (grouped SQL)
Files: `durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs`
Depends: B1-S2-T1
Do:
1. Optional for the first release; implement when time allows: one query over `[{schema}].Instances` filtered by `TaskHub` and `CreatedTime` between `from` and `to`, selecting `InstanceID, Name, RuntimeStatus, CreatedTime, LastUpdatedTime, CompletedTime`, `TOP (cap + 1)`, mapped to `InstanceRowLite` and passed through `StatsAggregator.Aggregate` (exact numbers within the cap; the SQL `GROUP BY` optimisation can come later). Set `extPoints.GetStatsRoutine` to it.
2. Until implemented: `GetStatsRoutine = null` (Overview shows its empty state on MSSQL).
Accept:
- [ ] Manual check against a SQL task hub, documented in the PR.
Test: manual (no SQL in CI).

### B1-S3 Children

#### B1-S3-T1 Azure Storage children routine and function
Files: `Common/AzureStorageAggregations.cs` (extend), `Functions/Children.cs` (new), `durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs`, `tests/…integrationtests/ChildrenTests.cs`, `tests/…core.tests/ChildrenFunctionTests.cs`
Depends: B1-S1-T2, B0-S1-T1
Do:
1. Azure Storage: read the parent's Instances row (`ExecutionId`), then query `{hub}Instances` with `PartitionKey ge '{executionId}:' and PartitionKey lt '{executionId};'` (`;` follows `:` in ASCII) with `select Name, RuntimeStatus, CreatedTime, LastUpdatedTime`, `maxRows 500`. Map to `ChildrenResult { children[], complete = false }` (explicit child ids cannot be found this way; the response says so).
2. MSSQL: `SELECT InstanceID, Name, RuntimeStatus, CreatedTime, LastUpdatedTime FROM [{schema}].Instances WHERE ParentInstanceID = @id AND TaskHub = @hub`, `complete = true`. Netherite: `null`.
3. `GET orchestrations('{instanceId}')/children` (Read): 400 for entity ids, 404 when the parent does not exist, 400 when the routine is null.
Accept:
- [ ] Azurite: parent with `ExecutionId exec-1` and children `exec-1:0`, `exec-1:1`, plus an unrelated `exec-1x:0` → exactly two children.
Test: as above.
