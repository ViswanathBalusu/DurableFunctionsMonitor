# E11 · Activity

Goal: `ScreenActivity.dc.html` over `GET /audit` (B5), plus the Overview recent-activity panel data path (E7-S2-T6 already renders it).

Prerequisites: E7, B5. Read contracts §6 (`AuditResponse`); mockup `ScreenActivity.dc.html`; `dfm-rewrite-plan.md` §4.8.

Exit criteria: after performing actions on the seeded hub with auditing on, the Activity screen lists them newest first with the right operation names and outcomes, filters by operation, and pages.

### E11-S1 State and screen

#### E11-S1-T1 activity.svelte.ts
Files: `src/lib/state/activity.svelte.ts`, tests
Depends: E2-S6-T2
Do:
1. Filters (URL): global range, `operation` (`All operations` or one of the backend operation names, contracts B5 list: Terminate, Rewind, Replay, Update input and rewind, Restart in place, Raise event, Purge, Purge history, Suspend, Resume, Restart, Set customStatus, Start new instance, Batch, Clean entity storage, Delete task hub).
2. `load()` = `audit({ from, to, operation, $top: 100, $skip })`, `loadMore()`, auto-refresh (first page), `count` label `{rows} entries`.
Accept:
- [ ] Operation filter is sent verbatim; `All operations` sends none.
Test: unit.

#### E11-S1-T2 Activity page
Files: `src/routes/Activity.svelte`, `src/lib/activity/ActivityTable.svelte`, tests
Depends: E11-S1-T1, E1-S5-T1
Do:
1. L17–L22: `PageTitle "Activity"` + range `Select sm` + operation `Select sm` (the list above, first entry "All operations") + right meta `{count} entries`.
2. `EmptyState` (L24) when the capability is false or the backend answers that auditing is off: "No activity recorded" / "Auditing is off for this hub. Set DFM_AUDIT_ENABLED=true on the backend; every Write and Dangerous call is then written to the {hub}DfmAudit table and shows up here." When the capability is true and the range is simply empty: "No activity recorded" / "Nothing was recorded in the {range lower}."
3. `ActivityTable` (`DataTable`, L27–L45): spine (`Completed` for `ok`, `Failed` otherwise), time (mono `fmtDateTime`, sorted desc), user, operation (bold + `Tag "dangerous"` when `kind === 'Dangerous'`, non-clickable), instance (mono link or muted `—`), outcome (`Chip st-completed sm "ok"` or `Chip st-failed sm "{status}"`), details (`trunc`, `title` = full message); footer meta "PartitionKey yyyyMMdd · RowKey reverse ticks · newest first" + `Load more`.
Accept:
- [ ] Renders the audit fixture with the dangerous tag on Replay and Restart in place rows.
Test: component tests.

### E11-S2 End-to-end

#### E11-S2-T1 Activity e2e spec
Files: `tests/e2e/activity.spec.ts`
Depends: E11-S1, B5
Do:
1. With `DFM_AUDIT_ENABLED=true`: suspend and resume a seeded instance, replay a failed one, then open Activity: three rows newest first with operations `Replay` (dangerous tag), `Resume`, `Suspend`, user `anonymous` (nonce mode), outcome ok; filter `Replay` shows one row; Overview's Recent activity shows the same first rows.
Accept:
- [ ] Green.
Test: itself.
