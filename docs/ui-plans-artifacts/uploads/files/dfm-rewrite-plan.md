# Durable Functions Monitor: rewrite plan

Information architecture, screens and backend additions for a new product on the same data. Companion to `dfm-design-system.md` (tokens, components, themes) and `dfm-migration-plan.md` (build contract, hosting, phases). Backend facts below were checked against `ViswanathBalusu/DurableFunctionsMonitor` `main`.

## 1. Direction

The current app is one list and one details page with tabs, shaped by what the API returns. The rewrite is shaped by what an operator does with a task hub. Three jobs, in the order they happen on a bad day:

1. Know: is the hub healthy right now, what is stuck, what is failing, is there a backlog.
2. Find: get to the one instance among thousands, or to the group of instances that share a failure.
3. Fix: act on one instance or on a group, with the right interlocks, and see what happened afterwards.

Design consequences:

- A side nav with one destination per job instead of tabs on a list. Overview, Instances, Failures, Entities, Functions, Storage, Activity, Settings.
- The instance page becomes a workspace: header, summary column, and a Timeline that merges the Gantt and the history table, with Inputs (edit, rewind, replay, restart) as a first-class tab.
- Group actions everywhere: multi-select in every table, a bulk action bar, and a Failures screen that groups by orchestrator and error.
- Capability driven: nav items, actions and badges appear according to `/about` (provider, permissions, capabilities), never according to provider names hard coded in the UI.
- Backend does the aggregation. Table Storage has no server-side counts, so every summary is a bounded scan; doing it once in the backend with a cache is cheaper than what the React Time Histogram does today (it downloads every instance in the range to the browser).

## 2. Information architecture

| Nav item | Purpose | Data | Gated by |
|---|---|---|---|
| Overview | Hub health for a time range: counts by status, throughput, needs attention, backlog, top orchestrators | `GET /stats` (new), `GET /storage` (new), `GET /about` | always; storage panel by `capabilities.storageHealth` |
| Instances | Search, filter, sort, select, act | `GET /orchestrations` (existing), `POST /orchestrations/batch` (new) | always |
| Instance | One instance workspace | `GET orchestrations('{id}')`, `/history`, `/spans` (new), `/children` (new), `/input-events` | always |
| Failures | Failed instances in range grouped by orchestrator and error signature, with recovery actions | `GET /failures` (new) | always |
| Entities | Durable entities with parsed state, signal and purge | `GET /orchestrations` with the entity filter (existing) plus `GET /entities` (new, optional) | always |
| Functions | Per orchestrator and activity numbers, and the function graph | `GET /stats` (new), `GET /function-map` (existing) | graph by `IsFunctionGraphAvailable` |
| Storage | Queue depths, partitions and owners, task hub info, large message blobs | `GET /storage` (new) | `capabilities.storageHealth` (Azure Storage only) |
| Activity | Who did what to which instance through DfMon | `GET /audit` (new) | `capabilities.audit` |
| Settings | Connection, hub administration (purge history, clean entity storage, delete task hub), templates, appearance | existing endpoints, `/about` | admin actions by read-write permission |

Global: hub switcher (`task-hub-names`), instance jump (`id-suggestions`), command palette, auto-refresh, time display, theme and mode, mode badges (Read only, Dangerous operations on).

## 3. Shell

```
+--------+-----------------------------------------------------------------------------------+
| [#]    | DurableFunctionsHub v   [ Find instance ...           ]  [/// Dangerous on ///]  |
| DFM    |                                       Auto-refresh 5 s v   UTC v   (theme) (user)  |
|        +-----------------------------------------------------------------------------------+
| Over-  |                                                                                   |
| view   |   page content                                                                    |
| Insta- |                                                                                   |
| nces   |                                                                                   |
| Failu- |                                                                                   |
| res 9  |                                                                                   |
| Entit- |                                                                                   |
| ies    |                                                                                   |
| Funct- |                                                                                   |
| ions   |                                                                                   |
| Stora- |                                                                                   |
| ge     |                                                                                   |
| Activ- |                                                                                   |
| ity    |                                                                                   |
|        |                                                                                   |
| Setti- |                                                                                   |
| ngs    |                                                                                   |
| <<     |                                                                                   |
+--------+-----------------------------------------------------------------------------------+
```

