# E9 · Failures and bulk operations

Goal: `ScreenFailures.dc.html` over `GET /failures` (B3), group and row recovery actions, and switching every bulk operation (Instances bulk bar, Failures group buttons) to `POST /orchestrations/batch` when the capability exists.

Prerequisites: E4 (bulk bar, runner), E5 (action dialogs), B3. Read contracts §6 (`FailuresResponse`, `BatchRequest`); mockup `ScreenFailures.dc.html`; `dfm-rewrite-plan.md` §4.4.

Exit criteria: Failures lists the seeded groups with the right signatures, row actions work, group Rewind/Purge run through `/batch`, the side nav count reflects the range, and the e2e spec passes.

### E9-S1 State

#### E9-S1-T1 failures.svelte.ts and nav count
Files: `src/lib/state/failures.svelte.ts`, `src/lib/state/app.svelte.ts` (extend), tests
Depends: E2-S6-T2
Do:
1. `load()` = `failures({ from, to })` with `app.track`; reload on range change, refresh, auto-refresh; `open: Set<groupKey>` (first group open by default, L96); `scannedLabel` `scanned {fmtInt} · {full|partial}`; `summary` `{totalFailed} failed in {groups.length} groups`.
2. `app.failuresCount`: loaded by the shell on hub change and range change when `capabilities.failures` (the endpoint is cached server-side; call it with the current range) and updated whenever the Failures screen loads; drives the side nav and bottom nav count chips (E2).
Accept:
- [ ] Nav count updates after a load; zero hides the chip.
Test: unit.

### E9-S2 Screen

#### E9-S2-T1 Failures page and groups
Files: `src/routes/Failures.svelte`, `src/lib/failures/FailureGroup.svelte`, `src/lib/failures/FailureRow.svelte`, tests
Depends: E9-S1-T1, E1-S2-T1
Do:
1. `PageTitle "Failures"` + range `Select sm` + meta `<Chip st-failed sm>{totalFailed}</Chip> failed in {n} groups` + right `fine muted` `scanned {n} · {full|partial} · signatures normalise numbers, GUIDs and quoted values to *` (L17–L22); `EmptyState` "No failures" / "Nothing failed in the {range lower}. Widen the range to look further back." (L24).
2. `FailureGroup` (L28–L58): `<div class="group" aria-expanded>`, `ghead` button (`tri`, name, mono muted grow signature, `Chip st-failed sm` count, `fine muted` `last {fmtTime(lastSeenAt)}`); when open: one `FailureRow` per instance and `gfoot` with `Rewind all {n}` (default) and `Purge all {n}` (destructive) (disabled read-only) + meta "Update input, Replay and Restart in place open the instance because they need the payload in front of you."
3. `FailureRow` (L38–L50): `frow`: spine, mono id link (→ instance), mono `t` created (`fmtTime`), mono `d` duration (`fmtDuration(durationMs)`), muted mono reason (link → peek with `customStatus`-like preview of the reason, `title` full reason), `acts`: `Rewind` sm, `Update input` sm (→ instance `tab=inputs`), `Restart in place` sm `danger` (disabled when `!app.dangerous` with title "Dangerous operations are disabled for this deployment (DFM_DANGEROUS_OPERATIONS_ENABLED)", else title "Purge and restart with the initial input"; → instance `tab=inputs`), `Purge` sm destructive. Read-only disables all four.
Accept:
- [ ] Three seeded groups render with counts 6, 2, 1 and the first open.
- [ ] Restart in place carries the disabled reason when dangerous is off.
Test: component tests.

#### E9-S2-T2 Row and group confirm dialogs
Files: `src/lib/failures/FailureActionDialog.svelte`, tests
Depends: E1-S4-T2, E4-S6-T4
Do:
1. Definitions L97–L102: rewind single/many (`Rewind {id}` / `Rewind {n} instances`; body "Re-runs only the failed steps{ of each instance}. Completed steps keep their results."; reason; confirm `Rewind` / `Rewind all {n}` primary), purge single/many (band; `Purge {id}` / `Purge {n} instances`; body "Removes {the instance|these instances}, the history and the large-message blobs. This cannot be undone."; confirm `Purge instance` / `Purge all {n}` destructive); `IdsPreview`.
2. Confirm → `runBulk(app, { action, ids, payload })` (E4-S6-T4) then `failures.load()`.
Accept:
- [ ] Group purge of 6 ids posts one batch request when `capabilities.batch`.
Test: as above.

### E9-S3 Batch endpoint wiring

#### E9-S3-T1 runBulk over /orchestrations/batch
Files: `src/lib/instances/bulk.ts` (extend), `src/lib/instances/BulkConfirmDialog.svelte` (meta text), tests
Depends: E4-S6-T4, B3
Do:
1. When `capabilities.batch`: chunk ids by 200, `endpoints.batch({ action, instanceIds, payload })` per chunk sequentially, merge `results`; dialog meta becomes "POST /orchestrations/batch · runs with bounded parallelism · the result lists ok and failed ids." (Instances L154). Dangerous actions are still never offered.
2. Fallback path unchanged when the capability is false.
Accept:
- [ ] 250 ids → two batch calls; results merged; toast counts correct.
Test: unit.

### E9-S4 End-to-end

#### E9-S4-T1 Failures e2e spec
Files: `tests/e2e/failures.spec.ts`
Depends: E9-S2, E9-S3, B3
Do:
1. Failures lists the groups; expanding the Timeout group shows two rows; `Update input` navigates to the Inputs tab; `Rewind all 6` posts a batch and toasts `Rewind all 6 · 6 ok, 0 failed` (the seeded instances are Failed so rewind is accepted by the host; if the host rejects rewinds of synthetic histories, assert the toast reports the failures and that the result dialog lists them); the nav chip shows the count; changing the range to 15 minutes empties the screen.
Accept:
- [ ] Green.
Test: itself.
