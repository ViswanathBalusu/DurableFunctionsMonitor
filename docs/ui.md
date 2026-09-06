# The Durable Functions Monitor UI

The UI is a Svelte 5 single-page app (`durablefunctionsmonitor.svelte`) that every backend serves from
its `DfmStatics` folder. It is the same build in all three places it runs: the standalone Function
App, the "injected" backend inside your own project, and the VS Code extension's webview.

- Screens and what each one reads
- Themes, and the small screen
- Keyboard
- What the backend decides for it (capabilities)
- Settings and environment variables
- For contributors: the build, the tests, the statics contract

---

## Screens

Screens live under one hub: `{routePrefix}/{connName}-{hubName}/{screen}`, and every filter is in the
URL, so any view can be linked to or bookmarked. The prefix is the backend's own route
(`durable-functions-monitor` in the standalone and injected hosts, plus `DFM_INGRESS_ROUTE_PREFIX`
when a reverse proxy adds one). Two older paths, `/{hub}/durable-instances/{id}` and
`/{hub}/orchestrations/{id}`, still open the instance and rewrite themselves to the canonical one; an
unknown sub-path under a hub renders the Overview rather than a 404. In the VS Code webview there is
no address bar, so the same router runs in memory and the route is persisted with the rest of the
view state.

Overview, Instances, Failures, Functions and Activity share one **time range**, which is why it is in
the URL (`range` for a preset, `from`/`to` for an exact window): set it on one of them and the others
follow. The select offers the five presets — last 15 minutes, hour, 24 hours, 7 days, 30 days — and
`Custom range…`, which opens a picker seeded with the window in force, in whichever clock the top bar
is showing (UTC or local). Brushing the Overview's throughput chart or the Instances histogram sets
the same kind of window, and the control then names it.

### Login and hub picker — `/`

Outside the hub segment: sign in (Easy Auth / AAD, when the backend asks for it) and pick a task hub
from the ones the backend can see. The hub can be changed later from the top bar or the command
palette without coming back here.

### Overview — `/{hub}`

![Overview](../readme/screenshots/dfm-overview.png)

The state of the hub in the chosen time range: six status tiles, a throughput histogram whose brush
sets the global range, "Needs attention", the top orchestrators with p50/p95 and failure rate, and —
when the backend serves them — a backlog panel from `/storage` and a recent-activity panel from
`/audit`.

"Needs attention" collects five kinds of row: running longer than your `stuckMinutes`, failed in the
range, pending older than your `pendingMinutes`, work items queued above your `queueDepth`, and
suspended instances (with a live clock — there is no threshold for those). The three thresholds are
yours, in Settings.

### Instances — `/{hub}/instances`

![Instances](../readme/screenshots/dfm-instances.png)

The orchestrations of the range, in three views that share one filter: a table, a timeline (one bar
per instance) and a histogram. Entities are **not** included until the "include entities" chip says
so. The other chips are status, orchestrator or entity name and the time range, and below them one
column/operator/value filter that becomes the OData the backend expects. Columns can be hidden, the
density is yours, auto-refresh is a per-screen choice (never, 1, 5 or 10 seconds), and a view worth
keeping becomes a saved view — which stores the whole in-app URL, filters, columns and range
together.

| | |
|---|---|
| ![Timeline view](../readme/screenshots/dfm-instances-timeline.png) | ![Histogram view](../readme/screenshots/dfm-instances-histogram.png) |

The timeline is one bar per instance over the range; the histogram is when they ran, stacked by
orchestrator, and its brush narrows the time filter for all three views (`Escape` clears it).

![Filters](../readme/screenshots/dfm-instances-filters.png)

Select rows and the bulk bar appears: terminate, suspend, resume, rewind, raise event or purge. The
backend takes at most 200 ids per call, so the selection is posted to `/orchestrations/batch` in
chunks of 200 and the answers are concatenated into one report with a line per instance. A backend
without the `batch` capability gets the same work as single calls, eight at a time.

![Bulk actions](../readme/screenshots/dfm-instances-bulk.png)