- Side nav 240 px, collapses to a 64 px icon rail (persisted). Card color, ink rule on the right. Items 40 px, icon plus label, sentence case. The active item is a tile: primary fill, ink outline, small offset shadow. Failures carries a count chip in the failed color for the current range. Items the hub cannot serve are hidden, not disabled.
- Top bar 56 px: hub switcher (combobox over `task-hub-names`, shows account name), instance jump (combobox over `id-suggestions`, Enter opens the instance), refresh control, time display toggle, theme and mode menu, login. Badges: Read only (muted) and Dangerous operations on (stripe) when `/about` says so.
- Command palette (bits-ui Command, `Ctrl+K`): go to instance, switch hub, open a nav item, run an action on the current instance, toggle theme or mode, set the time range. Shortcuts: `/` focuses the instance jump, `g o` Overview, `g i` Instances, `g f` Failures.
- Peek panel: clicking a row in any table opens a 520 px right panel with the instance header, summary and a mini timeline; "Open" goes to the full page. The list keeps its scroll position and selection.
- Bulk action bar: appears bottom center when rows are selected. Count, then Terminate, Suspend, Resume, Rewind, Raise event, Purge. Confirm dialogs list the count and the first ten ids. Dangerous operations are never bulk.
- Time range is global state shared by Overview, Instances, Failures and Functions (presets 15 m, 1 h, 24 h, 7 d, 30 d, custom). Changing it anywhere changes it everywhere; the URL carries it.
- VS Code webview: the same shell, side nav collapsed by default. `DfmViewMode=1` renders the Functions page alone.

## 4. Screens

### 4.1 Overview

```
+---------------------------------------------------------------------------------------------+
| Overview                     Last 24 hours v     refreshed 4 s ago     scanned 12,408 (full) |
+----------+----------+----------+----------+----------+----------+                             |
| Running  | Pending  | Failed   | Completed| Suspended| Entities |    (solid status tiles,     |
|   14     |   3      |   9      |  1,204   |   0      |   212    |     big mono number,        |
| ~~~~/\~~ | ~~~~~~~~ | ~~/\~~~~ | /\/\/\/\ | ~~~~~~~~ |          |     sparkline of the range) |
+----------+----------+----------+----------+----------+----------+                             |
| Throughput                                        | Needs attention                          |
| [stacked columns per status over the range,       | 3 running longer than 1 h   [Instances]  |
|  brush to narrow the global time range]           | 9 failed in range           [Failures]   |
|                                                   | 2 pending older than 10 min [Instances]  |
|                                                   | work items queue 1,240 deep [Storage]    |
+---------------------------------------------------+------------------------------------------+
| Top orchestrators                                                                            |
| name                      started  completed  failed  failure rate  p50       p95     [graph] |
| ProcessOrderOrchestrator   1,102     1,088       9        0.8 %     4.1 s     22 s           |
| ReconcileLedgerOrch...        24        23       1        4.2 %    41 min    58 min          |
+----------------------------------------------------------------------------------------------+
| Backlog (Azure Storage)                          | Recent activity (audit)                   |
| workitems 1,240   control-00 12  control-01 0    | 14:02 chandra  Replay #27  order-...913    |
| control-02 3      control-03 0   4 partitions    | 13:58 ops-bot  Terminate   nightly-...    |
+--------------------------------------------------+-------------------------------------------+
```

- Tiles are the loud element of the page; each links to Instances with that status filter. The number is `--font-mono` 32 / 600 on the status fill with dark text. Entities tile uses the entity pink.
- Throughput is the D3 stacked column chart from the design system, one bin per `stats.bins`, brush sets the global range.
- Needs attention thresholds are settings (default running longer than 1 h, pending older than 10 min, queue deeper than 1,000).
- `scanned` and `partial` come from `/stats`; when partial, a muted banner says "Counted the first 50,000 instances of the range; narrow the range for exact numbers."
- Backlog and Recent activity panels render only when the capability is present.

### 4.2 Instances

```
+---------------------------------------------------------------------------------------------+
| Instances                                                            Saved views v  [Start]  |
| [Running x] [Failed x] [+ status]   [ProcessOrder... x] [+ orchestrator]   Last 24 h v       |
| [ instanceId  v ] [ starts with v ] [ order-2026-           ]  [Apply]      Table | Timeline | Histogram
+----------------------------------------------------------------------------------------------+
| [ ] |  | instanceId              | name                    | created   | updated  | status  | duration |
| [x] |##| order-2026-09-04-000913 | ProcessOrderOrchestrator| 14:02:11  | 14:02:58 |[Running]| 47 s     |
| [ ] |##| order-2026-09-04-000912 | ProcessOrderOrchestrator| 13:58:40  | 13:59:05 |[Complet]| 25 s     |
| [x] |##| order-2026-09-04-000911 | ProcessOrderOrchestrator| 13:51:02  | 13:51:19 |[Failed] | 17 s     |
+----------------------------------------------------------------------------------------------+
|                          [ 2 selected   Terminate  Suspend  Rewind  Raise event  Purge  x ]   |
+----------------------------------------------------------------------------------------------+
```

