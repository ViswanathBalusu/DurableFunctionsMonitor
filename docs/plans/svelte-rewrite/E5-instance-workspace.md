# E5 · Instance workspace

Goal: `ScreenInstance.dc.html` for one instance: header with actions and confirm dialogs, tabs, History, Raw, the Inputs tab with all its interlocks and recovery dialogs, Sequence, Graph, custom Liquid tabs, and the Summary column without the parts that need `/spans` and `/children` (those come in E8). This replaces the React details page and ships the input-event operations UI.

Prerequisites: E0–E4 (dialog and table components, peek, toasts). Read contracts §6 (input events DTOs), §9, §10, §11; `dfm-design-system.md` §9 (Inputs tab rules, verbatim copy), `dfm-rewrite-plan.md` §4.3; mockup `ScreenInstance.dc.html` (all); React `states/details-view/*.ts`; `docs/plans/input-events-restart-rewind-replay.md` §4, §11.

Exit criteria: the workspace opens for orchestrations and entities, every action works against the seeded hub, the Inputs tab renders eligibility exactly as the backend reports it, all three operations and all five outcome paths are covered by e2e specs (200, 409, 413, 403, 500 recovery).

### E5-S1 State

#### E5-S1-T1 instance.svelte.ts
Files: `src/lib/state/instance.svelte.ts`, `src/lib/state/instance-history.svelte.ts`, tests
Depends: E2-S6-T2, E0-S2-T4
Do:
1. `InstanceState(app, instanceId)`: `details: OrchestrationDetails | null`, `isEntity`, `functionMap` (loaded once per hub when `host.functionGraphAvailable`), `tabs` (E5-S3-T1 rules), `tab` (from `?tab`, default `timeline` when available else `history`; ≤ 1100 px `summary` is allowed), `loadDetails()` (React `loadDetails` without the history reset side effects), `refreshAll()` = details + history first page + inputs (if loaded) + spans/children (E8 hooks), `autoRefresh` timer from `prefs.autoRefresh.instance` (reload details and the first history page; never while a request is in flight), `busy` for actions.
2. `InstanceHistoryState`: `rows`, `skip`, `hasMore`, `timeFrom` (from `?timeFrom`), `pageSize 200`, `load(reset)`, `loadMore()`, `setTimeFrom(iso | null)` (writes the query with `pushState` so Back works, React `writeFilterToQueryString`). Filter clause from `buildHistoryFilter`.
3. Actions (each: `busy = true`, call, toast, `refreshAll()`, `busy = false`; errors → `toast.fromError('Failed to <verb>', err)`): `suspend(reason)`, `resume(reason)`, `rewind(reason)`, `terminate(reason)`, `purge()` (then navigate to Instances, toast `Purged {id}`), `restart(withNewId)`, `raiseEvent(name, data)` (entities: same endpoint = signal), `setCustomStatus(json | null)`.
4. `liveDuration` getter: terminal statuses use `lastUpdatedTime - createdTime`; others `now - createdTime` with `now` ticking every second while the screen is mounted (component effect updates `app.now`).
Accept:
- [ ] `loadDetails` for `@counter@warehouse-07` sets `isEntity` and tabs `history, raw` (+ custom).
- [ ] `purge` navigates to `/instances` after success.
Test: unit with fake endpoints.

**Deviation, E5-S1-T1 (2026-09-05).** Three things the plan leaves open. (1) `app.now` did not exist:
the live clock is one field on the app, ticked by whichever screen is watching it, so nothing
re-renders for a clock nobody is looking at. (2) The Timeline tab is gated on `!isEntity` as well as
`capabilities.spans` - an entity has no orchestrator span tree, and E5-S3-T1 accepts "entity shows
only History, Raw and custom tabs" unconditionally. (3) `summary` is not in `tabs`: it is the column
next to every tab and only becomes a tab of its own below 1100 px (by CSS), so it is always a legal
`?tab` value and never a body - which is what the accept criterion's `history, raw` means.
Follow-up, not this task: the suspend/resume/rewind/terminate reason goes through
`client.post` -> `JSON.stringify`, so the backend (which takes the raw body as the reason) sees it
quoted. React sent it raw through axios. The fix belongs in the client, next to E4's `fanOut`, which
has the same behaviour.

