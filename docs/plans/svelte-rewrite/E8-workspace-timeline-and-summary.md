# E8 · Workspace Timeline tab and Summary column

Goal: the parts of `ScreenInstance.dc.html` that need `/spans` (B2) and `/children` (B1): the Timeline tab (swimlane linked to the history table), "Where the time went", the Children panel, the Execution panel values, the header's children and history counts, and the peek panel's mini timeline. This is what makes the workspace the reason to use the tool.

Prerequisites: E5, B1 (`children`), B2 (`spans`). Read contracts §6 (`SpansResponse`, `ChildrenResponse`), `dfm-design-system.md` §8 "Timeline swimlane" and "Where the time went", `dfm-rewrite-plan.md` §4.3; mockup L55–L119.

Exit criteria: for the seeded running instance the Timeline tab shows the lanes of L300–L310 computed from real spans, hovering links spans and rows both ways, the Summary column shows totals and children, and everything degrades to E5's placeholders when a capability is missing.

### E8-S1 State

#### E8-S1-T1 spans and children loading
Files: `src/lib/state/instance-spans.svelte.ts`, `src/lib/state/instance.svelte.ts` (extend), tests
Depends: E5-S1-T1
Do:
1. `spans: SpansResponse | null`, `children: ChildrenResponse | null`; loaded with the details when the capabilities exist (in parallel, errors toast once and leave null); refreshed by `refreshAll()` and auto-refresh; conditional GET is not used for spans (the body is small).
2. `hover: string | null` shared hover key (span id) set by the swimlane or by history rows; `rowKeyForSequence(n)` and `spanForSequence(n)` maps built from `spans[].sequenceNumbers`.
3. `header.childrenCount = children?.children.length`, `header.historyRows = spans?.historyRows`.
Accept:
- [ ] Hovering a history row with `SequenceNumber 5` sets `hover` to the activity span whose `sequenceNumbers` contain 5.
Test: unit.

### E8-S2 Timeline tab

