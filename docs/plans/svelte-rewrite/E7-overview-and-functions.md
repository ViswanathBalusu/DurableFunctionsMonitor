# E7 · Overview and Functions

Goal: `ScreenOverview.dc.html` and `ScreenFunctions.dc.html`: the first screens that did not exist in React. Both read `GET /stats` (B1); Overview also reads `/storage` (B4) and `/audit` (B5) when those capabilities exist. Functions also renders the function graph (E5-S6) with hub-wide counters and serves `DfmViewMode=1` in VS Code.

Prerequisites: E1–E5 (chart frames, graph component), B1 available on a dev host (or the fake endpoints for unit tests). Read contracts §6 (`StatsResponse`), §10; mockups `ScreenOverview.dc.html`, `ScreenFunctions.dc.html`; `dfm-rewrite-plan.md` §4.1, §4.6.

Exit criteria: Overview renders live numbers from the seeded hub with the tiles linking into Instances, the throughput brush changes the global range, Functions table and graph agree on the selected orchestrator, and both screens hide panels whose capability is missing.

### E7-S1 Overview state

#### E7-S1-T1 overview.svelte.ts
Files: `src/lib/state/overview.svelte.ts`, tests
Depends: E2-S6-T2, E0-S2-T4
Do:
1. `load()`: in parallel and independently (one failing does not block the others): `stats({ from, to, bins: 48, stuckAfterMinutes: prefs.thresholds.stuckMinutes, pendingAfterMinutes: prefs.thresholds.pendingMinutes })` when `capabilities.stats`; `storage()` when `capabilities.storageHealth`; `audit({ from, to, $top: 4 })` when `capabilities.audit`. Each with `app.track`. Reload on time-range change, on `app.refresh()`, on auto-refresh (`app.autoRefresh`).
2. Derived: `isEmpty` = stats loaded and `totals.all === 0 && totals.entities === 0`; `partial` = `stats.partial`; `scannedLabel` = `${fmtInt(scanned)} (${partial ? 'partial' : 'full'})`; `refreshedAgo` ticking meta.
3. Without `capabilities.stats` the screen shows an `EmptyState` "Overview needs the stats endpoint" with text "This backend does not report hub statistics. Instances, Entities and Settings work without it." and links to Instances (do not call the endpoint).
Accept:
- [ ] A 500 from `/storage` leaves stats rendered and toasts once.
Test: unit with fake endpoints.

### E7-S2 Overview screen

#### E7-S2-T1 Title row, partial banner, empty state
Files: `src/routes/Overview.svelte`, tests
Depends: E7-S1-T1, E1-S4-T1
Do:
1. `PageTitle "Overview"` + `Select sm` of the five presets bound to the global range + `Refresh` ghost (height 32) + right meta `refreshed {n} s ago · scanned {scannedLabel}` (L17–L22).
2. `Banner` when partial (L24): `Chip st-running sm "Partial results"`, text "Counted the first 50,000 instances of the range; narrow the range for exact numbers." (use `stats.cap` for the number), action `Use last 24 hours` (sets the preset; hidden when the range already is 24h).
3. `EmptyState` when `isEmpty` (L27): "No orchestrations", "Nothing was created in the {range lower}. Widen the time range or start a new instance.", actions `Widen to 7 days` and `Start new instance` (primary; opens `app.dialogs.startNewInstance`).
Accept:
- [ ] Partial flag renders the banner with the cap number.
Test: component test.

#### E7-S2-T2 Stat tiles
Files: `src/lib/overview/StatTile.svelte`, `src/lib/overview/StatTiles.svelte`, tests
Depends: E1-S8-T2
Do:
1. `StatTile`: `<button class="stat-tile {cls}"><span class="lbl">{label}</span><span class="num">{fmtInt(n)}</span><Sparkline values/></button>` (L31–L36).
2. Six tiles in order: Running (`st-running`, → instances `status=Running`), Pending (`st-pending`, → `status=Pending`), Failed (`st-failed`, → Failures when `capabilities.failures` else instances `status=Failed`), Completed (`st-completed`), Suspended (`st-suspended`), Entities (`kind-entity`, → Entities). Sparkline values = per-bin counts of that status from `stats.bins` (Entities tile: flat line of `totals.entities`).
3. Navigation carries the current range query.
Accept:
- [ ] Click on Failed navigates to `/failures` when the capability is present, else to instances with the status filter.
Test: as above.