Clicking a row's orchestrator name opens the peek panel — the instance, its mini timeline and six
actions, without leaving the list — and clicking a JSON cell opens the whole value in the viewer.

| | |
|---|---|
| ![Peek panel](../readme/screenshots/dfm-instances-peek.png) | ![JSON viewer](../readme/screenshots/dfm-json-viewer.png) |

**Start new instance** takes an orchestrator name, an optional instance id and the input, and starts
one against the hub.

![Start new instance](../readme/screenshots/dfm-start-new-instance.png)

### Instance workspace — `/{hub}/instances/{id}`

![Instance](../readme/screenshots/dfm-instance-graph.png)

One instance, its history, and everything that can be done to it. Which tabs are there depends on
the instance and on what the backend can do:

| Tab | What it is | When it is there |
|---|---|---|
| Summary | where the time went, the payloads, the children, the sizes | always: the right-hand column above 1100 px, a tab of its own below it |
| Timeline | the run as a swimlane of activities, sub-orchestrations, timers and external events, from `/spans` | `spans`, and not for an entity |
| History | the raw history rows, 200 to a page, with the payload of each in the JSON viewer | always |
| Inputs | the `ExecutionStarted` input and every `EventRaised` of this execution, and the operations below | orchestrations only |
| Sequence | the call sequence as a diagram | orchestrations only |
| Graph | the function map, with the path this instance actually took highlighted | a function map is published and it names this function |
| Raw | `/orchestrations('id')` as JSON, pretty-printed and fully expanded | always |
| _(custom)_ | any Liquid template the hub publishes, one tab per template | one per published template |

The default tab is Timeline where there is one, History otherwise. (The **Everything** tab in the
screenshots is a custom Liquid tab published by that hub, not a built-in one.)

The header carries the runtime status with a running clock, the instance's own numbers, and its
actions — suspend/resume, raise event, set customStatus, restart, rewind, terminate, purge. An
entity has two: send signal and purge. Input, output and customStatus can be opened in the viewer or
downloaded, and a payload the framework moved into blob storage is fetched when you ask for it.

| | |
|---|---|
| ![Timeline tab](../readme/screenshots/dfm-instance-timeline.png) | ![Sequence tab](../readme/screenshots/dfm-instance-sequence.png) |
| ![History tab](../readme/screenshots/dfm-instance-history.png) | ![Raw tab](../readme/screenshots/dfm-instance-raw.png) |

### Inputs, and re-running from an event

![Inputs](../readme/screenshots/dfm-instance-inputs.png)

The tab lists the input the instance started with and every external event it received afterwards,
and offers three operations. The backend decides per event whether each one applies and says why not
when it does not — no button is ever hidden here, it is disabled with the reason on it.

- **Update input and rewind** — replace the payload of the last input-bearing event of a **failed**
  instance and rewind it, so only the failed steps run again, now seeing the edited input.
- **Replay from #n** — truncate the history from the last input-bearing event on and raise that event
  again, with the same or an edited payload, so everything after it runs again. Offered on the last
  input-bearing event only, never on `ExecutionStarted` (use restart in place for that), and a
  running instance has to be terminated first.
- **Restart in place** — purge a **failed** instance that received no external events and is not a
  sub-orchestration, and start it again under the same instance id, with the same or an edited input.

Two of them rewrite Task Hub storage: **replay** and **restart in place** are `Dangerous`, and the
backend answers `403` until `DFM_DANGEROUS_OPERATIONS_ENABLED=true`. Update-input-and-rewind is an
ordinary write and needs no switch. Replay additionally needs a provider that can truncate history,
which today means the default Azure Storage one.

![Update input and rewind](../readme/screenshots/dfm-instance-replay.png)

An edited payload has to fit inline (60 KB); the editor meters it and disables the operations while
it is over. If a restart in place purges the instance but cannot re-create it, the UI keeps the
payload and offers to start it again rather than losing it.

### Failures — `/{hub}/failures`

![Failures](../readme/screenshots/dfm-failures.png)