#### E8-S2-T1 spans-to-lanes mapping
Files: `src/lib/instance/timeline-lanes.ts`, tests
Depends: E8-S1-T1, E1-S8-T4
Do:
1. Lane order and grouping (design §8, mockup L300–L310): lane 0 = the orchestrator (`label` = orchestrator name) with one thin `bar orch` per orchestrator episode (`kind: 'orchestrator'`) and `now: true` when the instance is not terminal; then one lane per activity/sub-orchestration name in order of first start; retries (`attempt > 1`) go in the same lane as numbered segments (`text` `retry {attempt}` when wide) and the lane label becomes `{name}` (the mockup's `ChargePayment (retry 2)` label form is used when a name has exactly one span per attempt and attempts > 1: label `{name} (retry {attempt})` on separate lanes; implement: separate lanes per attempt when the attempt spans overlap in time, same lane otherwise); timers → lane `label` "retry backoff" when the timer sits between two attempts of the same activity, else "timer", class `st-suspended`, text `fmtDuration`; `eventWait` → lane `wait {name}` (or "wait for external event" when the name is unknown), class `wait`, text `waiting {fmtDuration}` while open; `externalEvent` (raised) → a 1 % marker bar on the wait lane; sub-orchestrations → lane `{name} (sub)`, class by status; `status: 'failed'` → `st-failed` with text `{reason-short} {fmtDuration}` where reason-short is the first word of the failure details (`timeout`, mockup L304) — take the first 12 characters of `Details`.
2. Domain: `executionStartedAt` → `max(executionEndedAt, now)`; ticks 6 with `fmtTime`.
3. Each bar carries `key = span.id`, `title` from status + duration, `sequenceNumbers`.
Accept:
- [ ] The spans fixture (built from the mockup history) yields nine lanes matching L301–L309 labels in order.
Test: table-driven unit test.

#### E8-S2-T2 TimelineTab
Files: `src/lib/instance/TimelineTab.svelte`, tests
Depends: E8-S2-T1, E5-S3-T2
Do:
1. L88–L118: `Swimlane` (highlightKey = `hover`, `onLaneEnter` sets `hover`), legend row (activity, failed, running, timer, waiting for event (dotted), orchestrator replay (ink)) + meta "hover a span to find its history rows"; then the history table reused from E5-S3-T2 in "linked" mode: no rail, columns `#`, Timestamp, EventType (+input tag), Name, Duration, Result / Details; rows get `hl` when `spanForSequence(row.SequenceNumber)?.id === hover`; `onRowEnter` sets `hover` to that span; clicking a row scrolls the lane into view (`scrollIntoView` on the lane element). Footer: meta `{loaded} of {spans.historyRows} events · SequenceNumber from the provider` + ghost `Open History tab`.
2. Missing `spans` capability → the tab is not offered (E5-S3-T1).
Accept:
- [ ] Hovering the `TaskFailed` row highlights the failed bar and vice versa.
Test: component test.

### E8-S3 Summary column

#### E8-S3-T1 WhereTheTimeWent
Files: `src/lib/instance/WhereTheTimeWent.svelte`, tests
Depends: E8-S1-T1
Do:
1. `Panel "Where the time went"` meta `/spans · {fmtDuration(totals.totalMs)}` (L58); `<div class="wbar">` with one `<i>` per kind in order activities (`st-completed`), external event (`wait` hatch), timers (`st-suspended`), orchestrator (`orch`), sub-orchestrations (`st-running`), widths as percentages of `totalMs` (skip zero kinds; a kind under 1 % gets `min-width: 2px`); `Kv` three columns: swatch + kind, `fmtDuration(ms)`, `fmtPct`. The orchestrator row is hidden when `orchestratorMs` is null (provider without episode markers).
Accept:
- [ ] Totals fixture renders four rows with percentages summing to 100 (±1).
Test: as above.

#### E8-S3-T2 ChildrenPanel and ExecutionPanel values
Files: `src/lib/instance/ChildrenPanel.svelte`, `src/lib/instance/ExecutionPanel.svelte` (extend), tests
Depends: E8-S1-T1
Do:
1. `ChildrenPanel` (L74–L76): `Panel "Children"` meta `/children · {complete ? 'complete' : 'partial'}`; one row per child: mono link (→ instance route) + `StatusChip sm`; empty → meta "No sub-orchestrations found"; hidden when the capability is missing.
2. `ExecutionPanel`: executionId (mono; `spans.executionId ?? '—'`), generation (`spans.generation ?? '—'`), history `{historyRows} rows · {fmtBytes(historyBytes)}` (bytes part only when not null), large blobs (`largeMessageBlobs ?? '—'`), tags.
3. The header's `children: n` link switches to the Summary tab on narrow screens (L28, L429) and otherwise scrolls the Children panel into view.
Accept:
- [ ] Renders the children fixture with status chips.
Test: as above.

### E8-S4 Peek mini timeline

#### E8-S4-T1 PeekTimeline over spans
Files: `src/lib/shell/PeekTimeline.svelte` (extend), tests
Depends: E8-S2-T1, E2-S4-T1
Do:
1. When `capabilities.spans`, the peek loads `spans(id)` on open (cancellable, once) and renders the first four lanes from `timeline-lanes.ts` in a compact swimlane (`min-width: 0; padding: 10px`, L172–L178); otherwise the single created→updated bar from E2.
2. `history` in the peek summary becomes `{historyRows} rows · {fmtBytes}` from spans.
Accept:
- [ ] Peek of the running instance shows four lanes; peek of an entity shows none.
Test: as above.

### E8-S5 End-to-end

#### E8-S5-T1 Timeline e2e spec
Files: `tests/e2e/timeline.spec.ts`
Depends: E8-S2, E8-S3, E8-S4, B2
Do:
1. Open the running instance: Timeline tab is the default, nine lanes render, hovering the `retry 2` lane highlights the `TaskFailed` row, the Summary shows four "where the time went" rows and the child `NotifyCustomer` with a Running chip, the header shows `children: 1`; the peek from Instances shows the mini timeline.
Accept:
- [ ] Green.
Test: itself.