#### E7-S2-T3 Throughput panel
Files: `src/lib/overview/ThroughputPanel.svelte`, tests
Depends: E1-S8-T3
Do:
1. `Panel "Throughput"` meta `{binCount} bins · brush sets the global range` (L40); `StackedColumns` with series Completed, Failed, Running, Pending, (Suspended, Terminated, Canceled, ContinuedAsNew when non-zero) in status colours, `ariaLabel "Instances per {bin length} by status"`; x ticks 5 (`Sep 3, 14:00`, `20:00`, … format: `MMM d, HH:mm` for the first tick and when the day changes, else `HH:mm`); legend row; when a custom range is active a trailing meta `Brushed {from} to {to} · <link>clear</link>` (L61) where clear returns to the last preset.
2. Brush → `app.setTimeRange({ from, to })`.
Accept:
- [ ] Brush sets a custom range; clear restores the preset.
Test: as above.

#### E7-S2-T4 Needs attention panel
Files: `src/lib/overview/NeedsAttention.svelte`, tests
Depends: E7-S1-T1
Do:
1. `Panel "Needs attention"` meta `thresholds in Settings`; `<div class="attn">` rows (L66–L72), each `<span class="n">` mono count, text, trailing `link`: `{stuck.count} running longer than {fmtDuration(stuckMinutes)}` → instances `status=Running` (with `stuck=1` so E4 can sort by lastUpdatedTime asc), `{totals.Failed} failed in range` → Failures (or instances Failed), `{oldestPending.count} pending older than {fmtDuration(pendingMinutes)}` → instances `status=Pending`, `{workitems count} work items queued` → Storage (only when `capabilities.storageHealth` and the queue is deeper than `prefs.thresholds.queueDepth`), `{suspended.count} suspended for {fmtDuration(now − suspended.oldestLastUpdatedAt)}` → instances `status=Suspended` (only when > 0).
2. Rows with a zero count are hidden except "failed in range" which always shows.
Accept:
- [ ] Renders the four rows for the stats fixture; queue row absent without storage.
Test: as above.

**Deviation, E7-S2-T4 (2026-09-05).** The stuck row's link carries `stuck=1` as the plan says, but
E4 never read that parameter - nothing in the Instances screen sorts on it - so the link carries
`orderby=lastUpdatedTime&dir=asc` beside it, which is the view state E4 does read and is exactly what
the plan asks the marker to achieve. Every row of this panel also carries the range that is on
screen, as the tiles do: the counts are counted over that range, and a list that showed another one
would disagree with the number that was clicked.

#### E7-S2-T5 Top orchestrators panel
Files: `src/lib/overview/TopOrchestrators.svelte`, tests
Depends: E1-S5-T1
Do:
1. `Panel "Top orchestrators"` meta `stats.byName · p50 and p95 over terminal instances`; `DataTable flat keep` columns name (`LinkButton` → instances `name=<name>`; a `Chip sm "sub-orchestrator"` after the name when the function map says the function is called by another orchestrator, E5-S6-T1 `suborchestrator` kind), started (sorted desc by default), completed, failed, failure rate (`fmtPct`), p50 (`fmtDuration(p50Ms)` or `—`), p95, last failure (`fmtTime(lastFailedAt)` or `—`) (L75–L88). Sorting is client-side here.
Accept:
- [ ] Rows sorted by started desc; `—` for nulls.
Test: as above.

**Deviation, E7-S2-T5 (2026-09-05).** The sub-orchestrator chip needs the function map, which
E7-S1-T1 does not load, so `overview.svelte.ts` gained a fourth call: `/function-map`, once per
session, only when the host publishes one, and silent when it fails - the map does not depend on the
range and a map that cannot be fetched costs exactly one chip. `subOrchestrators` is E5-S6-T1's
classification (`buildFunctionGraph`), not a second rule about who calls whom. Sorting is this
panel's own, as the plan says, and rows the backend has no value for sort last whichever way the
column points: an orchestrator that never failed does not have the oldest last failure.

