# E4 · Instances

Goal: `ScreenInstances.dc.html` as a working screen over `GET /orchestrations`: facet chips, filter rail, saved views, the table with selection, Timeline and Histogram views, the bulk action bar (client-side fan-out until B3), Start new instance, and the Long JSON dialog. This replaces the React list page.

Prerequisites: E0–E3. Read contracts §4 (query params), §6 (`$filter` syntax), §7, §9, §10, §11, §12; mockup `ScreenInstances.dc.html` (all), `dfm-rewrite-plan.md` §4.2, React `states/results-view/*.ts` for behaviour.

Exit criteria: every control on the mockup works against the seeded hub; e2e specs cover list, filter, sort, load more, peek, selection and a bulk suspend/resume round trip.

### E4-S1 State and filters

#### E4-S1-T1 OData filter builder
Files: `src/lib/filters/odata.ts`, `src/lib/filters/odata.test.ts`
Depends: E0-S3-T1
Do:
1. `FilterOperator = 'Equals'|'NotEquals'|'StartsWith'|'NotStartsWith'|'Contains'|'NotContains'|'In'|'NotIn'`; labels for the select: `Equals`, `Not Equals`, `Starts With`, `Not Starts With`, `Contains`, `Not Contains`, `In`, `Not In` (Instances L56).
2. `columnPredicate(column, op, value)`: port of React `toOdataFilterQuery` including `toArrayOfStrings` (JSON array or CSV) and `encodeURIComponent` of values.
3. `buildInstancesFilter({ from, to, statuses, includeEntities, column, op, value })`: `createdTime ge '<from>' and createdTime le '<to>'` + ` and runtimeStatus in (...)` (always sent: the eight statuses when none selected, plus `'DurableEntities'` when `includeEntities`) + ` and <predicate>` when a value is set. Returns the raw clause (the endpoint wrapper URL-encodes it).
4. `buildHistoryFilter({ timeFrom })`: `timestamp ge '<iso>'` or empty.
Accept:
- [ ] Matches the exact strings React produced for: Equals, StartsWith, NotContains, In with CSV `a, b`, In with JSON `["a","b"]`.
- [ ] Statuses `['Running','Failed']` + entities → `runtimeStatus in ('Running','Failed','DurableEntities')`.
Test: `odata.test.ts`.

#### E4-S1-T2 instances.svelte.ts
Files: `src/lib/state/instances.svelte.ts`, `src/lib/state/instances.test.ts`
Depends: E4-S1-T1, E2-S6-T2
Do:
1. View state (all mirrored to the URL through `ViewStateStorage('instances')`, contracts §4 params): `statuses: RuntimeStatus[]`, `names: string[]`, `column` (default `instanceId`), `op` (default `StartsWith`), `value` (typed) and `applied` (the value in force), `includeEntities` (false), `view` (`table`), `orderBy` (`createdTime`), `dir` (`desc`), `hiddenColumns` (default `['input','output','parentInstanceId','lastEvent']`; `lastEvent`/`parentInstanceId` are shown automatically while `column` is one of them and a value is applied, React `filteredOutColumns`).
2. Loading: `pageSize 50`, `rows`, `skip`, `hasMore`, `loading`, `requestId`; `reload()` resets and loads page 1; `loadMore()` appends; `autoRefresh` timer (seconds from `prefs.autoRefresh.instances`, driven by `app.autoRefresh`) reloads only the first page and replaces rows; any error stops auto-refresh and toasts with Retry (React parity). `hidden-columns` sent for `input|output|customStatus` when hidden.
3. Facets: `nameOptions` from `stats.byName` when `capabilities.stats` (E7 loads stats; here call `endpoints.stats` for the current range only when the popover opens, cached 30 s), else `[]` and the popover offers a text input.
4. `matchLabel`: `${fmtInt(rows.length)} loaded · ${rangeLabel}` while `hasMore`, `${fmtInt(rows.length)} match · ${rangeLabel}` when the last page was short (Instances L280).
5. Selection through `selection.svelte.ts` (E4-S6-T1); `selectAll=1` query selects all rows after the first load, then removes the param.
6. `savedViews` (E4-S2-T4) and `start=1` (opens the Start dialog then removes the param).
7. `getShownInstances()` for the bulk bar and for `batchOps` from VS Code.
Accept:
- [ ] Changing a chip updates the URL query and reloads from page 1.
- [ ] Auto-refresh replaces rows without touching `skip` beyond the first page; a failed refresh sets `autoRefresh` to 0 and toasts.
- [ ] Column `lastEvent` with an applied value adds `lastEvent` to the visible columns.
Test: `instances.test.ts` with the fake endpoints (records the exact `$filter`).