#### E5-S1-T2 Shared action confirms (app.actions)
Files: `src/lib/instance/actions.svelte.ts`, `src/lib/instance/ActionDialogs.svelte`, tests
Depends: E5-S1-T1, E1-S4-T2
Do:
1. `app.actions.open(kind, target: { id, name, status, isEntity })` where `kind` ∈ `suspend|resume|raise|custom|restart|rewind|terminate|purge|signal`; `ActionDialogs.svelte` is mounted once in the shell and renders the open dialog, so the peek panel, the palette and Failures rows reuse the same dialogs.
2. Definitions from L356–L362 verbatim: terminate (band, reason, destructive "Terminate"), purge (band, destructive "Purge instance"; body mentions history row count when known and "The sub-orchestration {name} is not purged" only when children are known (E8), otherwise "Removes the instance, its history and its large-message blobs."), rewind (band, reason, primary "Rewind"; body L358), raise (event fields, primary "Raise event"; body L359; Event name gets a `datalist` of `eventNames` derived from the function map's `isSignalledBy` entries, React `eventNames`), custom (`JsonEditor` prefilled with `formatJson(details.customStatus)`, empty allowed = clear; primary "Set customStatus"; body L360), restartPlain (checkbox "Start with a new instance id" default checked, React parity; primary "Restart"; body L361), suspend/resume (reason; primary; bodies L362), signal (entities: "Send signal to {key}" with Signal name + Signal data JSON, Entities L64–L66).
3. On confirm the dialog calls the matching `InstanceState` action when the target is the open instance, or a lightweight one-off action module (`src/lib/instance/one-off-actions.ts`) for rows opened from a list, then `app.refresh()`.
Accept:
- [ ] Opening `raise` from the peek and confirming posts `{ name, data }` and toasts `Raise event sent for {id}`.
- [ ] `custom` with an empty editor posts an empty body (clears the status).
Test: as above.

**Deviation, E5-S1-T2 (2026-09-05).** The accept criterion "posts an empty body" was a defect, not a
description: `endpoints.setCustomStatus(id, null)` went through `client.post` -> `JSON.stringify`,
putting the four characters `null` on the wire, and the backend parses the body as a JSON object
(`JObject.Parse("null")` throws). React sent nothing at all - axios drops a null body - so the
endpoint now maps null to no body, and its test says why.
Three things the plan leaves open. (1) The purge wording for an entity is the Entities screen's own
(ScreenEntities.dc.html L102, "Removes the entity row and its history…", confirm "Purge entity"),
since the workspace of an entity offers Send signal and Purge alone; the sub-orchestration line has
a plural form for when E8 reports more than one child. (2) The signal toast is `Signal sent to
{key}` rather than the mockup's `{confirm} sent for {id}` rule, which would read "Send signal sent
for". `InstanceState.raiseEvent` therefore takes an optional message - the endpoint is the same one,
only what it is called changes. (3) `one-off-actions.ts` and `InstanceState` share one copy table
(`ACTION_CONFIRM`, `ACTION_VERBS`, `actionToast`) so the same action cannot say two different things
depending on where it was started from.

### E5-S2 Header

#### E5-S2-T1 InstanceHeader
Files: `src/lib/instance/InstanceHeader.svelte`, tests
Depends: E5-S1-T1, E1-S2-T1
Do:
1. Breadcrumb L18: `LinkButton meta "Instances"` → instances route, muted `/`, mono muted id.
2. `<header class="hero">` L19–L41: `tile st-*` 96 px with the status text, `<br>`, mono 600 `fmtDurationClock(liveDuration)`; `<h1>{id}</h1>`; `hmeta`: bold name (entities: entity name), mono `created {fmtDateTime(created)} {UTC|Local}`, mono `updated {fmtAgo(lastUpdated)}`, `parent: {LinkButton mono parentInstanceId | none}`, `children: {LinkButton mono n}` (E8; hidden until `children` loads), mono `history {n} rows` (`n` = loaded history rows with `+` when `hasMore`; E8 replaces with `spans.historyRows`).
3. Actions (E5-S2-T2) in the third grid column.
Accept:
- [ ] Running instance's clock advances between two ticks (fake timers).
- [ ] Entity header shows the entity name and no parent line.
Test: as above.

#### E5-S2-T2 Action buttons
Files: `src/lib/instance/InstanceActions.svelte`, tests
Depends: E5-S1-T2
Do:
1. Orchestrations (L33–L39): `Suspend`/`Resume` (label by status `Suspended`), `Raise event`, `Set customStatus`, `Restart`, `Rewind` (disabled unless status `Failed`; `title` "Re-run the failed steps" / "Rewind is available for failed instances"), `Terminate` destructive, `Purge` destructive. All disabled in read-only (with `title` "Read-only mode").
2. Entities: `Send signal`, `Purge` destructive.
3. Each opens `app.actions.open(kind, target)`.
Accept:
- [ ] Failed instance enables Rewind; Completed disables it with the title text.
Test: as above.

### E5-S3 Tabs, History and Raw

#### E5-S3-T1 Tab strip
Files: `src/lib/instance/WorkspaceTabs.svelte`, `src/routes/Instance.svelte`, tests
Depends: E1-S4-T1, E5-S1-T1
Do:
1. Tabs in order (L43–L50): `Summary` (`summary-tab`, only visible ≤ 1100 px by CSS), `Timeline` (only when `capabilities.spans`; E8), `History`, `Inputs (n)` (orchestrations only; `n` from `inputs.events.length` once loaded, plain `Inputs` before), `Sequence` (orchestrations), `Graph` (when `host.functionGraphAvailable` and the instance's function name is a key of the function map, case-insensitive, React rule), `Raw`, then one tab per `details.tabTemplateNames`.
2. Controls snippet: auto-refresh `Select` (Never / Every 1 sec. / Every 5 sec. / Every 10 sec.) bound to `prefs.autoRefresh.instance`, `Refresh` ghost sm (L52–L53).
3. `<div class="ws" data-tab={tab}>` with `<aside class="summary">` (E5-S9) and `<div class="tabbody">` switching on the tab.
4. `?tab=` sync; `?seq=` handled by the Inputs tab.
Accept:
- [ ] Entity instance shows only History, Raw and custom tabs.
- [ ] Tab change updates the URL and survives reload.
Test: as above.

#### E5-S3-T2 History tab
Files: `src/lib/instance/HistoryTab.svelte`, `src/lib/instance/history-columns.ts`, `src/lib/instance/history-spine.ts`, tests
Depends: E5-S1-T1, E1-S5-T1, E1-S3-T3
Do:
1. Rail L121–L126: `Field "From"` `DateTimeField` (seconds granularity; enabled through its checkbox, default off; enabling seeds it with the first loaded row's timestamp, React `timeFromEnabled`), `Field "Till"` disabled field with placeholder `now` and `title` "The backend filters history from a start time only", `Apply` (calls `setTimeFrom`), trailing meta `{rows.length} events shown{hasMore ? ' so far' : ''}`.
2. Table (`DataTable` `keep`): spine from `history-spine.ts` (`TaskCompleted`/`SubOrchestrationInstanceCompleted`/`ExecutionCompleted` → Completed (ExecutionCompleted → Failed when details status is Failed), `TaskFailed`/`SubOrchestrationInstanceFailed` → Failed, `TimerFired` → Suspended, `SubOrchestrationInstanceCreated`/`TaskScheduled` → Running, `GenericEvent` whose `Details`/`Result` starts with `Rewound:` → ContinuedAsNew, else none); columns `#` (mono `SequenceNumber ?? ''`), `Timestamp` (mono `fmtTimeMs`), `EventType` (+ `Tag "input"` for `ExecutionStarted`/`EventRaised` → `tab=inputs&seq=<SequenceNumber>`), `Name` (mono), `ScheduledTime` (mono `fmtTimeMs` or empty), `Duration` (mono `fmtDuration(DurationInMs)` or empty), `Result / Details` (`JsonCell` over `Result ?? Details`, `trunc`; opens `JsonDialog` titled `{EventType} · {Name || '#'+n}` subtitle `#{n} · {fmtTimeMs}`).
3. Footer L145: meta "Rewound rows arrive as GenericEvent with a “Rewound:” reason and the continued spine." + `Load more` (hidden when done).
Accept:
- [ ] Rows carry `data-st` per the spine rules (table-driven test over the fixture history).
- [ ] The `input` tag navigates to the Inputs tab with `seq`.
Test: as above.

#### E5-S3-T3 Raw tab
Files: `src/lib/instance/RawTab.svelte`, tests
Depends: E1-S6-T3
Do:
1. `JsonViewer` of `details` with the menu bar on (`brutal-flat` wrapper, L228–L245), below it a right-aligned `Copy to clipboard` button (toast "Copied the instance status JSON").
Accept:
- [ ] Renders every key of the details fixture expanded.
Test: as above.

### E5-S4 Inputs tab

#### E5-S4-T1 inputs.svelte.ts
Files: `src/lib/state/inputs.svelte.ts`, tests
Depends: E5-S1-T1, E1-S6-T1
Do:
1. `load()`: `inputEvents(id)` → `response`; `cards: { event, text (formatJson(input)), stored (same), edited (text !== stored), bytes (utf16Bytes(text)), over (bytes > MAX_INLINE_BYTES), editable (some operation allowed and not readOnly) }[]`; `warning` = first `operations[*].warning` found (render once); `noSequenceNumbers` = every event has `sequenceNumber === null`.
2. Button model per card and operation (`restart-in-place`, `update-input-and-rewind`, `replay` in that order, only for operations present in `event.operations`): `{ label, variant ('danger' for the two dangerous, 'default' for update), disabled, why }` where `disabled = readOnly || over || !allowed`, `why = readOnly ? 'Read-only mode' : !allowed ? reason (verbatim) : over ? 'Input is larger than 60 KB' : description` with descriptions "Replaces this input and re-runs only the failed steps." / "Deletes history after this event and runs everything after it again." / "Purges this instance and starts it again with the input shown." and labels "Restart in place", "Update input and rewind", `Replay from #{n}` (L184–L185, design §9).
3. Operations: `run(op, card, { reason?, terminateIfRunning? })` builds the request (`sequenceNumber` exactly as received; `input` = parsed editor text only when `edited`, else omitted for replay/restart and the stored value for update), calls the endpoint, and resolves an outcome object for E5-S4-T4. `reset(card)` restores the stored text.
Accept:
- [ ] Eligibility matrix test: for each row of `InputEventEligibilityTests` in `tests/durablefunctionsmonitor.dotnetisolated.core.tests/InputEventEligibilityTests.cs` (encode the expected `allowed`/`reason` in a fixture), the button model matches.
- [ ] Editing to 70 KB sets `over` and disables all buttons with the size reason.
Test: as above.

#### E5-S4-T2 InputsTab and InputEventCard
Files: `src/lib/instance/InputsTab.svelte`, `src/lib/instance/InputEventCard.svelte`, tests
Depends: E5-S4-T1, E1-S6-T3, E1-S2-T2
Do:
1. Tab header L149–L156: left column (max-width 70ch) `<h2>` "Inputs this instance received" + `<p>` "Instance is {StatusChip sm}. Edit the last input and rewind, replay from it, or restart from the initial input. Sequence numbers are the concurrency token; the list reloads after each run."; right: `DangerBadge` when `app.dangerous`, else `Chip` muted "Dangerous operations off". No mock select (README D11).
2. Notes: read-only `<div class="note">` L157; sub-orchestration warning as a `note` with the warning text verbatim; `noSequenceNumbers` → `note` with the backend reason and no cards' buttons; empty events → meta "No inputs recorded for this execution yet."
3. `InputEventCard` L158–L188: `card icard`, `head` (`seq` `#{n}` or `#?`, `ev` event type, mono name, `Chip sm` "last" with accent background when `isLast`, `when` `fmtDateTimeMs`), `bodyrow`: left `JsonEditor` (readOnly when not editable; footer: `Chip st-running sm "edited"` or text `stored input` / `read only · {size}`; `SizeMeter`; `Reset to stored` ghost 24 px when edited), right `ops` column with one `op` block per operation (`Button` full width + `why` text).
4. `?seq=` scrolls the matching card into view and focuses its editor.
Accept:
- [ ] Two-event fixture renders the first card read-only with both reasons and the second card editable with `Update input and rewind` enabled and `Replay from #27` styled `danger`.
- [ ] `dangerous=false` renders the "off" chip and the replay button disabled with the DFM_DANGEROUS_OPERATIONS_ENABLED reason.
Test: as above.

**Deviation, E5-S4-T2 (2026-09-05).** The E1 fixture `tests/unit/fixtures/input-events.ts` described
an answer the backend cannot give: an instance with a raised event whose `ExecutionStarted` could
still be restarted in place and rewound (`InputEventEligibility.cs` refuses both once
`hasRaisedEvents`), with invented reason strings. It is now a *failed* instance with one raised
event - the case the tab exists for, and the one this task's accept criterion describes - with every
verdict and every reason taken from the backend; `runningInputEvents()` is the running variant,
which is where `requiresTerminate` comes from. The reason strings live in
`tests/unit/fixtures/input-eligibility.ts` so the two fixtures cannot drift apart.
The mockup's L188 line ("Buttons never disappear because of eligibility…") is a note to the reader
about the mockup, not product copy, and is not rendered.

#### E5-S4-T3 Operation confirm dialogs
Files: `src/lib/instance/InputOpDialog.svelte`, `src/lib/instance/input-op-copy.ts`, tests
Depends: E1-S4-T2, E5-S4-T1
Do:
1. `input-op-copy.ts` produces title, body, band, confirm label, extra controls per design §9 table and L353–L355: Update input and rewind (no band; body "Replaces the input of event #{n} ({name}) and rewinds the instance {with your edited input|with the stored input}. Only the failed steps run again and see the new input. Completed steps keep their results."; `ReasonField`; confirm "Update and rewind" primary), Replay (band; body "Deletes history from event #{n} onward, reopens the instance and raises {name} again {with…}. Every step after the event runs again, including activities that already completed."; when `requiresTerminate`: required `Checkbox` "Terminate the running instance first (waits up to 30 seconds)" + meta "Late messages from the previous run can still reach the replayed instance."; confirm `Replay from #{n}` `danger`, disabled until the checkbox is checked), Restart in place (band; body L355; confirm "Purge and restart" `danger`).
2. When edited: the body says "with your edited input" and the dialog shows the first six lines of the payload in an `ed` `pre` (L263); unchanged: "with the stored input" (restart/replay) and no preview for update when unchanged? Design §9: show the preview whenever edited.
Accept:
- [ ] Replay with `requiresTerminate` keeps Confirm disabled until checked and sends `terminateIfRunning: true`.
Test: as above.

#### E5-S4-T4 Outcomes and recovery dialogs
Files: `src/lib/instance/RecoveryDialog.svelte`, `src/lib/instance/input-outcomes.ts`, tests
Depends: E5-S4-T3, E4-S7-T1, E5-S1-T2
Do:
1. `input-outcomes.ts` maps results and errors to actions (design §9 "Outcomes"): 200 → `toast.ok` with the backend numbers: update "Rewound with the updated input. Details, history and inputs reloaded.", replay `Replayed from #{n}, {deletedRows} history rows removed. {eventName} raised again.`, restart "Restarted in place. New ExecutionId; history is short again." then `refreshAll()`; 409 → reload inputs first, then `toast.error('The list was refreshed. ' + message)`; 413 → `toast.error('Input is larger than 60 KB. Shorten it and try again.')`; 403/400 → `toast.error(message)`; 500 with a recovery body (detect by shape: `purged`/`raised === false`/`inputUpdated`) → `RecoveryDialog`; other 5xx → error toast.
2. `RecoveryDialog` (band, L363–L365): restart → title "The instance was purged but could not be restarted", body "Start it again with the input below. The purge removed the history and large-message blobs of {id}.", payload preview, primary "Start new instance with this input" (opens `app.dialogs.startNewInstance.openWith({ instanceId, orchestrator: orchestratorName, input })`), secondary "Copy input", Close; replay → title "History was cut and the instance reopened, but {eventName} was not raised", body `{deletedRows} rows were removed after event #{n} and the instance is Running again. Raise the event now so the replay continues.`, primary "Raise event now" (opens `app.actions.open('raise', target)` prefilled with `eventName` and input), Close; update → title "The input was updated but the rewind failed", body "Event #{n} now carries the new input. Rewind the instance to run the failed steps with it.", primary "Rewind" (opens `app.actions.open('rewind')`), Close.
3. `app.actions.open('raise', target, { prefill: { name, data } })` support added in E5-S1-T2 (prefill props).
Accept:
- [ ] Each of the five outcome paths is unit tested with a fake endpoint returning the mapped status/body.
Test: as above.

**Deviation, E5-S4-T4 (2026-09-05).** Two corrections to the plan's shape rules, both from
`Functions/InputEvents.cs`. (1) `purged` is the *200* body of restart-in-place, not its 500: the
recovery is `{ error, orchestratorName, instanceId, input }`, so it is detected by
`orchestratorName`. (2) A recovery payload is looked for before the status is read, because the
failed rewind comes back as **409** when the runtime refuses it and 500 when it throws - the same
half-finished operation either way, and answering the 409 one with "The list was refreshed" would
lose the recovery. The workspace also registers a Start new instance dialog of its own
(`app.dialogs.startNewInstance`, as the Instances screen does), because the restart recovery opens
exactly that dialog and the Instances screen is not on screen here.

### E5-S5 Sequence tab

#### E5-S5-T1 sequence-model.ts
Files: `src/lib/instance/sequence-model.ts`, tests
Depends: E0-S2-T4
Do:
1. Port `SequenceDiagramTabState.getSequenceForOrchestration` into a data model: `participants: string[]` (external actor `.` first, then the orchestrator, then activities/sub-orchestrators in order of first appearance), `messages: { t: iso, from, to, label, kind: 'call'|'return'|'failed'|'external'|'self'|'terminated', note? }[]`, parallel-call aggregation (`par n calls`) and sub-orchestration recursion through `loadHistory(subId)` (bounded to 10 nested loads, failures render `[FailedToLoad]`).
2. `toMermaid(model)` reproduces the React mermaid text (for "Copy diagram code to clipboard").
Accept:
- [ ] Fixture history (L311–L325) yields the ten messages of L327–L336 in order with the right kinds.
- [ ] `toMermaid` output starts with `sequenceDiagram` and contains `par 2 calls` for two parallel `ChargePayment` schedules at the same second.
Test: as above.

#### E5-S5-T2 SequenceDiagram and Sequence tab
Files: `src/lib/charts/SequenceDiagram.svelte`, `src/lib/instance/SequenceTab.svelte`, tests
Depends: E5-S5-T1, E1-S8-T1
Do:
1. HTML/CSS render per dfm-ui.css L320–L334 and mockup L192–L198: `.seq > .seq-in` with `.parts` (first cell empty, one `.part` per participant, orchestrator gets `n-orchestrator`), `.life` lines positioned per participant column (160 px each after a 90 px gutter), one `.smsg` row per message with `.t` timestamp and `.arrow` (`back` for returns, `failed` for failures, self messages as a 60 px loop to the left), label centred. Column positions computed as `170 + 160 * index`.
2. Footer row: `Copy diagram code to clipboard` ghost (toast "Copied the sequence diagram source") and `Save as SVG` (`toSvg()` builds an equivalent SVG: boxes, dashed lifelines, arrows with square heads, mono labels).
Accept:
- [ ] Renders the fixture's participants and arrows; failed arrow has class `failed`.
Test: as above.

### E5-S6 Graph tab

#### E5-S6-T1 function-graph-model.ts and layout
Files: `src/lib/graph/function-graph-model.ts`, `src/lib/graph/layout.ts`, tests
Depends: E0-S2-T4
Do:
1. Node kinds from bindings (port of `az-func-as-a-graph.core/dist/buildFunctionDiagramCode.js` classification): `orchestrationTrigger` → `orchestrator` (or `suborchestrator` when `isCalledBy` is non-empty), `activityTrigger` → `activity`, `entityTrigger` → `entity`, trigger `httpTrigger` → `http`, `timerTrigger` → `timer`, `queueTrigger`/`serviceBusTrigger`/`eventHubTrigger`/`eventGridTrigger`/`kafkaTrigger` → `queue`, anything else → `other`. Kind labels: "Orchestrator", "Sub-orchestrator", "Activity", "Entity", "HTTP trigger", "Timer trigger", "Service Bus trigger"/"Queue trigger"/"Event Hub trigger"/"Event Grid trigger"/"Kafka trigger", "Function" (Functions L83–L94).
2. Edges: `isCalledBy` (caller → function, solid step), `isSignalledBy` (label = signal name, solid), `isCalledByItself` (self loop labelled "ContinueAsNew"), input bindings (binding node → function, dashed), output bindings (function → binding node, dashed), other bindings (dashed, no arrow). Binding nodes: kind `other`, name from `getBindingText` (port; without the `#32;` spaces), id `${fn}.binding${i}`. Proxies rendered as `other` nodes with the proxy route as name (rare; keep simple).
3. `layout(nodes, edges)`: dagre `rankdir LR`, `ranksep 48`, `nodesep 16`, node size 190 × (92 with metrics, 66 without); returns positioned nodes.
Accept:
- [ ] The fixture map from `dfm-design-system.md` §11 (StartOrder http → ProcessOrderOrchestrator → ReserveInventory…) yields nodes with the expected kinds and 10 edges (Functions L96).
- [ ] Layout puts triggers in rank 0, orchestrators rank 1, activities rank 2 (x increases).
Test: as above.

#### E5-S6-T2 FunctionGraph (Svelte Flow)
Files: `src/lib/graph/FunctionGraph.svelte`, `src/lib/graph/FunctionNode.svelte`, `src/lib/graph/graph-svg.ts`, `src/styles/dfm-ext.css` (edge and handle tweaks), tests
Depends: E5-S6-T1, E1-S2-T2
Do:
1. `@xyflow/svelte` `SvelteFlow` with `nodeTypes = { dfm: FunctionNode }`, edges `type: 'smoothstep'` with `pathOptions: { borderRadius: 0 }`, `markerEnd` arrow closed filled ink (edge stroke through the `.svelte-flow` bridge vars), `fitView`, `Controls` (+ − ▢ styled `.gctl` through `dfm-ext.css`), `MiniMap` (`.minimap` look), `Background` dots. Wrapper `<div class="graph" style="height:{height}px">`.
2. `FunctionNode` reproduces L54–L59: `<div class="node n-{kind} sel?"><div class="band"></div><div class="body"><div class="kind">{kindLabel}{suffix}</div><div class="name">{name}</div>{metrics? <div class="metrics">MiniCounter×3</div>}</div></div>` with `Handle`s left/right hidden. `title` "Click to filter the table · double-click opens the code in VS Code (GotoFunctionCode)".
3. Props: `model`, `selected` (bindable), `metrics: Record<name, { completed, running, failed }>`, `activePath: Set<edgeId>` (edges get class `active` → ring colour, 3 px), `kindSuffix: (name) => string`, `onSelect(name)`, `onOpenCode(name)` (double-click → `client.host.gotoFunctionCode` in VS Code; no-op in the browser).
4. `graph-svg.ts`: `graphToSvg(model, positions, options)` pure SVG (rect node cards with the band, mono text, step polylines and square arrowheads) using `tokenColor`; used by `Save as SVG` (`{hub}-functions.svg`, `{instanceId}.svg`).
Accept:
- [ ] Renders the fixture with 12 nodes; clicking a node calls `onSelect`; `activePath` edges get `active`.
- [ ] `graphToSvg` output contains one `<rect>` per node and passes `looksLikeSvg` (no script).
Test: as above (Svelte Flow renders in jsdom with `ResizeObserver` mocked; if it does not, test the model/svg and mark the render test `@e2e`).

#### E5-S6-T3 Instance Graph tab
Files: `src/lib/instance/GraphTab.svelte`, `src/lib/instance/graph-path.ts`, tests
Depends: E5-S6-T2, E5-S1-T1
Do:
1. `graph-path.ts`: from the loaded history compute per function `{ calls, failed, running, reached }` (`TaskScheduled` +1 call/running, `TaskCompleted` completes, `TaskFailed` +1 failed, `SubOrchestrationInstanceCreated/Completed/Failed` likewise) and the active edge set (this orchestrator → each called function, and the trigger → orchestrator edge); kind suffix per L215–L220: this instance's orchestrator " · this instance", `" · {calls} call(s), {failed} failed"` / `" · running"` / `" · not reached"`.
2. Tab L202–L225: `FunctionGraph` height 440 with the active path and suffixes; metrics on the orchestrator node from `stats.byName` when `capabilities.stats` (E7 helper), else none; footer meta "The ring-colored path is what this instance actually called. Click a function to open its code in VS Code." + `Save as SVG` + `az-func-as-a-graph` ghost (opens https://github.com/scale-tone/az-func-as-a-graph in a new window through `client.host.openInNewWindow` semantics: browser `window.open`, VS Code `OpenInNewWindow` is instance-only so use `vscode.env.openExternal` is unavailable; in VS Code render the link as text).
Accept:
- [ ] Fixture history marks ReserveInventory/ChargePayment/NotifyCustomer reached and SendConfirmation/Counter not reached.
Test: as above.

### E5-S7 Custom Liquid tabs

#### E5-S7-T1 LiquidTab
Files: `src/lib/instance/LiquidTab.svelte`, tests
Depends: E5-S1-T1
Do:
1. On activation `POST custom-tab-markup('{name}')` (cancellable; auto-refresh reloads it, React `loadCustomTab`), render the HTML with `{@html}` inside `Panel` titled with the tab name and meta `Liquid template · custom-tab-markup('{name}')` (L249–L252). Errors → toast "Failed to load tab".
2. Comment in the file: templates come from the hub's own storage account and were rendered the same way by the React app; do not sanitize away the intended markup.
Accept:
- [ ] Markup from the fake endpoint appears inside the panel.
Test: as above.

### E5-S8 Summary column (without spans and children)

#### E5-S8-T1 SummaryColumn
Files: `src/lib/instance/SummaryColumn.svelte`, `src/lib/instance/FieldsPanel.svelte`, `src/lib/instance/ExecutionPanel.svelte`, tests
Depends: E1-S6-T2, E5-S1-T1
Do:
1. `<aside class="summary">` L56–L86: `WhereTheTimeWent` slot (E8; hidden until then), `FieldsPanel`, `ChildrenPanel` slot (E8), `ExecutionPanel`.
2. `FieldsPanel` L67–L73: `Panel "Input"` with ghost sm `open` (JsonDialog with `downloadField input`) and `JsonPre transparent wrap maxHeight=96`; `Output` header with meta `none yet` when null else ghost `open`; `customStatus` header with ghost `edit` (opens `app.actions.open('custom')`, disabled read-only) and `JsonPre`. Entities: a single `State` panel with `JsonPre` of the entity state and `open`.
3. `ExecutionPanel` L77–L84: `Kv` executionId (E8, `—` until then), generation (E8), history `{rows} rows{ · bytes}` (bytes E8), large blobs (E8), tags (`Chip sm` per `details.tags` entry `key:value`; hidden when absent, B0 adds tags).
Accept:
- [ ] Input pre shows the pretty-printed fixture input; `open` opens the dialog with the download button.
Test: as above.

### E5-S9 End-to-end

#### E5-S9-T1 Workspace e2e specs
Files: `tests/e2e/instance.spec.ts`, `tests/e2e/inputs.spec.ts`
Depends: E5-S1..S8
Do:
1. `instance.spec.ts`: open the running seeded instance: header status tile, hmeta, tabs; History shows 13 rows with `#` values and the two `input` tags; Raw shows expanded JSON; Sequence renders participants; Graph tab present only when a function map is served (skip otherwise); Set customStatus round trip; Suspend then Resume with reason; Terminate the running instance (seeded copy) and see the tile change; Purge navigates to Instances.
2. `inputs.spec.ts` (needs `DFM_DANGEROUS_OPERATIONS_ENABLED=true` in the host): failed instance without raised events → card #1 editable with Restart in place enabled; edit and Update input and rewind → toast "Rewound with the updated input"; failed instance with raised events → last card editable, first card disabled with the "external events" reason; Replay from the last event → toast with "history rows removed"; 409 path: seed, load the tab, mutate the history through the seed script's `--bump` mode (appends an `EventRaised` row), submit → toast starts with "The list was refreshed."; 413 path: paste a 70 KB string → meter `over`, buttons disabled; dangerous off (`DFM_DANGEROUS_OPERATIONS_ENABLED=false` project) → replay disabled with the env-var reason.
Accept:
- [ ] Both specs green locally and in CI (two Playwright projects for the dangerous on/off hosts; the off project runs a second host on port 7073 via the runner's `--port` and `--dangerous=false` flags).
Test: themselves.
