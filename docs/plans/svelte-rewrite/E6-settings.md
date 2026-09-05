# E6 · Settings

Goal: `ScreenSettings.dc.html` minus the mockup-only panel: Connection, Hub administration (the three destructive dialogs), Appearance (theme, mode, density, time, thresholds), Feature flags (read-only) and Templates. Replaces the React main menu.

Prerequisites: E0–E2, E1 dialogs. Read contracts §6 (`about`, admin endpoints), §8; mockup `ScreenSettings.dc.html`; React `states/dialogs/PurgeHistoryDialogState.ts`, `CleanEntityStorageDialogState.ts`, `ConnectionParamsDialogState.ts`.

Exit criteria: every panel renders from live `/about`, the three admin dialogs call their endpoints (or are disabled with the capability reason), appearance changes persist, and the e2e spec passes.

### E6-S1 Page and Connection panel

#### E6-S1-T1 Settings page frame and Connection panel
Files: `src/routes/Settings.svelte`, `src/lib/settings/ConnectionPanel.svelte`, `src/lib/settings/ConnectionDialog.svelte`, tests
Depends: E1-S4-T1, E1-S6-T3
Do:
1. `PageTitle "Settings"` + meta `{hub} · {accountName}` (L17). Layout: `two` grid (Connection, Hub administration), then `two wide-left` (Appearance | stack of Feature flags, Templates) (L18, L40).
2. `ConnectionPanel` L19–L30: `Panel "Connection"` meta `GET /about`; `Kv`: account (mono), task hub (mono), backend (mono version), provider (`Chip sm` with a readable name: AzureStorage → "Azure Storage", MsSql → "MSSQL", Netherite → "Netherite", unknown → "unknown"), permissions (`Chip sm "ReadWrite"` when present, `DangerBadge sm "DangerousOperations"` when dangerous, `Chip sm "Read only"` otherwise), host (`standalone` or `VS Code` · `location.host`). Buttons: `Manage connection` (default), `View /about JSON` (ghost → `JsonDialog` titled "/about").
3. `ConnectionDialog` (L108–L112): loads `manageConnection()` on open (progress in the dialog), `Field "Storage connection string"` read-only mono (masked by the backend), `Field "Task hub name"` read-only mono, meta "The storage connection this backend uses. Keys are never sent to the browser. This backend exposes the connection read-only." Footer: Close only (the backend has no update endpoint; the mockup's Save is omitted, README D11).
Accept:
- [ ] Renders provider and permission chips for the four combinations of readOnly × dangerous.
Test: component tests.

### E6-S2 Hub administration

#### E6-S2-T1 Admin rows with capability gating
Files: `src/lib/settings/HubAdminPanel.svelte`, tests
Depends: E6-S1-T1
Do:
1. `Panel "Hub administration"` meta `ReadWrite only`; three rows L34–L36 (`row` with a 2 px muted border, title bold + meta, destructive button): "Purge instance history" / "By created time and runtime status. Cannot be undone." / `Purge…`; "Clean entity storage" / "Removes empty entities and orphaned locks." / `Clean…`; "Delete task hub" / "Drops every table, queue and blob of {hub}." / `Delete…`.
2. Each button is disabled when `app.readOnly` (title "Read-only mode") or when its capability is false (`purgeHistory`, `cleanEntityStorage`, `deleteTaskHub`; title "Not supported by this backend"). Before B0 ships capabilities are all false; the React app called these anyway and got 400 for clean/delete, so this is strictly better.
3. `?dialog=purge|clean` opens the matching dialog on mount (VS Code commands, E2-S6-T3) and removes the param.
Accept:
- [ ] With `purgeHistory=true, cleanEntityStorage=false`, only Purge is enabled and Clean carries the reason title.
Test: as above.

#### E6-S2-T2 PurgeHistoryDialog
Files: `src/lib/settings/PurgeHistoryDialog.svelte`, `src/lib/state/purge-history.svelte.ts`, tests
Depends: E1-S3-T3, E1-S4-T2
Do:
1. State (React port): `timeFrom` default now − 24 h UTC, `timeTill` default now UTC, `statuses` default `Completed, Terminated, Canceled` (mockup L130), `includeEntities` false, `busy`, `result`.
2. Dialog (band) L100–L105: title "Purge instance history", body "Removes history for every instance matching the filter. This cannot be undone."; row of two `DateTimeField`s "Created from" / "Created till" (width 190); row of four `CheckRow`s with `StatusChip sm` for Completed, Terminated, Failed, Canceled; `Checkbox` "Include durable entities" (disabled with title "Not supported by this backend" when `!capabilities.purgeEntities`); no pre-count line (the backend cannot count without purging); confirm `Purge` destructive, disabled when no status is checked or a date is invalid.
3. Confirm: `purgeHistory({ timeFrom, timeTill, statuses, entityType })`; success → the dialog shows `Purged {instancesDeleted} instances` (React showed the count inside the dialog) and a toast; then Close; `app.refresh()`.
Accept:
- [ ] Posts ISO strings and the checked statuses; the result count renders.
Test: as above.

#### E6-S2-T3 CleanEntityStorageDialog and DeleteTaskHubDialog
Files: `src/lib/settings/CleanEntityStorageDialog.svelte`, `src/lib/settings/DeleteTaskHubDialog.svelte`, tests
Depends: E1-S4-T2
Do:
1. `CleanEntityStorageDialog` (shared with Entities, E10) L68–L72: band; body "Scans the Instances table for entities that hold no state or an orphaned lock and removes them. Running orchestrations are not touched."; `Checkbox` "Remove empty entities (no state)" default on, `Checkbox` "Release orphaned locks" default on (React default true; mockup shows off, follow React because the mockup value was a demo state), meta "POST /clean-entity-storage · the response says how many entities and locks were touched."; confirm "Clean entity storage" destructive; success toast `Cleaned entity storage: {n} empty entities removed, {m} locks released`.
2. `DeleteTaskHubDialog` L107: band; title `Delete task hub {hub}`; body L153; `Field "Type the task hub name to confirm"` with placeholder = hub; confirm "Delete task hub" destructive, disabled until the typed text equals the hub name; success → toast `Deleted task hub {hub}` then navigate to Login (browser) or show a note (VS Code).
Accept:
- [ ] Delete confirm enables only on an exact match.
Test: as above.

**Deviation, E6-S2-T3 (2026-09-05).** Three things the plan leaves open. (1) The clean confirm is
disabled while neither box is checked: that request asks the backend to remove nothing and release
nothing, which is the same "a filter that matches nothing is not a filter" rule E6-S2-T2 states for
the purge statuses. (2) A successful clean calls `app.refresh()` - it is opened from the Entities
screen too (E10), whose rows it has just deleted. (3) "show a note (VS Code)" is
`DELETE_TASK_HUB_VSCODE_NOTE`: the webview has no login screen to navigate to (the hub was chosen
when the view was opened), so the dialog stays, says the hub no longer exists and spends its own
field and confirm. Both dialogs reset when they open, as React's dialog states did.

### E6-S3 Appearance

#### E6-S3-T1 AppearancePanel
Files: `src/lib/settings/AppearancePanel.svelte`, `src/lib/settings/thresholds.ts`, tests
Depends: E2-S2-T3, E1-S3-T2
Do:
1. `Panel "Appearance"` meta `dfm.theme · dfm.mode · dfm.density` (L42): meta "Theme", grid `repeat(auto-fill, minmax(180px, 1fr))` of `ttile` radios (L45–L47) with four swatches (paper, ink, primary, dark paper), label, trailing metrics meta (`0 px · 2 px · 4 px` from `themes.ts`); `Switch` "Dark mode" hint "paper becomes the line; shadows change color per theme" (VS Code: a three-way `Segmented` Follow VS Code / Light / Dark); `Switch` "Comfortable density" hint "rows 44 px, controls 40 px"; row "Show time as" + `Segmented sm` UTC/Local.
2. Thresholds (L54–L60): meta "Needs attention thresholds"; `Field "Running longer than"` (mono, 120 px, text like `1 h`), `Field "Pending older than"` (`10 min`), `Field "Queue deeper than"` (`1,000`), `Save` button. `thresholds.ts`: `parseDuration('1 h' | '90 min' | '2 d') → minutes` and `formatDuration(minutes)`, `parseInt('1,000')`; invalid input keeps the field red-outlined (`aria-invalid`) and disables Save. Save writes `prefs.thresholds` and toasts "Saved thresholds for Needs attention".
Accept:
- [ ] Choosing Memphis updates `data-theme` and the active tile.
- [ ] `parseDuration('2 d')` → 2880; `'abc'` → null.
Test: as above.

### E6-S4 Feature flags and Templates

#### E6-S4-T1 FeatureFlagsPanel
Files: `src/lib/settings/FeatureFlagsPanel.svelte`, tests
Depends: E6-S1-T1
Do:
1. `Panel "Feature flags"` meta `from /about` (L64): two read-only rows rendered like the switches but disabled (`aria-disabled`, `title` "Reported by the backend"): "Read-only mode" hint "no ReadWrite permission" (on = readOnly), "Dangerous operations" hint "DFM_DANGEROUS_OPERATIONS_ENABLED" (on = dangerous).
2. `Kv` (L69–L73): storageSupports → `Chip sm st-completed "updateInput"` / `"truncateHistory"` when true (muted chips with the same text when false); capabilities → one `Chip sm` per true capability among stats, children, spans, failures, batch, storageHealth, audit, entities, conditionalGet; function graph → `Chip sm st-completed "available"` or muted "not available" (from `host.functionGraphAvailable`).
Accept:
- [ ] Renders exactly the true capabilities as chips.
Test: as above.

#### E6-S4-T2 TemplatesPanel
Files: `src/lib/settings/TemplatesPanel.svelte`, tests
Depends: E6-S1-T1
Do:
1. `Panel "Templates"` `Kv` (L76–L81): function map → `function-map.json · {n} functions` when `about.templates.functionMapAvailable` (B0) else `none`; Liquid tabs → the names from `about.templates.liquidTabs` joined with ` · ` (`none` when empty); custom meta → `durable-functions-monitor-meta · {custom | CSP default}` from `about.templates.customMetaTag`. Before B0: every value `—`.
Accept:
- [ ] Renders the fixture template info.
Test: as above.

### E6-S5 End-to-end

#### E6-S5-T1 Settings e2e spec
Files: `tests/e2e/settings.spec.ts`
Depends: E6-S1..S4
Do:
1. Open Settings; Connection shows the hub and version; View /about JSON opens a dialog with expanded JSON; Manage connection shows the masked string; Purge dialog with Failed checked and a range in the past purges the seeded failed instances (count > 0 in the result) and the Instances screen no longer lists them (re-seed after); Clean/Delete buttons disabled with the reason (isolated backend); theme tile changes `data-theme`; thresholds save toast.
Accept:
- [ ] Green locally and in CI.
Test: itself.