**Deviation, E4-S1-T2 (2026-09-05).** `src/lib/format/number.ts` (`fmtInt`, `fmtPct`) lands with this
task: contracts §10 names both functions but no earlier task created the file, and `matchLabel` is
the first thing that needs `fmtInt`. Saved views (item 6) stay with E4-S2-T4, which owns the menu;
what this task added for them is `takeFlag('start' | 'selectAll')`, the one-shot URL flags, so the
screen can open the Start dialog or select every loaded row and leave a reloadable URL behind.

### E4-S2 Header, chips and rail

#### E4-S2-T1 Page frame and title row
Files: `src/routes/Instances.svelte`
Depends: E4-S1-T2, E1-S4-T1
Do:
1. `Page` > `PageTitle "Instances"` + `<span class="meta">{matchLabel}</span>` + right-aligned row (`margin-left:auto;gap:10px`): Saved views menu (E4-S2-T4) and `Start new instance` primary (disabled in read-only) (L17–L27).
2. Then `FilterChips` (E4-S2-T2), the rail (E4-S2-T3), then either `EmptyState` or the view strip + view (E4-S3, S4, S5), and the dialogs.
Accept:
- [ ] Renders with the fake app; Start button disabled when `readOnly`.
Test: component test.

#### E4-S2-T2 FilterChips
Files: `src/lib/instances/FilterChips.svelte`, `src/lib/instances/StatusFacet.svelte`, `src/lib/instances/NameFacet.svelte`, `src/lib/instances/RangeChip.svelte`, tests
Depends: E4-S1-T2, E1-S3-T2, E1-S4-T3
Do:
1. `<div class="chips2" aria-label="Filters">` in this order (L28–L53): one `fchip` per selected status with `×` (`aria-label="Remove filter"`); `+ status` add chip opening `StatusFacet` (`.pop` with eight `CheckRow`s showing `StatusChip sm`, and an `Apply` primary sm button that closes; changes apply on close, React `isStatusSelectOpen`); `vsep`; one mono `fchip` per selected orchestrator name with `×`; `+ orchestrator` opening `NameFacet` (`.pop` with meta `stats.byName`, one `mi` per name with a `box` and trailing count; without the capability a `TextInput mono` "Type an orchestrator name" + Enter adds it); `vsep`; `RangeChip` = `Select chip` of the five presets bound to the global range (custom range shows its label as a sixth option); `vsep` + free filter chip `{column} {op lowercase} {applied}` with `×` when applied; `vsep`; entities toggle chip (`+ include entities` dashed when off, `Entities included ×` solid when on); `Clear all` ghost sm when any filter is set (L52).
2. Every chip change goes through the state (which updates the URL and reloads).
Accept:
- [ ] Removing the last status chip sends the eight-status list (contracts §6).
- [ ] The entities chip toggles `includeEntities` and the label.
Test: as above.

#### E4-S2-T3 Filter rail
Files: `src/lib/instances/FilterRail.svelte`, tests
Depends: E4-S1-T2, E1-S3-T1
Do:
1. `<div class="row" style="align-items:flex-end">`: `Field "Filtered column"` `Select` (width 180; options in the order of L55 plus `parentInstanceId`), `Field "Filter operator"` `Select` (width 160), `Field "Filter value"` `TextInput mono` (grow, max-width 280, placeholder `order-2026-`, Enter applies), `Apply` default button, `Refresh` primary button (calls `reload()`), right-aligned meta "Density and columns in the table menu" (L54–L63).
2. Apply sets `applied = value` (state reloads). Changing the operator or column while a value is applied reloads (React parity).
Accept:
- [ ] Enter in the value field applies and reloads once.
Test: as above.