The failed instances of the range, grouped by orchestrator and by an error signature the backend
normalises — numbers, GUIDs, quoted values and long hex runs become `*`, and what is left is the
first line, cut at 300 characters — largest group first. Rewind or purge a whole group in one call.

### Entities — `/{hub}/entities`

![Entities](../readme/screenshots/dfm-entities.png)

The durable entities of the hub, filtered by entity name and key prefix, their state shown as one
line with the whole of it one click away. Signal or purge one; where the backend supports it, clean
the empty entities and the orphaned locks out of the hub from here as well as from Settings. A
backend without the `entities` capability still lists them, without the parsed state.

### Functions — `/{hub}/functions`

![Functions](../readme/screenshots/dfm-functions.png)

The function map of the app — orchestrators, activities, entities and their triggers — read from the
`dfm-func-map*.json` the project publishes, with the traffic of the range on it where the backend
serves statistics. The graph can be saved as an SVG.

### Storage — `/{hub}/storage`

![Storage](../readme/screenshots/dfm-storage.png)

What the task hub is made of: the tables and the large-message container, the queues with what each
depth means, and which worker holds which control-queue partition. Row counts are a scan of two
tables, so they happen only when you ask for them, and the answer says so when it had to stop early.

### Activity — `/{hub}/activity`

![Activity](../readme/screenshots/dfm-activity.png)

Every write and every dangerous call anyone made through this monitor: who, what, which instance, the
outcome and the details. Recorded only when `DFM_AUDIT_ENABLED=true`, and readable only from a
provider that can read the audit table back; the screen says so when it is off rather than showing an
empty table.

### Settings — `/{hub}/settings`

![Settings](../readme/screenshots/dfm-settings.png)

What this backend is and what it can do (straight from `/about`: read-only, dangerous operations, the
storage routines it has, the capability chips), the connection it uses (the key never leaves the
server), the hub-level operations — purge instance history, clean entity storage, delete task hub —
your own preferences (theme, mode, density, whether times are shown as UTC or local, and the three
"needs attention" thresholds), and the custom Liquid templates the hub publishes.

An operation this backend does not implement is a row that is there and disabled, with
`Not supported by this backend` on it; one it does implement asks first and then reports what it did:

![Purge instance history](../readme/screenshots/dfm-purge-history.png)

---

## Themes, and the small screen

The themes in the menu come in families, and every theme has a light and a dark face. The papers -
Poster, Riso, Memphis, Blueprint, Hazard - share the neo-brutalist look: an ink line, a hard offset
shadow, flat colour. A theme of another family changes the paper, the line and the shadow, and the
status colours keep their meaning in every one of them. The top bar's swatch switches theme and mode,
`Ctrl`/`Cmd` `K` finds them by name, and the choice is kept per user.

| | |
|---|---|
| ![Poster, dark](../readme/screenshots/dfm-instances-dark.png) | ![Theme menu](../readme/screenshots/dfm-theme-menu.png) |
| ![Riso](../readme/screenshots/dfm-theme-riso.png) | ![Memphis](../readme/screenshots/dfm-theme-memphis.png) |
| ![Blueprint, dark](../readme/screenshots/dfm-theme-blueprint.png) | ![Hazard, dark](../readme/screenshots/dfm-theme-hazard.png) |
| ![Glass, dark](../readme/screenshots/dfm-theme-glass.png) | |

Light, dark and "system" are three separate choices: system follows the browser, or the editor in the
VS Code webview.

At 768 px and below the side navigation becomes a bottom bar, and what does not fit moves into a
sheet behind **More**:

| | |
|---|---|
| <img src="../readme/screenshots/dfm-mobile.png" width="300" alt="Instances on a phone"> | <img src="../readme/screenshots/dfm-mobile-more.png" width="300" alt="The More sheet"> |

---

## Keyboard

![Command palette](../readme/screenshots/dfm-command-palette.png)