- Filters are chips over the existing `$filter` builder: status (multi), orchestrator name (facet values come from `stats.byName`), time range (global), plus the free filter (column, operator, value) the API already supports, including lastEvent and customStatus. Chips serialize to the URL so views are shareable; Saved views are named URL states in `ITypedLocalStorage`.
- Table: TanStack table, virtualised, sticky header, column chooser, density toggle, the status spine, mono ids and timestamps, a computed duration column (`lastUpdatedTime` or `completedTime` minus `createdTime`). Sorting through `$orderby`. Paging through `$top` and `$skip` with "Load more" at the bottom rather than page numbers.
- Timeline view is the D3 Gantt of the loaded instances (existing behaviour); Histogram is the throughput chart bound to the filter.
- Row click opens the peek panel; the id link opens the full page.
- Entities are excluded here by default (they have their own page); the "include entities" chip brings them back.

### 4.3 Instance workspace

```
+---------------------------------------------------------------------------------------------+
| Instances / order-2026-09-04-000913                                                          |
| +------------------------------------------------------------------------------------------+ |
| | [RUNNING ] order-2026-09-04-000913        Suspend  Raise event  Set customStatus  Restart | |
| | [00:00:47] ProcessOrderOrchestrator       Rewind   [/// Terminate ///] [/// Purge ///]    | |
| |            created 14:02:11  updated 47 s ago  parent: none  children: 1   history 31 rows| |
| +------------------------------------------------------------------------------------------+ |
| Timeline | History | Inputs (2) | Sequence | Graph | Raw | Custom tabs...                     |
+-----------------------------+----------------------------------------------------------------+
| Summary                     | Timeline                                                       |
| Where the time went         |  ProcessOrderOrchestrator  |=========================| running |
|  activities      6.8 s 14 % |  ReserveInventory          |==| 1.9 s                          |
|  external event 38.1 s 81 % |  ChargePayment                |=====| 3.1 s                    |
|  timers            0 s  0 % |  ChargePayment (retry 2)            |=| timeout                |
|  orchestrator    2.3 s  5 % |  wait PaymentApproved                 |...........| 38 s       |
|                             |  NotifyCustomer (sub)                             |====| running|
| Input        [open]         |                                                                |
| {"orderId":"A-1043",...}    |  # | 14:02:11.913 | ExecutionStarted [input] | ProcessOrder...   |
| Output       none           |  2 | 14:02:12.004 | TaskScheduled            | ReserveInventory  |
| customStatus [open]         |  5 | 14:02:13.917 | TaskCompleted            | ReserveInventory  |
| {"step":"ChargePayment"}    |                                                                |
| Children                    |                                                                |
|  NotifyCustomer  [Running]  |                                                                |
+-----------------------------+----------------------------------------------------------------+
```