#### E4-S2-T4 Saved views
Files: `src/lib/instances/SavedViewsMenu.svelte`, `src/lib/instances/SaveViewDialog.svelte`, tests
Depends: E4-S1-T2, E1-S4-T3
Do:
1. `Pop kind="menu"` trigger `Saved views ▾` (L22–L23): the user's views from `prefs.savedViews` (each `mi` navigates to `/instances?<saved query>`; a trailing `×` removes it with an inline confirm), separator, `Save current view…` opening `SaveViewDialog` (one `Field "Name"` prefilled `${statuses.join(', ') || 'Everything'} · ${rangeLabel}`; Save stores `{ name, query: current query string }`, toast `Saved view "{name}" to this browser` (L285)).
2. Ship no built-in views; the mockup's three entries are examples, not product.
Accept:
- [ ] Saving then selecting a view restores statuses, names, free filter and range.
Test: as above.

**Deviation, E4-S2-T4 (2026-09-05).** A view is stored as `{ name, url }`, the shape contracts §12
already gave `SavedView`, and the URL is the whole in-app link (`/{hub}/instances?<query>`) rather
than a bare query string - it is what `Router.href` produces and what `parsePath` reads back. Three
members landed in `instances.svelte.ts` for it, which E4-S1-T2 item 6 deferred here: `viewQuery`
(the filters, the columns, the sort and the time range, the range written out even when it is the
default one, so a saved view keeps the range it was saved with), `applyUrl` (navigate, re-read the
view state *from the query alone* - a field the saved view does not carry is one it does not filter
on, so the stored view state must not fill it back in - then reload), and `loadedRangeKey`, which
moved out of `Instances.svelte`: the screen now compares the shared range against the range the
state last loaded for, so opening a saved view that carries its own range is one reload, not two.

### E4-S3 Table view

#### E4-S3-T1 Columns and table wiring
Files: `src/lib/instances/columns.ts`, `src/lib/instances/InstancesTable.svelte`, tests
Depends: E1-S5-T1, E4-S1-T2
Do:
1. Columns (id → header, cell): `instanceId` (mono `LinkCell` → instance route; Ctrl/⌘ click → `openInNewWindow`), `name` (text + `Chip kind-entity sm "entity"` for entities; entities show `entityId.name`), `createdTime` (mono `fmtDateTime`), `lastUpdatedTime` (mono), `runtimeStatus` (`StatusCell`), `duration` (mono `fmtDuration(duration)`; `—` for entities), `customStatus` (`JsonCell`, `trunc`), and hideable extras `lastEvent`, `parentInstanceId` (mono link), `input` (`JsonCell`), `output` (`JsonCell`). Sortable: all except `customStatus`, `input`, `output` (backend sorts by property name; `$orderby=<id> asc|desc`).
2. `DataTable` props: `selectable`, `selected` bound to the selection store, `sort` bound to `orderBy/dir`, `onRowClick` → `peek.open(toPeekItem(row))`, `hiddenColumns` bound, `flat` false, `keep` false; wrapper style `border-top:0;border-radius:0 0 var(--radius) var(--radius)` under the view strip (L77).
3. Footer (L96): `Showing {rows.length} of {matchCount} · {hiddenCount} columns hidden · <link>show all</link>` (hidden count part only when > 0; `show all` resets `hiddenColumns` to `[]` and reloads) and `Load more` (hidden when `!hasMore`; shows a `.progress` while loading).
4. `toPeekItem(row)`: id, name, kind, status, created, updated, duration text, customStatus, entity state = `row.input` for entities.
Accept:
- [ ] Sorting by `createdTime` twice sends `desc` then clears (three-state).
- [ ] Row click opens the peek; the id link navigates without opening the peek.
Test: as above.