| Key | What it does |
|---|---|
| `Ctrl`/`Cmd` `K` | the command palette |
| `/` | focus the instance search in the top bar |
| `g` then `o` `i` `f` `e` `s` | go to Overview, Instances, Failures, Entities, Settings |
| `Escape` | close the palette or the peek panel, or clear a histogram brush |
| ↑ ↓ in the palette | move the highlight; `Enter` runs the highlighted row |
| ← → `Home` `End` on a tab strip or a segmented control | move along it |

The palette is more than navigation: it also carries actions (start a new instance, refresh, purge
instance history, switch task hub, suspend or resume the instance you are looking at) and preferences
(light/dark, density, the five time-range presets, UTC or local time), and typing two characters or
more looks the text up as an instance id.

The rest of the map stays out of the way: every shortcut except `Ctrl`/`Cmd` `K` and `Escape` is
inert while you are typing in a field and while the palette is open, the second key of the `g` chord
has to arrive within 900 ms, and a chord to a screen this backend does not have does nothing.
Dialogs handle `Escape` themselves.

Every screen is operable without a mouse, and CI runs axe over the app in light and dark
(`tests/e2e/a11y.spec.ts`): no serious or critical violation.

---

## What the backend decides

The UI never branches on which storage provider is behind it. It asks `/about` once and turns screens
and buttons on from the capabilities it answers with:

| Capability | What it turns on | Azure Storage | MSSQL | Netherite |
|---|---|---|---|---|
| `stats` | the Overview's tiles, throughput and top orchestrators; the Functions screen and its table; the Instances histogram; the entity counts; the traffic on the instance Graph | yes | yes | no |
| `failures` | the Failures screen and its nav badge | yes | no | no |
| `children` | the children of an instance, in the Summary | yes | yes | no |
| `storageHealth` | the Storage screen and the Overview's backlog panel | yes | no | no |
| `audit` | the Activity screen and the Overview's activity panel | with `DFM_AUDIT_ENABLED` | no | with `DFM_AUDIT_ENABLED` |
| `spans` | the Timeline tab, the peek panel's mini timeline, "where the time went" | yes | yes | yes |
| `batch` | one `/orchestrations/batch` call per 200 selected instead of a client-side fan-out | yes | yes | yes |
| `entities` | the parsed state on the Entities screen (the screen itself is always there) | yes | yes | yes |
| `purgeHistory` | the Purge instance history operation | yes | yes | yes |
| `conditionalGet` | `If-None-Match` on the details and spans of an instance | yes | yes | yes |
| `purgeEntities` | the "entities" option of the Purge history dialog | no | no | no |
| `cleanEntityStorage` | Clean entity storage, in Settings and on the Entities screen | no | no | no |
| `deleteTaskHub` | Delete task hub, in Settings | no | no | no |
| `updateInput`, `truncateHistory` | what the backend will allow on the Inputs tab (the UI reads the per-event answer, not the flag) | yes | no | no |
| `episodeMarkers` | whether `/spans` can report the orchestrator's own time, and so whether that lane appears | yes | yes | no |

What a provider answers is `DfmExtensionPoints` plus the settings: this table is
`Common/Capabilities.cs` read against each provider's `ExtensionMethods.cs`. `/about` reports the
dangerous-operations switch separately, as `dangerousOperations`.

A capability the backend does not have takes the **screen** out of the navigation. A **button** stays
where it is and is disabled, with the reason on it — `Not supported by this backend`, `Read-only
mode`, or, on the Inputs tab, whatever the backend said about that particular event. Either way, the
UI does not make a call it knows will fail.

---

## Settings and environment variables

Backend (app settings of the Function App, or `local.settings.json`):