#### E7-S2-T6 Backlog and Recent activity panels
Files: `src/lib/overview/BacklogPanel.svelte`, `src/lib/overview/RecentActivity.svelte`, tests
Depends: E7-S1-T1
Do:
1. `panels wide-right` grid (L89) rendered only when at least one of the two capabilities exists; each panel only with its capability.
2. `BacklogPanel` (L90–L101): `Panel "Backlog"` meta `Chip sm "Azure Storage"`; `Kv` three columns: `workitems` → count + `Chip st-running sm "deep"` when above the threshold, `control-NN` per control queue, `partitions` → `{n} · all owned` or `{owned} of {n} owned`; meta line "A deep work-item queue means activities are waiting for workers." + link Storage.
3. `RecentActivity` (L102–L116): `Panel "Recent activity"` meta `audit · last {rows} in range`; `DataTable flat` without header: time (mono `fmtTime`), user, operation, instance (mono link), outcome (`Chip st-completed sm "ok"` or `Chip st-failed sm "{status}"`); meta link `Activity`.
Accept:
- [ ] Without `audit` the Recent activity panel is absent and Backlog spans the full width (`panels` becomes single column through a `single` class).
Test: as above.

### E7-S3 Functions screen

#### E7-S3-T1 functions.svelte.ts
Files: `src/lib/state/functions.svelte.ts`, tests
Depends: E7-S1-T1, E5-S6-T1
Do:
1. Loads `stats` (when capability) for the table and node counters, and `functionMap()` (when `host.functionGraphAvailable`) for the graph; `layout` from `?layout` (`table|both|graph`, default `both`; `table` when no graph, `graph` when no stats); `selected` from `?selected`.
2. `rows` = `stats.byName`; `related(selected)` = names connected to the selected node by an edge (Functions L103–L104) used for row highlighting; metrics per orchestrator name `{ completed, running, failed }` from `byName`.
Accept:
- [ ] Selecting `ProcessOrderOrchestrator` marks its row `hl` and the graph node selected.
Test: unit.

#### E7-S3-T2 Functions page
Files: `src/routes/Functions.svelte`, `src/lib/functions/FunctionsTable.svelte`, tests
Depends: E7-S3-T1, E5-S6-T2
Do:
1. `PageTitle "Functions"` + range `Select sm` + right `Segmented sm` Table / Both / Graph (L17–L21); `two` grid with `single` when not `both` (L22).
2. `FunctionsTable` (L23–L45): `DataTable` with a spine cell painted `var(--node-orchestrator)` (pass a `spineColor` prop), columns orchestrator (mono link → instances `name=`), started (sort desc), completed, failed, rate, p50, p95, last failure; row click selects; footer meta "Activity-level numbers need history scans, so they appear only for instances loaded in Instances." + `scanned {n} · {full|partial}`.
3. Graph column (L46–L70): `FunctionGraph` height 520 with `metrics` on orchestrator nodes, `selected` bound, legend of the seven node kinds (L66), `Save as SVG` (`{hub}-functions.svg`) and `az-func-as-a-graph` ghost buttons.
4. `DfmViewMode === 1` (VS Code function graph view): `App.svelte` renders this route alone, `layout=graph` forced, no table, an extra ghost `Save as JSON` calling `client.host.saveFunctionGraphAsJson()`; double-click → `gotoFunctionCode`.
Accept:
- [ ] Layout segment hides the table or the graph and updates `?layout`.
- [ ] View mode 1 renders without the shell.
Test: as above.

### E7-S4 End-to-end

#### E7-S4-T1 Overview and Functions e2e specs
Files: `tests/e2e/overview.spec.ts`, `tests/e2e/functions.spec.ts`
Depends: E7-S2, E7-S3, B1
Do:
1. Overview: tiles show the seeded counts (2 failed groups etc.), Failed tile navigates, throughput renders 48 columns, brushing changes the URL range, top orchestrators lists `ProcessOrderOrchestrator` first; with the 30-day preset and the `cap` forced low through `DFM_STATS_CAP=5` on the host (B1 exposes it for tests) the partial banner appears.
2. Functions: table rows, selecting a row highlights, `Table` layout hides the graph; graph assertions run only when the host serves a function map (seed one through `DFM_CUSTOM_TEMPLATES` folder in E3's runner: add `tests/e2e/templates/function-maps/dfm-func-map.json`).
Accept:
- [ ] Green.
Test: themselves.
