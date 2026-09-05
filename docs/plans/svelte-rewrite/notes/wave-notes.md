# Cross-task notes from landed waves

Facts discovered while implementing tasks that later tasks must know. Read this before any task that touches the areas named. Append a section per wave; never rewrite history.

## Wave 1 (E0-S1-T1, B0-S1-T1, B0-S3-T1, B0-S4-T1, B0-S4-T2, B1-S1-T2, B2-S1-T1, B3-S1-T1, B4-S1-T1, B5-S1-T2)

### UI toolchain (E0-S1-T1)
- **Resolved after wave 1:** the reference Node is now 22.23.2, pinned in the repo-root `.node-version` (fnm resolves `package.json` `engines` `>=22` to the highest installed Node otherwise, which picked 24.14.1 and failed the jsdom `^24.15.0` range). `.npmrc` is back to `engine-strict=true`; `npm ci` passes. History: the README pinned `jsdom` 30.0.1 (`engines` `^22.22.2 || ^24.15.0 || >=26.0.0`) while the toolchain was Node 22.18.0, so E0-S1-T1 had shipped with `engine-strict=false`.
- Unlisted dev tooling was pinned at: eslint 10.10.0, eslint-plugin-svelte 3.23.0, typescript-eslint 8.69.0, prettier 3.9.6, prettier-plugin-svelte 4.1.1, @testing-library/jest-dom 7.0.1, ncp 2.0.0, rimraf 6.1.3.
- `index.html` and `vite.config.ts` exist as minimal placeholders; **E0-S1-T2 overwrites both wholesale** from contracts §2. Two things T2 must keep: `test.passWithNoTests: true` (the first real test only arrives in E0-S1-T3, so `npm test` would otherwise fail) and `defineConfig` imported from `vitest/config` (or a `/// <reference types="vitest/config" />` line): the contracts §2 snippet imports from `vite`, which makes the `test` key a TypeScript error.
- No `svelte.config.js` (not in any Files line; vite-plugin-svelte prints an informational "no Svelte config found" line). No `@types/node` in the tree; nothing compiles `tsconfig.node.json`.
- `eslint.config.js` uses `ts.configs.recommended` + `svelte.configs.recommended` only (no `@eslint/js`, no `globals`, no type-aware linting).
- `src/styles/dfm-ui.css` is a 0-byte placeholder (E1-S1-T1 fills it); `src/app.css` holds only a comment until E0-S1-T3 adds the two `@import` lines; `src/main.ts` does not import `app.css` yet (E0-S1-T3 step 4).
- `public/` does not exist yet (E0-S1-T2 creates it); `tests/e2e/seed` and `tests/e2e/fixtures` do not exist yet (E3 creates them).

### Table Storage projection (B1-S1-T2)
- Contrary to the plan text, a `$select` projection against Azure Table Storage / Azurite does **not** return `PartitionKey`/`RowKey` unless they are in the select list (proved by a failing test). `ITableClient.QueryAsync(tableName, filter, select, maxRows, ct)` therefore always unions `PartitionKey` and `RowKey` into the select list, so callers may pass `select = ["Name","RuntimeStatus","CreatedTime","LastUpdatedTime","CompletedTime"]` and still read `row.PartitionKey` as the instance id. Non-selected columns (Input, Output, CustomStatus) are still absent.
- `maxPerPage` is `Math.Min(1000, maxRows + 1)`; `maxRows < 1` throws `ArgumentOutOfRangeException`. The result carries `(rows, truncated)`; B1-S2 maps those to `scanned`/`partial`.
- Nothing calls `QueryAsync` yet; the first caller is B1-S2-T2 (`AzureStorageAggregations.GetStatsAsync`).

### Extension points and aggregation models (B0-S1-T1)
- Routine signatures on `DfmExtensionPoints` (all `null` by default): `GetStatsRoutine: Func<DurableTaskClient, string, string, StatsQuery, CancellationToken, Task<StatsResult>>`, `GetFailuresRoutine: Func<DurableTaskClient, string, string, FailuresQuery, CancellationToken, Task<FailuresResult>>`, `GetChildrenRoutine: Func<DurableTaskClient, string, string, string, Task<ChildrenResult>>`, `GetEpisodeMarkersRoutine: Func<DurableTaskClient, string, string, string, Task<IReadOnlyList<EpisodeMarker>>>`, `GetInstanceRowInfoRoutine: Func<DurableTaskClient, string, string, string, Task<InstanceRowInfo>>`, `GetStorageHealthRoutine: Func<string, string, bool, string, CancellationToken, Task<StorageHealthResult>>`, `WriteAuditRecordRoutine: Func<string, string, AuditRecord, Task>`, `ReadAuditRecordsRoutine: Func<string, string, AuditQuery, Task<AuditPage>>`; plus `ProviderName` (`"AzureStorage"`, MSSQL sets `"MsSql"`, Netherite `"Netherite"`).
- The models in `Common/AggregationModels.cs` are plain public classes with get/set (codebase DTO style), collections default to empty lists.
- **Casing trap:** `Globals.SerializerSettings` camel-cases dictionary keys. `StatsResult.Totals` and `StatsBin.Counts` are typed `StatusCounts` (a `Dictionary<string,int>` subclass with `[JsonDictionary(NamingStrategyType = typeof(DefaultNamingStrategy))]`) so keys like `Completed` stay PascalCase next to `all`/`entities`. B1 must keep using `StatusCounts`, never a raw `Dictionary`, or the keys silently become `completed`.
- Two summary types: `StuckSummary { Count, OldestLastUpdatedAt, SampleIds }` (for `stats.stuck` and `stats.suspended`) and `PendingSummary { Count, OldestCreatedAt, SampleIds }` (`stats.oldestPending`).
- `ChildInstance.RuntimeStatus` is `string` (raw row text, never throws on unknown values); B1-S3-T1 writes the PascalCase status name verbatim.
- `StatsQuery`/`FailuresQuery`/`AuditQuery` carry a `[JsonIgnore] CacheKey` that rounds From/To down to the minute (the "normalised query" of B1-S2-T3). Defaults on the query objects: `Bins` 48, `StuckAfterMinutes` 60, `PendingAfterMinutes` 10, `AuditQuery.Top` 100.
- `AuditRecord.Route` is an extra stored field; B5-S3-T1 must not return it in `AuditRow`. `StorageHealthResult.Provider`/`AccountName` are settable for B4-S1-T3.
- Dates are `DateTimeOffset(?)` serialised as `yyyy-MM-ddTHH:mm:ssZ`; producers must assign UTC values; nullable dates render as JSON `null` with the key always present.
- Test helper worth reusing: `JObject.Parse` turns ISO strings into DateTime tokens; serialisation assertions in `ExtensionPointsTests` go through a `SerializeAsDfMonWould` helper that loads with `DateParseHandling.None`.

### Other
- `AuditOperations.FromRequest(method, absolutePath, action) -> (Operation, Dangerous, InstanceId)` (B5-S1-T2) extracts the instance id by regex on the still-encoded `orchestrations('{id}')` and URL-decodes it afterwards.
- `ServeStatics` (B0-S4-T1) sends `Cache-Control: public, max-age=31536000, immutable` for every `static/*` file and `no-cache` for `index.html`.
- `Globals.GetQueueServiceClient(connStringName)` (B4-S1-T1) mirrors `GetBlobServiceClient`; identity path uses `{conn}__queueServiceUri` then `{conn}__accountName`.