| Name | What it does |
|---|---|
| `AzureWebJobsStorage` | the task hub's connection string |
| `DFM_HUB_NAME` | the hub to serve, when it is not the host's own |
| `DFM_ALTERNATIVE_CONNECTION_STRING_{connName}` | another storage account, reached as `{connName}-{hubName}` in the URL |
| `DFM_NONCE` | `i_sure_know_what_i_am_doing` disables authentication - local use only |
| `DFM_DANGEROUS_OPERATIONS_ENABLED` | `true` allows replay and restart-in-place (update-input-and-rewind is an ordinary write and needs no switch) |
| `DFM_AUDIT_ENABLED` | `true` records every write and dangerous call into the `{hub}DfmAudit` table, which the Activity screen reads |
| `DFM_STATS_CAP` | how many rows `/stats` and `/failures` scan before answering `partial` (default 50000) |
| `DFM_AGGREGATION_CACHE_SECONDS` | how long `/stats`, `/failures` and `/storage` keep an answer (default 30, clamped to 0…3600, `0` disables it) |
| `DFM_CUSTOM_TEMPLATES_FOLDER` | a folder to read custom Liquid tab templates, Function Maps and the custom meta tag from, instead of the storage account. A plain name (`dfm-templates`) is resolved next to the running app; an absolute path is taken as is |
| `DFM_MODE` | exactly `ReadOnly` turns every write action into a disabled button |
| `DFM_INGRESS_ROUTE_PREFIX` | the prefix a reverse proxy puts in front of the app |
| `DFM_ALLOWED_USER_NAMES`, `DFM_ALLOWED_APP_ROLES`, `DFM_ALLOWED_FULL_ACCESS_APP_ROLES`, `DFM_ALLOWED_READ_ONLY_APP_ROLES` | who may sign in, and who may write; the three role lists may not overlap |
| `DFM_USERNAME_CLAIM_NAME`, `DFM_ROLES_CLAIM_NAME` | where to find the name and the roles in the token (`preferred_username`, `roles`) |
| `DFM_CLIENT_CONFIG` | a JSON object the host injects into `index.html`, which sets the UI's defaults |

A boolean setting is `true` (any casing, trimmed) and nothing else: `1` and `yes` are off.

`DFM_CLIENT_CONFIG` carries the defaults a deployment wants:

| Key | Values |
|---|---|
| `theme` | `light`, `dark` |
| `dfmTheme` | `poster`, `riso`, `memphis`, `blueprint`, `hazard`, `glass` |
| `showTimeAs` | `UTC`, `Local` |

A user's own choices override them, and are kept per user: in the browser as `dfm.<name>` local
storage keys, in the VS Code webview as one `prefs` blob in the webview's persisted state.

| Key | Values |
|---|---|
| `dfm.mode` | `light`, `dark`, `system` |
| `dfm.theme` | the key of one of the themes in the menu |
| `dfm.showTimeAs` | `UTC`, `Local` |
| `dfm.density` | `compact`, `comfortable` |
| `dfm.nav` | `collapsed`, `expanded` |
| `dfm.thresholds` | `{ "stuckMinutes": …, "pendingMinutes": …, "queueDepth": … }` |
| `dfm.savedViews` | the saved views, each one an in-app URL |
| `dfm.autoRefresh.instances`, `dfm.autoRefresh.instance` | seconds, or `0` for never |

---

## For contributors

```bash
cd durablefunctionsmonitor.svelte
npm ci
npm run dev            # :3000, proxying the API to a host on :7072
npm run check          # svelte-check
npm run lint           # eslint + prettier
npm test               # vitest, with coverage
npm run test:e2e       # playwright, against a real host on Azurite
npm run build-and-copy # build, and copy the statics the backend serves
```

The end-to-end suite runs against the real backend on Azurite, not against mocks:
`node scripts/harness/write-local-settings.mjs`, `npx azurite --silent --location .azurite`,
`npm run seed`, then `npm run test:e2e`.

What the build must produce is a contract the backend and the VS Code extension both depend on - one
JS and one CSS bundle under `static/`, hex-hashed names, root-absolute links in `index.html`, the
seven placeholder tags verbatim, and no inline scripts. `node scripts/harness/verify-build-contract.mjs
durablefunctionsmonitor.svelte/build` checks it, and CI fails on it. The whole contract, with the
reasons for each rule, is in `docs/plans/svelte-rewrite/00-shared-contracts.md` §2.