- Header: status tile with live duration, id, name, actions grouped by intent (run control, recovery, signal, data), meta line with parent link, children count and history size.
- Summary column (sticky): "Where the time went" from `/spans` (activities, sub-orchestrations, timers, external event waits, orchestrator replay time), input, output, customStatus with open-in-viewer, tags, children tree with status chips (from `/children`), execution and generation info from Raw.
- Timeline tab: D3 swimlane from `/spans` on top, the history table below, and the two are linked: hovering a span highlights its rows, clicking a row scrolls the span into view. Retries show as numbered segments in the same lane.
- History tab: the full table alone, with the timestamp filter, `#` column and the "input" tags.
- Inputs tab: as specified in the design system section 9.
- Sequence and Graph tabs: as before (D3 sequence diagram, Svelte Flow graph with the instance's path highlighted).
- Raw: the instance status JSON in the viewer, with a copy button.
- Custom tabs: Liquid templates as today.

### 4.4 Failures

```
+---------------------------------------------------------------------------------------------+
| Failures                     Last 24 hours v            9 failed in 3 groups     scanned full |
+----------------------------------------------------------------------------------------------+
| v ProcessOrderOrchestrator   InventoryUnavailable: SKU-*  ..............  6   last 13:51:19    |
|    order-2026-09-04-000911   13:51:02   17 s   [Rewind] [Update input] [Restart in place] [Purge] |
|    order-2026-09-04-000907   13:40:11   15 s   ...                                             |
|    [ Rewind all 6 ] [ Purge all 6 ]                                                            |
| > ProcessOrderOrchestrator   Timeout: ChargePayment did not complete  ....  2   last 12:10:04   |
| > ReconcileLedgerOrchestrator Ledger checksum mismatch ...................  1   last 02:42:13   |
+----------------------------------------------------------------------------------------------+
```

- Groups from `/failures`: orchestrator name plus a normalised error signature (numbers, GUIDs and quoted values replaced by `*`), count, last seen, sample ids.
- Each instance row carries the recovery actions that apply. Rewind and Purge are bulk-capable per group; Update input and rewind, Replay and Restart in place open the instance's Inputs tab because they need the payload in front of the operator.
- The count in the side nav is this screen's total for the current range.

### 4.5 Entities

Table of durable entities: entity name, key, state (parsed from the entity row, first line), last updated, actions Signal and Purge, and a state viewer in the peek panel. Header action "Clean entity storage" (existing dialog). Filter chips: entity name (facet), key starts with, updated in range.

### 4.6 Functions

Left: table per orchestrator name from `stats.byName` (started, completed, failed, failure rate, p50, p95, last failure), rows link to Instances filtered by name. Right, or full width on toggle: the function graph (Svelte Flow) with the same counters on the nodes; clicking a node filters the table. Activity level numbers are not free on Table Storage (they need history scans), so they appear only for the instances currently loaded in Instances, labelled as such.

### 4.7 Storage

Azure Storage provider only. Task hub info (partition count, created at, from `taskhub.json`), queue depths (work items and each control queue, from the queue service), partition owners (from the `{hub}Partitions` table when present, otherwise the lease blobs), large message container (exists, blob count for the current instance when opened from an instance), tables. A refresh control and a one-line explanation of what each number means for backlog and worker health.

### 4.8 Activity

The audit log: time, user, operation, instance, outcome, details, filterable by range and operation. Row link to the instance. Empty state explains how to enable auditing.

### 4.9 Settings

Connection (about info, manage connection), Hub administration (purge history by range and status, clean entity storage, delete task hub, all behind destructive dialogs), Templates (function map and Liquid templates present for this hub), Appearance (theme, mode, density, time display, thresholds for Needs attention), Feature flags (read only, dangerous operations, storage capabilities) as read-only information.

## 5. Backend additions

All under the existing `/a/p/i/{connName}-{hubName}` prefix, same auth middleware, `OperationKind.Read` unless stated. Each aggregation endpoint returns `scanned`, `partial`, `elapsedMs` and `generatedAt`, and is cached in memory per hub and range for 30 seconds so several browser tabs cost one scan. Provider support goes through `DfmExtensionPoints` routines like the history editor does: Azure Storage first, MSSQL where a SQL query is cheap, Netherite marked unsupported.

| Endpoint | Returns | Azure Storage | MSSQL | Netherite | Size |
|---|---|---|---|---|---|
| `GET /about` (extend) | add `provider`, `capabilities { updateInput, truncateHistory, storageHealth, audit, stats, children, batch }`, `readOnly`, `dangerousOperations` | yes | yes | yes | small |
| `GET /stats?from&to&bins=48` | `totals` by status, `bins[]` (time, counts by status), `byName[]` (name, started, completed, failed, failureRate, p50Ms, p95Ms, lastFailedAt), `stuck` (running with lastUpdated older than threshold), `oldestPending`, `entities` count | one Instances scan with `$select` of Name, RuntimeStatus, CreatedTime, LastUpdatedTime, CompletedTime, capped at 50,000 rows | one grouped SQL query, exact | not supported | medium |
| `GET /failures?from&to` | groups of `{ name, signature, count, lastSeenAt, sampleIds[] }`, instances per group with `{ id, createdTime, completedTime, durationMs, reason }` | same scan filtered to Failed; `Output` inline or first 2 KB of the blob; signature normalises numbers, GUIDs and quoted values | SQL | not supported | medium |
| `GET orchestrations('{id}')/spans` | `{ spans[]: { kind: activity, subOrchestration, timer, externalEvent, orchestrator, name, attempt, start, end, status, detailsRef }, totals by kind, historyRows, historyBytes, largeMessageBlobs }` | port of the React Gantt state to C#, one history read | same | same (history read exists) | medium |
| `GET orchestrations('{id}')/children` | `{ children[]: { instanceId, name, runtimeStatus, createdTime, lastUpdatedTime } }` | PartitionKey range `ge '{executionId}:'` and `lt '{executionId};'` on Instances; explicit child ids are not found and the response says `complete: false` | `ParentInstanceId` column query | not supported | small |
| `GET /storage` | `{ taskHub: { partitionCount, createdAt }, queues[]: { name, approximateMessageCount }, partitions[]: { name, owner, ownedSince, isDraining }, largeMessages: { container, exists } }` | `Azure.Storage.Queues` (new package) for `{hub}-workitems` and `{hub}-control-NN`; `{hub}Partitions` table or `{hub}-leases` blobs; verify the lease JSON shape against the DurableTask.AzureStorage version in use | not applicable | not applicable | medium |
| `POST /orchestrations/batch` | request `{ action, instanceIds[] (max 200), payload }`, response per id `{ instanceId, ok, status, message }` | client API calls with bounded parallelism | same | same | small |
| `GET /audit?from&to&operation` and the writer | rows `{ at, user, operation, instanceId, outcome, message }` written by the middleware for every Write and Dangerous call | `{hub}DfmAudit` table, PartitionKey `yyyyMMdd`, RowKey reverse ticks | `dfm.Audit` table | table in the configured storage account | medium |
| Conditional GET on `orchestrations('{id}')` and `/history` | `ETag` from `lastUpdatedTime` plus `runtimeStatus`; `If-None-Match` answers 304 | yes | yes | yes | small |
| `GET /entities?$filter` (optional) | entity rows with `state` parsed out of the entity envelope | list query with the entity filter plus parsing | same | same | small |

Notes:

- The cap on `/stats` and `/failures` is what keeps a 5 million row hub from taking the backend down; the UI shows `partial` and asks for a narrower range. A range is a scan on Table Storage either way (no index on `CreatedTime`), so the cache matters more than the cap.
- `p50` and `p95` use `CompletedTime` minus `CreatedTime` for terminal instances only; running instances contribute to `stuck` instead.
- `/spans` replaces three pieces of client logic (Gantt merging, sequence diagram grouping, duration math) with one tested C# model, and gives the "Where the time went" summary for free. Existing history paging stays for the History tab.
- `/storage` needs `Azure.Storage.Queues` added to the core project; everything else it reads is already reachable with the Tables and Blobs clients the port added.
- The audit writer is the audit hook the input-events plan left optional; with an Activity screen it stops being optional.
- Backend phase order: B0 `/about` extension and conditional GET, B1 `/stats` and `/children`, B2 `/spans`, B3 `/failures` and `/batch`, B4 `/storage`, B5 `/audit`.

## 6. Delivery order, UI and backend together

| Step | UI | Backend needed | Notes |
|---|---|---|---|
| 1 | Shell, nav, hub switcher, command palette, Settings (existing dialogs), Instances table and filters, peek panel | none | Parity with the old list, better ergonomics |
| 2 | Instance workspace: header, actions, History, Raw, Inputs, Sequence, Graph, custom tabs | B0 | Parity with the old details page plus the new feature |
| 3 | Overview tiles, throughput, top orchestrators, Functions table | B1 | First screen that did not exist before |
| 4 | Timeline tab and Summary column, children tree | B1, B2 | The workspace becomes the reason to use the tool |
| 5 | Failures screen, bulk action bar | B3 | Group recovery |
| 6 | Entities page, Storage page | B4 | Storage page ships only for Azure Storage |
| 7 | Activity page | B5 | |
| 8 | Remove the React project, CI and Docker on the new build, themes polish, accessibility pass | none | |

Steps 1 and 2 give a shippable replacement; everything after is new value and can go out one screen at a time behind the capability flags.

## 7. Open decisions

1. Thresholds for Needs attention: fixed defaults in settings, or per hub in `DFM_CLIENT_CONFIG`.
2. Bulk operations for Dangerous kinds: the plan says never; confirm.
3. `/stats` cap of 50,000 rows and the 30 second cache: tune after the first real hub.
4. Whether the Failures error signature should also look at the last `TaskFailed` detail when `Output` is empty (one history read per sample id, bounded).
5. Whether `spans` should be persisted per instance to avoid recomputing on every refresh of a long history; a `Last-Modified` check makes recompute cheap enough to defer this.