#### E4-S3-T2 View strip, empty state and errors
Files: `src/lib/instances/ViewStrip.svelte`, `src/routes/Instances.svelte` (extend), tests
Depends: E4-S3-T1
Do:
1. `Tabs` with Table / Timeline / Histogram bound to `view`, trailing meta `{rows.length} loaded · sorted by {orderBy} {dir}` (L69–L75).
2. `EmptyState` "No orchestrations" with "Nothing matches these filters in the {range lower}. Remove a chip, widen the time range or start a new instance." and actions `Clear filters` / `Start new instance` (L65) when the first page is empty and not loading.
3. Load failure: `toast.fromError('Load failed', err, () => reload())`.
Accept:
- [ ] Empty response renders the empty state; the strip stays hidden.
Test: as above.

### E4-S4 Timeline view

#### E4-S4-T1 timeline.svelte.ts and TimelineView
Files: `src/lib/state/instances-timeline.svelte.ts`, `src/lib/instances/TimelineView.svelte`, tests
Depends: E1-S8-T4, E4-S1-T2
Do:
1. Load `listOrchestrations({ top: 500, orderBy: 'createdTime asc', filter })` (React `ResultsGanttDiagramTabState`), grouped by function name in order of first appearance (section grouping is expressed as lane order, no section headers).
2. Lanes: one per instance (`label` = instance id or entity key, `title` id), one bar with `statusClass`, from `createdTime` to `lastUpdatedTime` (running/pending: to now), bar text `fmtDuration` when wide else `blbl`; `now` line on the last lane (L100–L106). Domain: earliest created → now. Axis: 6 ticks `fmtTime` or `MMM d HH:mm` when the domain spans more than a day.
3. Below: legend of the seven statuses and `Save as SVG` ghost sm (`instances-gantt.svg`) (L107). Wrapper style `border-top:0;border-radius:0 0 var(--radius) var(--radius)`.
4. Lane click opens the peek; the label is a link to the instance.
Accept:
- [ ] 9 seeded instances produce 9 lanes ordered by created ascending; running instance bar reaches the right edge.
Test: as above.

**Deviation, E4-S4-T1 (2026-09-05).** Lane order is the grouping of item 1: the names in the order
they first appear, the rows of a name in creation order. With one orchestrator name - the seeded hub
the acceptance is written against - that is exactly created ascending; with several, grouping wins,
which is what React's mermaid sections did visually. Four additions to E1-S8-T4's swimlane were
needed and are used by the workspace later: `href` on a lane (its label is a real link to the
instance, `stopPropagation` so the lane click stays the peek), `onLaneClick` and `onLaneLabelClick`,
a `style` prop (the view strip leaves the frame without a top border), and `formatTick` now receives
the tick index, so an axis can label a run of ticks rather than each one on its own (the day is shown
when it changes: `Sep 3 23:50`, then `02:40`). `tests/unit/harnesses/ScreenHarness.svelte` gained a
`client` prop, so a screen test can watch what goes to the host - here `saveAs`.

### E4-S5 Histogram view

#### E4-S5-T1 histogram.svelte.ts and HistogramView
Files: `src/lib/state/instances-histogram.svelte.ts`, `src/lib/instances/HistogramView.svelte`, tests
Depends: E1-S8-T3, E4-S1-T2
Do:
1. Port `ResultsHistogramTabState`: fetch pages of 1000 (`$top=1000&$skip=n`) with the current filter until a short page, cancellable; bucket `createdTime` into 48 bins across the global range; series = function names ordered by count, top five kept, the rest merged into `other`; colors `chart-1..5` and `muted` for other.
2. `StackedColumns` with `ariaLabel "Instances per {bin length} by orchestrator"`, brush bound: on brush → `app.setTimeRange({ from, to })` rounded to seconds (React `applyZoom`) which reloads; a `Reset zoom` link restores the previous range (React `resetZoom`, keep the previous range in state).
3. Legend rows per series + trailing meta "brush narrows the time filter"; a meta line `{n} instances scanned` while loading updates live (L124).
Accept:
- [ ] Two pages (1000 + 3) yield 1003 counted instances and the fetch stops.
- [ ] Brushing sets a custom range in the URL.
Test: as above.

