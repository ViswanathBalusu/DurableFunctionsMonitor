# E10 · Entities and Storage

Goal: `ScreenEntities.dc.html` (works without B4 through the entity filter of `/orchestrations`, better with `GET /entities`) and `ScreenStorage.dc.html` (Azure Storage only, needs B4 and `capabilities.storageHealth`).

Prerequisites: E4, E5 (dialogs), E6 (Clean entity storage dialog), B4. Read contracts §6 (`EntitiesResponse`, `StorageResponse`); mockups `ScreenEntities.dc.html`, `ScreenStorage.dc.html`; `dfm-rewrite-plan.md` §4.5, §4.7.

Exit criteria: Entities lists the seeded entities with parsed state in both modes (with and without `entities` capability), Signal and Purge work, Storage shows queues and partitions from the seeded hub, and both e2e specs pass.

### E10-S1 Entities

#### E10-S1-T1 entities.svelte.ts
Files: `src/lib/state/entities.svelte.ts`, tests
Depends: E4-S1-T1, E2-S6-T2
Do:
1. Filters (URL): `name`, `key` (prefix), `updated` (`1h|24h|7d|any`, default `7d`).
2. Loading: with `capabilities.entities` → `entities({ name, keyPrefix, updatedFrom, updatedTo, $top: 50, $skip })`; without → `listOrchestrations` with `$filter` = `createdTime ge/le` over the `updated` window (entities' `lastUpdatedTime` is what the backend filters on for entity queries) + `runtimeStatus in ('DurableEntities')` + `instanceId startswith '@{name}@{key}'` when a name is set (else the prefix `@{key}` cannot be expressed; filter client-side by key prefix), page 50, mapping rows to `EntityRow` (`entityName = entityId.name`, `key = entityId.key`, `state = parseMaybeJson(input?.state ?? input)`, `stateSummary = previewJson(state, 120)`).
3. Facets: `names` from `stats.entitiesByName` when `capabilities.stats`, else distinct names of loaded rows; `summary` `{count} durable entities · {names} entity names` (counts from stats when available, else `{loaded}+`).
4. Load more, auto-refresh, `app.refresh()`.
Accept:
- [ ] Without the capability the request filter contains `runtimeStatus in ('DurableEntities')`.
- [ ] Rows map the envelope `{"exists":true,"state":"{\"value\":1284}"}` to `state.value === 1284`.
Test: unit.

#### E10-S1-T2 Entities page
Files: `src/routes/Entities.svelte`, `src/lib/entities/EntityChips.svelte`, `src/lib/entities/EntitiesTable.svelte`, tests
Depends: E10-S1-T1, E1-S5-T1, E6-S2-T3
Do:
1. `PageTitle "Entities"` + meta summary + right `Clean entity storage` destructive (gated like E6-S2-T1; opens the shared dialog) (L17–L21).
2. `EntityChips` (L22–L32): name chip with `×` when set; `+ entity name` add chip → `.pop` with one `mi` per facet name (mono) + trailing count; `vsep`; key chip: `<span class="fchip"><span class="meta">key starts with</span><input class="input mono" …></span>` (borderless inline input, width 150, placeholder `@counter@`, applies on Enter/blur); `vsep`; `Select chip` "Updated in the last hour / 24 hours / 7 days / Any time".
3. `EntitiesTable` (L37–L55): columns spine (by `runtimeStatus`), entity name (bold + `Chip kind-entity sm "entity"`), key (mono link → peek), state (`trunc` mono link showing `stateSummary` → peek), lastUpdatedTime (mono, sorted desc), status (`StatusChip`), actions (right-aligned `Signal` sm + `Purge` sm destructive, disabled read-only); row click → peek with `kind: 'DurableEntity'` and `state`; footer meta `Showing {n} of {count} · state is the first line of the entity row, full state in the peek panel` + `Load more`.
4. `EmptyState` "No entities" / "No durable entity matches these filters. Clear the name chip or the key prefix." (L34).
5. Signal → `app.actions.open('signal', target)`; Purge → `app.actions.open('purge', target)` with the entity copy L102 ("Removes the entity row and its history. The next signal recreates it with empty state." confirm "Purge entity").
Accept:
- [ ] Two seeded entities render; the state cell shows the one-line preview; the peek shows the expanded state.
Test: component tests.

### E10-S2 Storage

#### E10-S2-T1 storage.svelte.ts
Files: `src/lib/state/storage.svelte.ts`, tests
Depends: E2-S6-T2
Do:
1. `load({ counts })` = `storage({ counts })`; `refreshedAgo` ticking; `countRows()` reloads with `counts=true` (expensive, explicit); auto-refresh and `app.refresh()` reload without counts but keep the last counts.
2. Derived: `workitems` queue, `controlQueues` sorted by partition, `ownedCount`.
Accept:
- [ ] `countRows` sends `counts=true` and keeps counts on the next plain refresh.
Test: unit.

#### E10-S2-T2 Storage page
Files: `src/routes/Storage.svelte`, `src/lib/storage/QueuesTable.svelte`, `src/lib/storage/PartitionsTable.svelte`, tests
Depends: E10-S2-T1, E1-S5-T1
Do:
1. L17–L23: `PageTitle "Storage"` + `Chip sm "Azure Storage"` + mono muted `{accountName} · {hub}` + right `fine muted` `refreshed {n} s ago` + `Refresh` primary; the explanation paragraph (max-width 80ch) verbatim.
2. `two storage` grid: left `Panel "Task hub"` meta `taskhub.json` with `Kv`: name, partitions (`partitionCount ?? '—'`), created (`fmtDateTime(createdAt)` or `—`), instances (`{fmtInt(counts.instancesRows)} rows` or `—` + a `LinkButton "Count rows"` that calls `countRows()`; `(partial)` suffix when capped), history (same), large messages (mono container + `Chip st-completed sm "exists"` or muted "missing"), blobs (`{n} · {fmtBytes}` or `—`); then `panel-h "Tables"` + `Kv` Instances/History/Partitions/Audit (mono names; `—` when null) (L25–L43).
3. Right stack: `QueuesTable` (`keep`; columns queue (mono), approximate messages (mono; the workitems value inside `Chip st-running` when above `prefs.thresholds.queueDepth`), what it means (text: workitems → "Activities waiting for a worker." plus " Above the {threshold} threshold: scale out or check for a stuck worker." when deep; control → "Idle." when 0 else "Orchestrator messages for partition {NN}.")); `PartitionsTable` (`keep`; partition, owner (mono or `—`), owned since, draining (`Chip sm "no"` or `Chip st-suspended sm "yes → {nextOwner}"`)) with footer meta "Ownership from the {tables.partitions} table; lease blobs are the fallback on older hubs." (or "Ownership from the lease blobs." per `source`) + ghost `Backlog on Overview` (L44–L69).
4. The route is only offered when `capabilities.storageHealth` (nav item hidden otherwise; direct navigation shows an `EmptyState` "Storage details are not available for this provider").
Accept:
- [ ] Deep workitems queue renders the running chip and the threshold sentence.
Test: component tests.

### E10-S3 End-to-end

#### E10-S3-T1 Entities and Storage e2e specs
Files: `tests/e2e/entities.spec.ts`, `tests/e2e/storage.spec.ts`
Depends: E10-S1, E10-S2, B4
Do:
1. Entities: both seeded entities listed; key prefix `@counter@warehouse-0` narrows to one; peek shows `"value": 1284` expanded; Signal dialog posts and toasts; Purge removes the row after refresh (re-seed).
2. Storage: queues table lists `durablefunctionshub-workitems` and four control queues with counts 0 (seeded empty), partitions from the seeded table (seed 4 partition rows in E3's seed when B4 lands), Count rows fills the instances row count.
Accept:
- [ ] Green.
Test: themselves.