**Deviation, E4-S5-T1 (2026-09-05).** The state file is
`src/lib/state/instances-histogram.svelte.ts` (the plan wrote `instances-histogram.svelte.ts` without
the folder, and it belongs beside `instances-timeline.svelte.ts`). Every page of the walk is asked
for with the filter resolved once, at the start: a preset range ends at "now", and a second page
asking for a slightly later "now" would page through a list that had moved under it - React had that
bug. `StackedColumns` gained a `legendMeta` prop, which is where "brush narrows the time filter"
goes (L124). The brush-to-zoom wiring is three lines in the view and is tested through the state
(`zoom` rounds outwards to whole seconds and writes `from`/`to`; `resetZoom` puts the preset back):
d3-brush needs `getScreenCTM`, which jsdom does not implement, so a pointer-level brush test would
be testing the shim rather than the app.

### E4-S6 Selection and bulk actions

#### E4-S6-T1 selection.svelte.ts
Files: `src/lib/state/selection.svelte.ts`, tests
Depends: E0-S4-T2
Do:
1. `ids: Set<string>` (`$state` with a `SvelteSet` from `svelte/reactivity`), `toggle(id)`, `set(ids)`, `toggleAll(visible: string[])` (all → none when every visible id is selected), `clear()`, `count`, `has(id)`, and `names: Map<id, name>` kept for dialogs.
2. Survives peek open/close and route query changes on the same screen; cleared on hub change and on screen change.
Accept:
- [ ] `toggleAll` with all visible selected clears; otherwise selects all visible.
Test: as above.

#### E4-S6-T2 BulkActionBar
Files: `src/lib/instances/BulkActionBar.svelte`, tests
Depends: E4-S6-T1, E1-S2-T1
Do:
1. Markup L130–L139: `<div class="bulk" role="toolbar" aria-label="Bulk actions">` count `cnt` `{n} selected`, buttons Terminate, Suspend, Resume, Rewind, Raise event (default), Purge (destructive), all disabled in read-only, and the `×` ghost that clears the selection. Rendered only when `count > 0`; mounted in `Instances.svelte` (E9 reuses it on Failures).
2. Each button opens the matching bulk confirm (E4-S6-T3).
Accept:
- [ ] Appears with one selected row; `×` hides it.
Test: as above.

#### E4-S6-T3 Bulk confirm dialogs
Files: `src/lib/instances/BulkConfirmDialog.svelte`, `src/lib/instances/bulk-defs.ts`, tests
Depends: E1-S4-T2, E1-S6-T3
Do:
1. `bulk-defs.ts`: the definitions of L243–L248 verbatim (title, body, confirm label, `cls` primary/destructive, `band`, `reason`, `event`), parameterised by `n`.
2. Dialog body: `<p>{body}</p>`, `IdsPreview` of the selected ids, for `raise`: `Field "Event name"` (`TextInput mono`) + `Field "Event data (JSON)"` (`JsonEditor` 3 rows), for `reason`: `ReasonField`, then `<p class="meta">` "Runs one request per instance · the result lists ok and failed ids." (E9 swaps the text for the batch endpoint). Footer Cancel + confirm (`cls`).
3. Confirm calls `runBulk` (E4-S6-T4) and closes.
Accept:
- [ ] `terminate` shows the band and the reason field; `raise` shows the event fields.
Test: as above.

#### E4-S6-T4 Bulk runner (client fan-out)
Files: `src/lib/instances/bulk.ts`, `src/lib/instances/BulkResultDialog.svelte`, tests
Depends: E4-S6-T3, E0-S2-T4
Do:
1. `runBulk(app, { action, ids, payload })`: when `app.capabilities.batch` call `endpoints.batch` (E9 wires it; until then this branch is unreachable), else fan out with concurrency 8: `suspend`/`resume` → `postAction(id, action, payload.reason ?? '')`, `rewind` → `postAction(id, 'rewind', payload.reason ?? '')`, `terminate` → `postAction(id, 'terminate', payload.reason ?? '')`, `raise-event` → `raiseEvent(id, payload.name, payload.data)`, `purge` → `purge(id)`, `set-custom-status` → `setCustomStatus`, `restart` → `restart(id, payload.restartWithNewInstanceId)`. Collect `{ instanceId, ok, status, message }` per id (React `BatchOpsDialogState.execute`).
2. Afterwards: toast `${confirmLabel} · ${ok} ok, ${failed} failed` (ok toast when `failed === 0`, error otherwise), clear the selection, `reload()`; when any failed open `BulkResultDialog` (table of id + status + message, `keep`).
3. Dangerous actions are never offered in bulk (design §3).
Accept:
- [ ] 3 ids with one 409 → toast "… · 2 ok, 1 failed" and the result dialog lists the failure.
- [ ] Concurrency never exceeds 8 in-flight (test with deferred promises).
Test: as above.

### E4-S7 Start new instance

#### E4-S7-T1 StartNewInstanceDialog
Files: `src/lib/instances/StartNewInstanceDialog.svelte`, `src/lib/state/start-instance.svelte.ts`, tests
Depends: E1-S4-T2, E1-S6-T3, E1-S3-T4
Do:
1. State: `open`, `orchestrator`, `instanceId`, `inputText`, `busy`; `openWith({ orchestrator?, instanceId?, input? })` for prefill (function graph node menu and the restart-in-place recovery dialog, E5). Registered on `app.dialogs.startNewInstance` so any screen can open it.
2. Dialog L160–L172 (title "Start new instance"): `Field "Orchestrator"`: when `host.functionGraphAvailable`, a `Combobox mono` over the names of functions whose bindings include `orchestrationTrigger` (from `functionMap()`, loaded once), else a `TextInput mono`; `Field "Instance id"` (`TextInput mono`, placeholder "Leave empty for a generated GUID"); `Field "Input (JSON)"`: `JsonEditor` 6 rows with footer `text mode · JSON valid|invalid` and `SizeMeter`. Footer Cancel / Start (primary; disabled when the orchestrator is empty, the JSON is invalid, or busy).
3. Start: `POST /orchestrations` `{ id: instanceId || undefined, name, data: parsed input or null }`; success → close, toast `Started {id} · {name}` (L288), `app.refresh()`; error → `toast.fromError('Failed to start new instance', err)` and keep the dialog open.
Accept:
- [ ] Invalid JSON disables Start and shows `JSON invalid` in the footer.
- [ ] Success toast contains the returned instance id.
Test: as above.

### E4-S8 Long JSON dialog

#### E4-S8-T1 Cell JSON dialogs
Files: `src/lib/instances/InstancesTable.svelte` (extend), tests
Depends: E1-S6-T3
Do:
1. `customStatus`, `input`, `output` cells open `JsonDialog` with title = column name, subtitle = mono instance id, `downloadField` for `input`/`output`/`custom-status` so blob-backed values get the Download button (React `LongJsonDialogState.downloadFieldValue`). Copy toast `Copied {column} to the clipboard` (L316).
Accept:
- [ ] Clicking a customStatus cell opens the dialog with the value pretty-printed and expanded; the row's peek does not open.
Test: as above.

### E4-S9 End-to-end

#### E4-S9-T1 Instances e2e specs
Files: `tests/e2e/instances.spec.ts`
Depends: E4-S1..S8, E3-S2-T3
Do:
1. List renders the seeded rows; status chip filter to Failed shows only failed; `+ orchestrator` facet (text mode) filters by name; free filter `instanceId starts with order-` narrows; sort by createdTime toggles the arrow; Load more appears with more than 50 seeded rows (seed 60 for this spec through an env flag); row click opens the peek and Esc closes it; Timeline and Histogram render; select two rows → bulk bar → Suspend with reason → toast "Suspend 2 · 2 ok, 0 failed" → Resume; Start new instance with an unknown orchestrator surfaces the backend error toast; customStatus cell opens the JSON dialog with expanded content.
Accept:
- [ ] Spec green locally and in CI.
Test: itself.
