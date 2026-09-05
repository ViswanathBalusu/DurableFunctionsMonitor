# Durable Functions Monitor: neo-brutalist design system

Design system and migration brief for rebuilding the DurableFunctionsMonitor UI on Svelte 5, Tailwind v4, bits-ui and shadcn-svelte, with D3 for charts, Svelte Flow for the function graph and svelte-jsoneditor for JSON, targeting the backend in `ViswanathBalusu/DurableFunctionsMonitor` (isolated only, .NET 10, Azure SDK storage, input event operations). Five themes, each with a light and a dark face. Files that belong with this document:

- `dfm-tokens.css`: the Tailwind v4 token file, drop-in for `src/app.css`. Single source of truth for every color, metric, utility and library bridge described here.
- `dfm-theme-preview.html`: open in a browser, switch theme and mode, and see every token on real DFM components, including the new Inputs tab.
- `dfm-migration-plan.md`: the engineering plan that matches this design to the fork's backend: build output contract, VS Code host contract, API client, state modules, phases and tests.
- `dfm-rewrite-plan.md`: the product plan: side nav information architecture, the Overview, Instances, Instance workspace, Failures, Entities, Functions, Storage, Activity and Settings screens, and the backend endpoints they need. This document supplies the visual language; that one supplies the screens.

## 1. What is being replaced, and what the fork's backend now expects

Findings from `ViswanathBalusu/DurableFunctionsMonitor` `main` (8 commits ahead of `microsoft/main`). The React app is untouched by the fork; the backend is not.

Backend facts the new UI is built against:

- The in-process backend (`durablefunctionsmonitor.dotnetbackend`) is gone. Everything is .NET 10 isolated: `durablefunctionsmonitor.dotnetisolated.core` plus the `mssql` and `netherite` packages, wrapped in `DurableFunctionsMonitor.slnx`. The React app is wrapped in a `.esproj` so it builds inside the solution; the Svelte app takes the same shape.
- Storage went from `WindowsAzure.Storage` to `Azure.Data.Tables` and `Azure.Storage.Blobs`, with Azurite integration tests in CI (`DFM_TEST_REQUIRE_STORAGE`). The UI can run its Playwright suite against the same service container.
- The SPA is served by `ServeStatics` from `durablefunctionsmonitor.dotnetisolated/DfmStatics`. It only serves `static/css/*`, `static/js/*`, `manifest.json`, `favicon.png` and `logo.svg`, three path segments deep, and answers `index.html` for everything else. The build must land exactly there (section 2 of the migration plan).
- `index.html` is a template. The backend replaces these exact strings: `<meta name="durable-functions-monitor-meta">` (CSP or custom meta), `<script>var DfmClientConfig={}</script>`, `<script>var IsFunctionGraphAvailable=0</script>`, `<script>var DfmRoutePrefix=""</script>`, `<script>var DfmApiRoutePrefix=""</script>`, and it rewrites `href="/` and `src="/` to `/{routePrefix}/`. The VS Code extension additionally replaces `<script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script>` and `<script>var DfmViewMode=0</script>`, and rewrites asset links with a regex that only matches paths made of `[0-9a-z./]`.
- Default CSP: `default-src 'self'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src 'self' https://fonts.gstatic.com`, `connect-src 'self' https://login.microsoftonline.com`, `img-src data: 'self'`. Google Fonts are allowed; self-hosted woff2 needs one more `FileMap` entry in `ServeStatics` (`static/media`, `font/woff2`), which the fork can add.
- New endpoints under `orchestrations('{instanceId}')/`: `GET input-events`, `POST update-input-and-rewind` (Write), `POST replay` (Dangerous), `POST restart-in-place` (Dangerous). `GET /about` now lists `DurableFunctionsMonitor.DangerousOperations` in `permissions` when `DFM_DANGEROUS_OPERATIONS_ENABLED=true`, alongside the existing read-write permission, and its `version` reads `x.y.z (isolated)`.
- Every history event now carries `SequenceNumber` (MSSQL maps `dt.History.SequenceNumber`; Netherite may not). Large payloads stored in `*BlobName` columns are resolved on read, so history rows can now carry big inline JSON.
- Storage capability flags come from the backend (`storageSupports.updateInput`, `storageSupports.truncateHistory`); MSSQL and Netherite report false until they get their own routines, and `restart-in-place` works everywhere. The UI never encodes provider rules; it renders `allowed`, `reason`, `requiresTerminate` and `warning` as received.
- Status codes the UI must map: 400 (entity id, malformed body, unsupported storage), 403 (dangerous disabled, read-only), 404 (instance or event gone), 409 (precondition failed, including "history changed since you read it"), 413 (edited input over 60 KB), and 500 with a recovery payload for the two partial-failure windows.

What the React app is, and what replaces it:

| Today | Replacement |
|---|---|
| React 18 + MobX 5 class components | Svelte 5 runes; the MobX state classes map one to one onto `.svelte.ts` state modules |
| MUI 5 (AppBar, Table, Tabs, Dialog, Select, Autocomplete, Menu, Checkbox, LinearProgress) | shadcn-svelte components over bits-ui primitives, restyled with the tokens below |
| `@mui/x-date-pickers` + moment | bits-ui DateRangePicker / DateField, `@internationalized/date` |
| MUI Autocomplete for "instanceId to go to" | bits-ui Combobox |
| mermaid 10 for Sequence Diagram, Gantt Chart and Functions Graph (SVG post-processed for click handlers) | D3 for sequence and Gantt, `@xyflow/svelte` for the Functions Graph with elkjs or dagre for layout |
| react-vis for Time Histogram | D3 stacked columns with a D3 brush |
| JSON shown in a read-only MUI `InputBase` textarea (`LongJsonDialog`), truncated to 512 chars in cells | svelte-jsoneditor, see section 2 |
| `theme.ts`: MUI deepPurple/pink, status colors as 20 percent alpha tints | Five themes, solid status fills, no alpha tints |
| Emotion CSS in JS plus 546 lines of component CSS | Tailwind v4 utilities and `@utility` classes from `dfm-tokens.css` |
| CRA + webpack with a chunk-limit patch, output copied to `DfmStatics` | Vite, single chunk, hex hashes, `static/js` and `static/css` output, same copy step |
| msal 1.4.12 | `@azure/msal-browser`, same `easyauth-config` and `task-hub-names` flow |
| No UI for input events | New Inputs tab, section 9 |

Capabilities that must survive the migration (functionality, not layout; the screens are reorganised in `dfm-rewrite-plan.md`):

- Hub selection and login (`easyauth-config`, `task-hub-names`, msal), read-only mode, the nonce path for the VS Code host, custom meta tag and Liquid templates.
- Listing with the full `$filter` vocabulary (column, 8 operators, value, runtime status set including entities, time range on createdTime), `$orderby`, `$top` and `$skip`, column hiding, lastEvent column when filtered on, instanceId suggestions.
- Instance data: fields, history with its timestamp filter, blob-backed input, output and customStatus downloads, parent link, custom status.
- Actions: Suspend, Resume, Rewind, Terminate, Raise Event, Set customStatus, Restart, Purge, Send Signal for entities, plus the new Update input and rewind, Replay and Restart in place with their eligibility model.
- Hub administration: purge history by range and status, clean entity storage, delete task hub, connection settings, batch operations, start new instance.
- Diagrams: Gantt for many instances and for one, sequence diagram, function graph for the hub and for one instance, time histogram with brushing, Save as SVG, `GotoFunctionCode` and `GotoBinding` in VS Code.
- Runtime statuses: Completed, Running, Failed, Pending, Terminated, Canceled, ContinuedAsNew, Suspended. Entity types: Orchestration, DurableEntity.
- Host modes: standalone, Docker, VS Code webview with `DfmViewMode` 0 and 1, `OrchestrationIdFromVsCode`, persisted state through `PersistState`.

## 2. JSON editor decision

The current UI never used Monaco; JSON is a plain textarea. The target you named (the editor VS Code uses) is Monaco. For Svelte the recommendation is svelte-jsoneditor by Jos de Jong, with plain CodeMirror 6 for the two small JSON inputs.

svelte-jsoneditor: native Svelte component, tree, text and table modes in one control, text mode is CodeMirror 6 with JSON linting and repair, `readOnly` mode hides the editing chrome, handles very large documents (the README states up to 512 MB), search and replace, JSON path navigation bar, and it is themed entirely through `--jse-*` CSS variables so it follows theme and mode switches without a rebuild. Use tree mode for history event details, input, output and customStatus in the Long JSON dialog, and text mode for the editable fields in Raise Event, Set customStatus, Send Signal and Start New Instance. Confirm the package's current Svelte 5 peer range before pinning; `vanilla-jsoneditor` is the framework-free build if you ever need it outside Svelte.

CodeMirror 6 (`@codemirror/lang-json` via `svelte-codemirror-editor`) is the lighter option for single-field JSON inputs if the full editor feels heavy in a dialog. Monaco itself is not recommended here: 5 MB plus of JavaScript, web worker plumbing under Vite, its own theme format that ignores CSS variables, and it brings nothing the read-mostly JSON in DFM needs.

## 3. Design direction

The product is a diagnostic console for Azure Durable Functions. People come to it to find one instance among thousands, read what happened in order, and act on it. The visual system should make the state of the system obvious from across the room and get out of the way of dense data.

Principles:

1. The line is information. A 2 or 3 pixel ink rule marks an interactive control, a container or a section boundary. Nothing gets an outline for decoration.
2. Status is a solid block. Runtime status is a filled block with ink outline and dark text, never a pastel tint, never a colored dot next to gray text. The status spine on the left edge of every list row is the one loud thing in the table.
3. Elevation is a hard offset shadow, never blur. Hover lifts the element and lengthens the shadow; press drops it flat. Dialogs and popovers get the long offset.
4. Color is a vocabulary, not decoration. Eight status colors, two kinds, seven node kinds, six chart series. Every theme keeps the meaning and changes only the hue. The six poster fills are for data and actions, not for backgrounds.
5. Dark mode is not an inversion. Paper becomes the line, the shadow changes color per theme, bright fills stay bright with dark text, and only the two gray statuses flip to paper text.
6. Density over whitespace. 36 px rows and controls, 14 px body, mono for anything that is data. A comfortable density toggle raises rows to 44 px.
7. No gradients, no alpha tints, no soft shadows, no all caps labels, no eyebrow labels, no icon-only buttons for destructive actions. Sentence case everywhere. The weight and width of the type carries hierarchy.

## 4. Token architecture

Theme and mode are two independent switches on `<html>`:

```html
<html data-theme="riso" class="dark">
```

`data-theme` selects one of `poster` (default, also `:root`), `riso`, `memphis`, `blueprint`, `hazard`. The `dark` class selects the dark face. `mode-watcher` (the shadcn-svelte standard) drives both: `setMode()` toggles the class and `setTheme()` sets the attribute. Persist as `dfm.theme` and `dfm.mode` in localStorage, reuse the existing `TypedLocalStorage` abstraction so the VS Code host keeps working. Inside the VS Code webview derive the mode from the `vscode-dark` / `vscode-light` / `vscode-high-contrast` body classes and keep the theme user-selectable.

`dfm-tokens.css` layers:

1. Raw variables per theme and mode: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--accent`, `--muted`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar-*` and `--chart-1..5` (the shadcn-svelte contract, so every shadcn-svelte component themes itself), plus the DFM additions below.
2. `@theme inline` maps them to Tailwind utilities: `bg-status-failed`, `text-on-poster`, `border-ink`, `shadow-brutal`, `font-mono`, `rounded-md` and so on. `inline` is what makes per-theme overrides resolve at use time.
3. `@utility` classes: `brutal`, `brutal-flat`, `brutal-lg`, `brutal-press`, `rule-b`, `rule-t`, `rule-r`, `stripes`, `display`, `condensed`, `data`, `bg-pattern`.
4. Library bridges: `.jse-theme-dfm` for svelte-jsoneditor and `.svelte-flow` variables for Svelte Flow.
5. Custom variants `dark`, `theme-poster`, `theme-riso`, `theme-memphis`, `theme-blueprint`, `theme-hazard` for the rare component that needs a theme-specific tweak.

DFM additions to the shadcn contract:

| Token | Meaning |
|---|---|
| `--ink` | The line color. Black in most light faces, cobalt in Blueprint, paper in every dark face. `--border` and `--sidebar-border` equal it. |
| `--paper` | Same as `--background`; named so "text in paper on ink" reads correctly in components like the JSON menu bar. |
| `--shadow-ink` | Hard shadow color. Ink in light. In dark: paper (Poster, Memphis, Blueprint), sunflower (Riso), caution yellow (Hazard). |
| `--on-poster` | Text color on any poster or status fill. Black, riso black `#231F20`, or navy `#0A1A5C` / `#08205F` in Blueprint. Same in light and dark. |
| `--poster-1..6` | The theme's six print colors. Chart series use 1 to 5 in order. |
| `--status-<name>` and `-foreground` | completed, running, failed, pending, terminated, canceled, continued, suspended |
| `--kind-orchestration`, `--kind-entity` and `-foreground` | Entity type chips. Orchestration is paper with ink outline, entity is the theme's pink. |
| `--node-<kind>` | orchestrator, activity, entity, suborchestrator, http, timer, queue, other, plus `--node-foreground`. Queue covers storage queue, Service Bus, Event Hub and Event Grid triggers. |
| `--json-key`, `--json-string`, `--json-number`, `--json-boolean`, `--json-null`, `--json-punctuation` | Syntax colors, deep in light and bright in dark, all at 4.5:1 on the card color. |
| `--radius`, `--border-width`, `--shadow-offset`, `--shadow-offset-lg`, `--pattern` | Per-theme metrics, mode independent. |
| `--shadow-brutal`, `-sm`, `-lg`, `-hover`, `--stripe` | Derived; do not override per theme. |
| `--control-h`, `--control-h-lg`, `--row-h`, `--row-h-comfortable`, `--topbar-h`, `--tab-h`, `--spine-w` | Sizing: 36, 40, 36, 44, 56, 40, 6 px. |

Contrast: every text on fill pair in every theme and mode was checked at 4.5:1 or better, ink lines and focus rings at 3:1 or better against paper and card (310 pairs, zero failures). Keep the generator discipline if you add a color: a fill without a passing foreground does not go in.

## 5. Typography

Two families, clearly distinct.

- Archivo (variable, Google Fonts, `wdth` 62 to 125, `wght` 100 to 900) for everything that speaks: titles, labels, buttons, body. Hierarchy comes from weight and width, not from caps. `display` = 800 at width 112 with -0.01 em tracking. `condensed` = 600 at width 90 for table headers and dense labels.
- JetBrains Mono for everything that is data: instanceIds, timestamps, durations, function names in graphs and Gantt labels, JSON, counters. Tabular numerals on.

Scale in px, base 14, ratio about 1.2 with two display steps:

| Role | Size / weight / line height |
|---|---|
| hero display (empty states, hub name) | 44 / 800 wdth 112 / 1.1 |
| instance header | 32 mono 600 / 1.1 (instanceId) |
| page title | 24 / 800 / 1.15 |
| dialog title | 20 / 700 / 1.2 |
| section heading | 16 / 700 / 1.3 |
| body and controls | 14 / 400 to 600 / 1.5 |
| table header | 13 / 600 wdth 90 / 1.35 |
| data | 13 mono / 1.35 |
| meta | 12 / 600 / 1.35, muted foreground |
| fine print, axis ticks | 11 mono / 1.3 |

Line length under 80 characters for prose (dialog copy, empty states, error messages). Tables and JSON are exempt.

## 6. Spacing, line, shadow, radius, motion, focus

- Spacing on a 4 px grid: 4, 8, 12, 16, 24, 32, 48. Page gutter 24. Section gap 40.
- Line: `--border-width` per theme (2 px for Poster, Riso, Blueprint; 3 px for Memphis and Hazard). Table row separators inside a card are 1 px in `--muted`, not ink; ink is reserved for the container and the header rule.
- Shadow: `--shadow-offset` (4 px, Memphis 5 px) for buttons, cards, tables, popovers. `--shadow-offset-lg` (8 px, Memphis 10 px) for dialogs and the instance header. `--shadow-brutal-sm` (2 px) for chips inside tables and the logo.
- Radius: 0 for Poster, Blueprint and Hazard; 2 px for Riso; 10 px for Memphis. Never mix radii within a theme.
- Motion: only in answer to an action. Hover: `translate(-2px, -2px)` and shadow grows by 2 px. Active: translate by the shadow offset and shadow collapses. 120 ms ease-out. Theme and mode switches are instant. The progress bar is the `--stripe` pattern sliding at 800 ms linear. `prefers-reduced-motion` disables all of it.
- Focus: `outline: 3px solid var(--ring); outline-offset: 2px`. The ring is a color in every theme, never the ink, so keyboard focus is distinguishable from a plain border.
- Icons: lucide-svelte at 2.5 px stroke so the icon weight matches the line weight. Always paired with a text label on buttons.

## 7. The five themes

Each theme is a paper, an ink, a shadow color and six poster fills. Runtime statuses stay in the same hue families across every theme: green for Completed, the theme's yellow for Running, red for Failed, blue for Pending, two grays for Terminated and Canceled, violet or pink for ContinuedAsNew, orange for Suspended. Entity is always the theme's pink. Full tables per theme are in section 12.

| Theme | Paper (light / dark) | Ink | The idea |
|---|---|---|---|
| Poster | bone `#F8F6F1` / ink violet `#1B1930` | black / paper | canonical neo-brutalism, default |
| Riso | newsprint `#F2EEE6` / navy stock `#10203A` | riso black `#231F20` / paper, sunflower shadows in dark | risograph inks, halftone paper |
| Memphis | lilac white `#F6F3FA` / plum `#2A1F3D` | black / paper, 3 px, 10 px radius | Sottsass pastels, thick outline, dot paper |
| Blueprint | drafting `#EEF2FF` / cobalt `#08205F` | cobalt `#1636E0` / paper | engineering drawing, grid paper, safety orange |
| Hazard | chalk `#F4F4F1` / graphite `#23262C` | black / paper, caution yellow shadows in dark, 3 px | industrial signage, stripes on destructive actions |

Background patterns are optional and only on the page background, never inside cards: halftone dots (Riso), sparse dots (Memphis), 16 px grid (Blueprint). Poster and Hazard are plain.

## 8. Component specifications

App bar (56 px, card color, ink rule below): 28 px primary square as the logo, product name in `display` 16, task hub name in mono 600 after a muted slash, the instanceId combobox in mono, a flexible gap, then the main menu button and login. On the details page the instanceId replaces the combobox as a mono link.

Filter rail (single row, wraps under 1100 px): time range preset as a secondary button with a menu, from and till date fields (till has its own enable checkbox), filtered column select, filter operator select, filter value input in mono, runtime status multi-select with checkboxes and an Apply button in the popover, auto-refresh select, Refresh as the only primary button on the page. Labels sit above controls at 12 / 600 muted, not inside as placeholders.

Tabs: tiles. Each tab is a card-colored box with an ink outline, sitting on a shared ink baseline; the selected tab fills with primary. No underline indicator, no animated indicator.

Table: container has ink outline and the standard shadow; header row on muted with an ink rule below; 36 px rows; 6 px status spine as the first cell; instanceId as a mono link with a 2 px underline; runtimeStatus as a chip; long JSON cells in mono, truncated with an ellipsis, click opens the Long JSON dialog; hover paints the row with muted. Sorting arrows are ink triangles, hidden columns are announced as "3 columns hidden" in meta text next to the paging controls. Paging is two buttons and a count, no numbered pagination.

Status chip: 26 px high, 10 px horizontal padding, ink outline, status fill, `-foreground` text at 13 / 700. The same chip at 20 px is used inline next to an entity name. Mini counters (18 px, mono 11) reuse the status fills on graph nodes.

Buttons: 36 px, 14 px padding, 14 / 700, ink outline, standard shadow, `brutal-press`. Variants: primary (theme yellow or pink), secondary (theme's second color, white text where the fill is dark), default (card color), destructive (theme red, dark text), ghost (no outline, no shadow, muted hover; used for Save as SVG and menu triggers). Disabled: 50 percent opacity, no shadow. Destructive buttons always carry a verb and an object: "Terminate", "Purge 1,284 instances".

Inputs and selects: 36 px, ink outline, card or paper fill (`--input`), mono for anything that is an id, a filter value or JSON. Checkboxes are 20 px ink squares that fill with primary and show an ink square, not a check glyph. Switches are 46 by 24 ink rectangles whose knob is an ink square; on state fills with accent.

Popovers and menus: popover color, ink outline, standard shadow, 4 px offset from the trigger, items 32 px, hover on muted, destructive items in destructive text.

Dialogs: card color, ink outline, long shadow, 560 px default width, 20 px padding, title in `display` 20, body copy under 80 characters per line, actions right-aligned with Cancel as a default button and the confirming action as primary or destructive. Destructive dialogs (Purge, Terminate, Rewind, Clean Entity Storage, Batch Ops) carry a 14 px `--stripe` band across the top. No overlay blur; the overlay is ink at 50 percent, which is the one place alpha is allowed.

Progress: 12 px bar, ink outline, `--stripe` fill sliding. It sits directly under the app bar rule while a request is in flight and inside dialogs above the actions.

Errors and toasts: destructive fill, dark text, ink outline, standard shadow, an inline Retry button, dismissed by an explicit close. The message names what failed and what to do, in the interface's voice.

Empty states: card with the hero display at 44 and one sentence that says what to change. "No orchestrations. Nothing was created in the last 24 hours. Widen the time range or start a new instance."

Long JSON dialog: svelte-jsoneditor with `class="jse-theme-dfm"`, tree mode, read only, `mainMenuBar` on so search and mode switch remain, `navigationBar` on for deep documents. Blob links (values starting with `https://`) render as a mono link with a download button instead of the editor. Copy to clipboard and Close as the footer actions.

Functions Graph (Svelte Flow): node is a card with ink outline and standard shadow, a 10 px kind band across the top in the `--node-<kind>` color with an ink rule under it, a 11 / 700 muted kind label, the function name in mono 600, and on the results view a row of mini counters for completed, running and failed instance counts. Edges are 2 px ink step edges with square corners (`smoothstep` with radius 0 or straight step), arrowheads filled ink; the active path from the current instance uses the ring color. Selected node gets the 3 px ring. Layout with elkjs layered or dagre, left to right, 48 px rank gap. Background dots in muted foreground, controls and minimap in card with ink outline. Keep the existing "Save as SVG" and the link to az-func-as-a-graph.

Gantt (D3): top axis in mono 11 with a 1 px muted grid every tick, lanes of 32 px separated by 1 px muted rules, label column of 180 px in mono 12 with ellipsis, bars are status-filled with a 2 px ink outline and a mono 11 label inside when it fits, otherwise to the right; the now line is a 2 px dashed ink line; hovering a bar shows an ink-outlined tooltip in card color with the timestamps in mono. Sub-orchestrations are collapsible groups with a triangle toggle.

Time histogram (D3): stacked columns per orchestration name using `--chart-1..5` in order, each segment with a 2 px ink outline, no gaps, no gridlines except a 1 px muted baseline, x ticks in mono 11, legend below with 14 px ink-outlined squares. The brush selection is an ink-outlined rectangle with a diagonal hatch SVG pattern, never a translucent fill. Selecting a range narrows the time filter, as today.

Sequence diagram (D3): participants as ink-outlined boxes in card color with the function name in mono, lifelines as 2 px dashed ink, messages as 2 px ink arrows with filled square arrowheads, failed calls in `--status-failed`, replayed or long-running spans as bars in the status colors, timestamps in mono 11 on the left gutter. Same Save as SVG action.

Side nav: 240 px, card color, ink rule on the right, collapses to a 64 px rail. Items are 40 px rows with a 20 px icon and a sentence-case label; the active item is a tile (primary fill, ink outline, `--shadow-brutal-sm`), hover is muted. A count chip in the failed color sits at the right of Failures. Section gaps are 16 px with no section labels. The collapse control is a ghost button at the bottom.

Stat tile: the loud element of the Overview. Status fill, ink outline, standard shadow, 120 px tall, label 13 / 700 at the top, number in mono 32 / 600, a D3 sparkline of the range at the bottom drawn as a 2 px ink line with no fill. Hover lifts, click filters Instances. The Entities tile uses the entity color.

Facet chip: 30 px, card color, ink outline, `--shadow-brutal-sm`, value in 13 / 700, a 16 px close square on the right; the "add" chip is dashed ink outline with a plus. Active facets never change color; the chip itself is the signal.

Bulk action bar: fixed bottom center, card color, ink outline, long shadow, 52 px, count in mono 600 on the left, actions as default buttons, destructive ones in destructive, a close square at the right. Slides up 8 px on appear (the one motion that is not a hover).

Peek panel: 520 px right panel, card color, ink rule on the left, long shadow, header with the status tile and the instance id in mono 20, an Open button, then Summary and a mini timeline. Closes on Escape and on outside click.

Timeline swimlane: the D3 Gantt of the design system extended with span kinds. Activities and sub-orchestrations are status-filled bars, timers are bars in the suspended color with a clock glyph, external event waits are dotted ink outlines with no fill (waiting is the absence of work), orchestrator replay time is a thin ink bar at the top lane, retries are numbered segments in the same lane. Hover on a span highlights its history rows below; the history row hover highlights the span.

Where the time went: a horizontal stacked bar of the span totals in the same fills as the swimlane, with a four-row legend of kind, duration and percentage in mono. Sits at the top of the Summary column.

Command palette: bits-ui Command in a dialog, 640 px, long shadow, input in mono, groups Go to, Actions, Preferences; the selected row is a primary tile like the active nav item.

Capability badges: Read only (muted fill), Dangerous operations on (stripe-topped chip), Partial results (running fill, on aggregation panels), Provider name in the Settings page as a plain chip.

## 9. Input event operations

The backend lets an operator edit the input an instance received and run it again from there. Three operations, one read endpoint that says which apply. This is the first screen that changes storage under a running system, so the design treats it as a control panel with interlocks, not as another tab of read-only data.

Where it lives: an Inputs tab on the details page, shown for orchestrations only (the endpoint answers 400 for entity ids). The tab label carries the count of input-bearing events, "Inputs (2)". The history table links into it: every `ExecutionStarted` and `EventRaised` row gets an ink-outlined "input" tag in the EventType cell that opens the tab scrolled to that event, and the `#` column (SequenceNumber) is the anchor in both places. When SequenceNumber is null (a provider that does not report it), the tab shows the backend's reason and no actions.

Tab layout:

```
+--------------------------------------------------------------------------------------------+
| Inputs this instance received                       [/// Dangerous operations on ///]       |
| Instance is Failed. Edit the last input and rewind, replay from it, or restart from the     |
| initial input. Sequence numbers are the concurrency token; the list reloads after each run. |
|                                                                                             |
| ! This is a sub-orchestration. Its parent will not be re-run.            (only when warned) |
|                                                                                             |
| +----------------------------------------------------------------------------------------+ |
| | #1   ExecutionStarted  ProcessOrderOrchestrator            2026-09-04 14:02:11.913      | |
| |----------------------------------------------------------------------------------------| |
| | +------------------------------------------------+  Restart in place        [disabled] | |
| | | {                                              |  The instance has received external  | |
| | |   "orderId": "A-1043",                         |  events. Use replay or               | |
| | |   "items": [ ... ]                             |  update-input-and-rewind on the last | |
| | | }                                              |  one instead.                        | |
| | +------------------------------------------------+  Update input and rewind [disabled] | |
| |   read only                                        Only the last input-bearing event   | |
| |                                                    can be edited, and this instance has | |
| |                                                    received external events since it   | |
| |                                                    started.                             | |
| +----------------------------------------------------------------------------------------+ |
| +----------------------------------------------------------------------------------------+ |
| | #27  EventRaised  PaymentApproved   2026-09-04 14:02:24.913                 [last]      | |
| |----------------------------------------------------------------------------------------| |
| | +------------------------------------------------+  [Update input and rewind]          | |
| | | {                                              |  Replaces this input and re-runs    | |
| | |   "approved": true,                            |  only the failed steps.             | |
| | |   "approver": "ops@contoso.com"                |                                     | |
| | | }                                              |  [/// Replay from #27 ///]          | |
| | +------------------------------------------------+  Deletes history after this event   | |
| |   edited   41.2 KB of 60 KB   [Reset to stored]     and runs everything after it again.| |
| +----------------------------------------------------------------------------------------+ |
+--------------------------------------------------------------------------------------------+
```

Rules:

- One card per event from `GET input-events`, in sequence order. Header: `#` and sequence number in mono, event type, name, timestamp. The last input-bearing event gets a "last" chip in the accent color; it is the only card whose editor is editable.
- The editor is svelte-jsoneditor in text mode inside the card, `jse-theme-dfm`, main menu off, status bar on. Read only unless at least one operation on that card is allowed. An "edited" chip in `--status-running` appears as soon as the content differs from the stored input, with a "Reset to stored" ghost button. The size meter reads `Encoding.Unicode` bytes (2 bytes per UTF-16 unit, the backend's rule) against 60 KB; over the limit the meter turns destructive and the write buttons disable with "Input is larger than 60 KB".
- Action column: one button per operation the backend reports for that event, in the order restart-in-place, update-input-and-rewind, replay. `allowed: true` renders an enabled button with a one-line description under it. `allowed: false` renders the button disabled and the backend `reason` verbatim under it in muted text. Buttons never disappear because of eligibility; they only disappear when the backend does not report the operation for that event.
- Operation kinds carry their weight visually. Update input and rewind is a default button (Write). Replay and Restart in place are destructive buttons with the `--stripe` band as a 4 px top border (Dangerous). Read-only mode disables all three with "Read-only mode" as the reason.
- The "Dangerous operations on" badge (chalk text on a stripe-bordered chip) sits at the top right of the tab and, smaller, in the app bar next to the hub name whenever `/about` lists the permission. When the permission is absent, the two dangerous buttons render disabled with the backend's reason ("Dangerous operations are disabled for this deployment (DFM_DANGEROUS_OPERATIONS_ENABLED)"), so operators learn the switch exists.
- `warning` from the response (sub-orchestration) renders once at the top of the tab as an ink-outlined note, not per card.
- `requiresTerminate: true` on replay changes the confirm dialog, not the button.

Confirm dialogs (all follow section 8: 560 px, long shadow, Cancel on the left):

| Operation | Band | Title | Body | Extra controls | Confirm label |
|---|---|---|---|---|---|
| Update input and rewind | none | Update input and rewind | Replaces the input of event #27 (PaymentApproved) and rewinds the instance. Only the failed steps run again and see the new input. Completed steps keep their results. | Reason (optional) text field | Update and rewind |
| Replay | stripe | Replay from event #27 | Deletes history from event #27 onward, reopens the instance and raises PaymentApproved again with the input shown. Every step after the event runs again, including activities that already completed. | When `requiresTerminate`: a required checkbox "Terminate the running instance first (waits up to 30 seconds)" that sends `terminateIfRunning: true`. Note about late messages from the previous run. | Replay from #27 |
| Restart in place | stripe | Purge and restart in place | Purges this instance, its history and its large-message blobs, then starts a new instance with the same id and the input shown. Sub-orchestrations of the old run are not purged. | none | Purge and restart |

When the editor content differs from the stored input, the body says "with your edited input" and the dialog shows the first 6 lines of the payload in mono so the operator confirms what is about to be sent. When the content is unchanged, replay and restart say "with the stored input".

Outcomes:

- 200: toast in the completed color with the backend's numbers ("Rewound with the updated input", "Replayed from #27, 14 history rows removed", "Restarted in place"), then reload details, history and inputs. After restart in place the ExecutionId changes and the history is short again; the toast says so.
- 409: reload inputs first, then a destructive toast with the server message, prefixed "The list was refreshed."
- 413: the meter already blocks this; if it arrives anyway, destructive toast "Input is larger than 60 KB. Shorten it and try again."
- 403 and 400: destructive toast with the server message; 400 on an entity id never happens because the tab is hidden for entities.
- 500 with a recovery payload, rendered as a dialog with the stripe band, never as a toast:
  - Restart in place failed after the purge: "The instance was purged but could not be restarted. Start it again with the input below." Primary action "Start new instance with this input", which opens Start New Instance prefilled with instanceId, orchestrator name and input from the response.
  - Replay failed after the history cut: "History was cut and the instance reopened, but PaymentApproved was not raised." Primary action "Raise event now", opening Raise Event prefilled with `eventName` and the input from the response.
  - Update failed at the rewind: "The input was updated but the rewind failed." Primary action "Rewind", the existing action.

History table after an operation: rewound rows arrive as `GenericEvent` with a "Rewound: ..." reason; render them with the continued color spine and the reason in the Details cell. The `#` column makes the cut visible after a replay (the numbers continue where the truncated history ended).

Copy for the empty and blocked states:

- No input events: "No inputs recorded for this execution yet."
- Provider without sequence numbers: the backend reason verbatim, with the actions hidden.
- Netherite or MSSQL without editing routines: buttons disabled with the backend reason; restart in place stays enabled where eligible.

## 10. Screens

The screens are specified in `dfm-rewrite-plan.md` section 4 (Overview, Instances, Instance workspace, Failures, Entities, Functions, Storage, Activity, Settings). The visual rules that apply to all of them:

```
+--------+-----------------------------------------------------------------------------------+
| [#]    | DurableFunctionsHub v   [ Find instance ...           ]  [/// Dangerous on ///]  |
| DFM    |                                       Auto-refresh 5 s v   UTC v   (theme) (user)  |
|        +-----------------------------------------------------------------------------------+
| Overview                                                                                   |
| Instances                page content, left aligned, 24 px gutter, 40 px section gap       |
| Failures  9                                                                                |
| Entities                                                                                   |
| Functions                                                                                  |
| Storage                                                                                    |
| Activity                                                                                   |
|                                                                                            |
| Settings                                                                                   |
| <<                                                                                         |
+--------+-----------------------------------------------------------------------------------+
```

- One loud element per screen: the stat tiles on Overview, the status spine on Instances, the status tile in the workspace header, the group count on Failures. Everything else is ink, paper and mono.
- Tables are the only elements with the standard shadow on list screens; panels and dialogs get the long shadow; nothing else floats.
- The instance workspace is a two-column layout under the header: a 320 px sticky Summary column and the tab content. Below 1100 px the Summary collapses into a tab.
- Overview panels are cards with an ink outline and no shadow; the tiles above them carry the shadow.
- Every aggregation panel shows `scanned` and `partial` in meta text at its top right.
- The VS Code webview uses the same screens with the side nav collapsed; `DfmViewMode=1` shows Functions alone with no nav.

## 11. Content for mockups

Use these instead of lorem ipsum so the type and the tables are tested against real widths.

- Task hub: DurableFunctionsHub. Storage: dfmstorage001.
- Orchestrators: ProcessOrderOrchestrator, ReconcileLedgerOrchestrator, NotifyCustomer (sub-orchestrator), OnboardTenantOrchestrator.
- Activities: ReserveInventory, ChargePayment, SendConfirmation, ArchiveBlob, ExportReport.
- Entity: Counter, keys `@counter@warehouse-07`, `@counter@warehouse-12`.
- Triggers: StartOrder (HTTP), NightlyReconcile (timer), OnPaymentSettled (Service Bus).
- Instance ids: `order-2026-09-04-000913`, `nightly-reconcile-20260903`, `8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8`.
- History event types: ExecutionStarted, TaskScheduled, TaskCompleted, TaskFailed, TimerCreated, TimerFired, SubOrchestrationInstanceCreated, SubOrchestrationInstanceCompleted, EventRaised, ExecutionCompleted.
- customStatus samples: `{"step":"ChargePayment","attempt":2}`, `{"error":"InventoryUnavailable","sku":"SKU-4471"}`.
- Counts that stress the layout: 1,284 instances match, 238 events, 3 columns hidden, 412 completed, 9 failed.

## 12. Brief for Claude Design

Paste the following and attach `dfm-tokens.css` and `dfm-theme-preview.html`:

> Design the Durable Functions Monitor web UI in a neo-brutalist style using the attached design system and rewrite plan (side nav, Overview dashboard, Instances, Instance workspace, Failures). Framework is Svelte 5 with Tailwind v4, shadcn-svelte and bits-ui; graphs use D3 and Svelte Flow; JSON uses svelte-jsoneditor. Use only the CSS variables in dfm-tokens.css: never introduce a color, radius, shadow or font that is not a token. Produce, at 1440 wide with the side nav open, in theme `poster` light and dark: the Overview screen, the Instances screen with two rows selected and the bulk action bar showing, the Instance workspace on the Timeline tab with the Summary column, and the same instance on the Inputs tab with the replay confirm dialog. Then the Failures screen in `blueprint` light and dark with one group expanded. Follow the shell rules in section 10 of the design system and the screen specifications in sections 3 and 4 of the rewrite plan. Show the Dangerous operations badge in the top bar and the Failures count in the side nav. Solid status fills with dark text and an ink outline, hard offset shadows only, no gradients, no alpha tints, no soft shadows, no all caps labels, sentence case. Archivo for UI text, JetBrains Mono for ids, timestamps, JSON and function names. Use the sample content in section 10. Every interactive element must show the pressed and focused state at least once. Deliver the screens as HTML using the token utilities so the same markup can be re-themed by switching `data-theme` and the `dark` class on `<html>`.

Repeat with the other three themes once the first batch lands, and ask for Functions, Storage and the peek panel as separate deliverables since they carry the most custom drawing. Ask for the three recovery dialogs from section 9 and the partial-results banner in the same batch as the Inputs tab; they are the states most likely to be skipped.

## 13. Theme tables

### Poster (`data-theme="poster"`)

The canonical neo-brutalist sheet: bone paper, black line, six loud print colors. Default theme.

Metrics: radius 0px, line 2px, shadow offset 4px (dialogs 8px), background pattern: none.

| Token | Light | Dark |
|---|---|---|
| Background (paper) | `#F8F6F1` | `#1B1930` |
| Card / popover | `#FFFFFF` | `#262342` |
| Foreground text | `#000000` | `#F8F6F1` |
| Ink (borders, rules) | `#000000` | `#F8F6F1` |
| Shadow color | `#000000` | `#F8F6F1` |
| Primary | `#FFD400` | `#FFD400` |
| Secondary | `#FFFFFF` | `#262342` |
| Accent (hover, highlight, selection) | `#6FE3FF` | `#6FE3FF` |
| Muted surface | `#ECE9E0` | `#332F52` |
| Muted text | `#5B5852` | `#B8B3CF` |
| Destructive | `#FF3B3B` | `#FF5C5C` |
| Focus ring | `#FF2D8C` | `#FF5DA2` |
| Text on poster fills | `#000000` | `#000000` |
| Poster 1 | `#FFD400` | `#FFD400` |
| Poster 2 | `#FF5DA2` | `#FF5DA2` |
| Poster 3 | `#6FE3FF` | `#6FE3FF` |
| Poster 4 | `#B6FF5C` | `#B6FF5C` |
| Poster 5 | `#9D7BFF` | `#9D7BFF` |
| Poster 6 | `#FF8A3D` | `#FF8A3D` |

| Runtime status | Light fill | Dark fill | Text |
|---|---|---|---|
| Completed | `#4EE07A` | `#4EE07A` | on-poster |
| Running | `#FFD400` | `#FFD400` | on-poster |
| Failed | `#FF3B3B` | `#FF5C5C` | on-poster |
| Pending | `#6FE3FF` | `#6FE3FF` | on-poster |
| Terminated | `#C9C3B5` | `#6F6A85` | gray text rule |
| Canceled | `#E2DED2` | `#4E4A63` | gray text rule |
| ContinuedAsNew | `#9D7BFF` | `#9D7BFF` | on-poster |
| Suspended | `#FF8A3D` | `#FF8A3D` | on-poster |
| Entity (kind) | `#FF5DA2` | `#FF5DA2` | on-poster |

| Graph node | Light | Dark |
|---|---|---|
| Orchestrator | `#FFD400` | `#FFD400` |
| Activity | `#6FE3FF` | `#6FE3FF` |
| Entity | `#FF5DA2` | `#FF5DA2` |
| Sub-orchestrator | `#9D7BFF` | `#9D7BFF` |
| HTTP trigger | `#B6FF5C` | `#B6FF5C` |
| Timer trigger | `#FF8A3D` | `#FF8A3D` |
| Queue / Service Bus / Event Hub trigger | `#D5D0C4` | `#A39EB4` |
| Other binding | card color, ink border | card color, ink border |

### Riso (`data-theme="riso"`)

Risograph print: newsprint paper, soft riso black, fluorescent pink, blue, sunflower, teal. Dark mode prints on navy stock.

Metrics: radius 2px, line 2px, shadow offset 4px (dialogs 8px), background pattern: halftone.

| Token | Light | Dark |
|---|---|---|
| Background (paper) | `#F2EEE6` | `#10203A` |
| Card / popover | `#FBF9F4` | `#182D52` |
| Foreground text | `#231F20` | `#F2EEE6` |
| Ink (borders, rules) | `#231F20` | `#F2EEE6` |
| Shadow color | `#231F20` | `#FFE800` |
| Primary | `#FF48B0` | `#FF48B0` |
| Secondary | `#0078BF` | `#5EC8E5` |
| Accent (hover, highlight, selection) | `#FFE800` | `#FFE800` |
| Muted surface | `#E4DED2` | `#24406B` |
| Muted text | `#5F5A57` | `#B9C6DD` |
| Destructive | `#F15060` | `#F15060` |
| Focus ring | `#0078BF` | `#FFE800` |
| Text on poster fills | `#231F20` | `#231F20` |
| Poster 1 | `#FF48B0` | `#FF48B0` |
| Poster 2 | `#0078BF` | `#5EC8E5` |
| Poster 3 | `#FFE800` | `#FFE800` |
| Poster 4 | `#00A29C` | `#00A29C` |
| Poster 5 | `#FF6C2F` | `#FF6C2F` |
| Poster 6 | `#765BA7` | `#B9A7E6` |

| Runtime status | Light fill | Dark fill | Text |
|---|---|---|---|
| Completed | `#00A95C` | `#00A95C` | on-poster |
| Running | `#FFE800` | `#FFE800` | on-poster |
| Failed | `#F15060` | `#F15060` | on-poster |
| Pending | `#5EC8E5` | `#5EC8E5` | on-poster |
| Terminated | `#A8A29B` | `#55627C` | gray text rule |
| Canceled | `#D3CDC2` | `#3E4E6E` | gray text rule |
| ContinuedAsNew | `#B9A7E6` | `#B9A7E6` | on-poster |
| Suspended | `#FF6C2F` | `#FF6C2F` | on-poster |
| Entity (kind) | `#FF48B0` | `#FF48B0` | on-poster |

| Graph node | Light | Dark |
|---|---|---|
| Orchestrator | `#FFE800` | `#FFE800` |
| Activity | `#5EC8E5` | `#5EC8E5` |
| Entity | `#FF48B0` | `#FF48B0` |
| Sub-orchestrator | `#B9A7E6` | `#B9A7E6` |
| HTTP trigger | `#00A29C` | `#00A29C` |
| Timer trigger | `#FF6C2F` | `#FF6C2F` |
| Queue / Service Bus / Event Hub trigger | `#C9C3B8` | `#9AA7BF` |
| Other binding | card color, ink border | card color, ink border |

### Memphis (`data-theme="memphis"`)

Sottsass pastels with a heavy black outline: bubblegum, mint, lemon, lilac, tangerine, sky. Rounder corners, thicker line. Dark mode is plum.

Metrics: radius 10px, line 3px, shadow offset 5px (dialogs 10px), background pattern: dots.

| Token | Light | Dark |
|---|---|---|
| Background (paper) | `#F6F3FA` | `#2A1F3D` |
| Card / popover | `#FFFFFF` | `#3A2C52` |
| Foreground text | `#000000` | `#FBF7FF` |
| Ink (borders, rules) | `#000000` | `#FBF7FF` |
| Shadow color | `#000000` | `#FBF7FF` |
| Primary | `#FF9ECF` | `#FF9ECF` |
| Secondary | `#C4B0F8` | `#C4B0F8` |
| Accent (hover, highlight, selection) | `#7EE8C4` | `#7EE8C4` |
| Muted surface | `#EBE6F2` | `#4A3B66` |
| Muted text | `#5A556B` | `#CFC3E6` |
| Destructive | `#FF6B6B` | `#FF6B6B` |
| Focus ring | `#7C5CE6` | `#7EE8C4` |
| Text on poster fills | `#000000` | `#000000` |
| Poster 1 | `#FF9ECF` | `#FF9ECF` |
| Poster 2 | `#7EE8C4` | `#7EE8C4` |
| Poster 3 | `#FFF06B` | `#FFF06B` |
| Poster 4 | `#C4B0F8` | `#C4B0F8` |
| Poster 5 | `#FFAA5C` | `#FFAA5C` |
| Poster 6 | `#8ED6FF` | `#8ED6FF` |

| Runtime status | Light fill | Dark fill | Text |
|---|---|---|---|
| Completed | `#7EE8C4` | `#7EE8C4` | on-poster |
| Running | `#FFF06B` | `#FFF06B` | on-poster |
| Failed | `#FF6B6B` | `#FF6B6B` | on-poster |
| Pending | `#8ED6FF` | `#8ED6FF` | on-poster |
| Terminated | `#CFCBD6` | `#6E6286` | gray text rule |
| Canceled | `#E9E6EE` | `#564A70` | gray text rule |
| ContinuedAsNew | `#C4B0F8` | `#C4B0F8` | on-poster |
| Suspended | `#FFAA5C` | `#FFAA5C` | on-poster |
| Entity (kind) | `#FF9ECF` | `#FF9ECF` | on-poster |

| Graph node | Light | Dark |
|---|---|---|
| Orchestrator | `#FFF06B` | `#FFF06B` |
| Activity | `#8ED6FF` | `#8ED6FF` |
| Entity | `#FF9ECF` | `#FF9ECF` |
| Sub-orchestrator | `#C4B0F8` | `#C4B0F8` |
| HTTP trigger | `#7EE8C4` | `#7EE8C4` |
| Timer trigger | `#FFAA5C` | `#FFAA5C` |
| Queue / Service Bus / Event Hub trigger | `#D9D5E0` | `#A79FBE` |
| Other binding | card color, ink border | card color, ink border |

### Blueprint (`data-theme="blueprint"`)

Engineering drawing: the line is cobalt, not black. Safety orange and chartreuse on drafting paper. Dark mode is the classic white-on-blueprint.

Metrics: radius 0px, line 2px, shadow offset 4px (dialogs 8px), background pattern: grid.

| Token | Light | Dark |
|---|---|---|
| Background (paper) | `#EEF2FF` | `#08205F` |
| Card / popover | `#FFFFFF` | `#0F2C7A` |
| Foreground text | `#0A1A5C` | `#EEF2FF` |
| Ink (borders, rules) | `#1636E0` | `#EEF2FF` |
| Shadow color | `#1636E0` | `#EEF2FF` |
| Primary | `#FF6A00` | `#FF6A00` |
| Secondary | `#1636E0` | `#FFFFFF` |
| Accent (hover, highlight, selection) | `#C8FF3D` | `#C8FF3D` |
| Muted surface | `#DCE3FA` | `#1C3C93` |
| Muted text | `#3E4E8C` | `#B9C7F2` |
| Destructive | `#FF4D66` | `#FF4D66` |
| Focus ring | `#FF2E88` | `#C8FF3D` |
| Text on poster fills | `#0A1A5C` | `#08205F` |
| Poster 1 | `#FF6A00` | `#FF6A00` |
| Poster 2 | `#1636E0` | `#6C86FF` |
| Poster 3 | `#C8FF3D` | `#C8FF3D` |
| Poster 4 | `#FF2E88` | `#FF4F9C` |
| Poster 5 | `#33D6FF` | `#33D6FF` |
| Poster 6 | `#FFB300` | `#FFB300` |

| Runtime status | Light fill | Dark fill | Text |
|---|---|---|---|
| Completed | `#C8FF3D` | `#C8FF3D` | on-poster |
| Running | `#FF6A00` | `#FF6A00` | on-poster |
| Failed | `#FF4D66` | `#FF4D66` | on-poster |
| Pending | `#33D6FF` | `#33D6FF` | on-poster |
| Terminated | `#B8C2E6` | `#4F63A3` | gray text rule |
| Canceled | `#D9DFF5` | `#33499A` | gray text rule |
| ContinuedAsNew | `#FF7AB8` | `#FF7AB8` | on-poster |
| Suspended | `#FFB300` | `#FFB300` | on-poster |
| Entity (kind) | `#FF2E88` | `#FF4F9C` | on-poster |

| Graph node | Light | Dark |
|---|---|---|
| Orchestrator | `#FF6A00` | `#FF6A00` |
| Activity | `#33D6FF` | `#33D6FF` |
| Entity | `#FF2E88` | `#FF4F9C` |
| Sub-orchestrator | `#6C86FF` | `#6C86FF` |
| HTTP trigger | `#C8FF3D` | `#C8FF3D` |
| Timer trigger | `#FFB300` | `#FFB300` |
| Queue / Service Bus / Event Hub trigger | `#C5CEEE` | `#9AA9E0` |
| Other binding | card color, ink border | card color, ink border |

### Hazard (`data-theme="hazard"`)

Industrial signage: chalk, black, caution yellow, signal red, safety orange and green, hi-vis pink. Diagonal stripes mark destructive actions and progress.

Metrics: radius 0px, line 3px, shadow offset 4px (dialogs 8px), background pattern: none.

| Token | Light | Dark |
|---|---|---|
| Background (paper) | `#F4F4F1` | `#23262C` |
| Card / popover | `#FFFFFF` | `#2E3239` |
| Foreground text | `#000000` | `#F4F4F1` |
| Ink (borders, rules) | `#000000` | `#F4F4F1` |
| Shadow color | `#000000` | `#FFC800` |
| Primary | `#FFC800` | `#FFC800` |
| Secondary | `#2B2E33` | `#F4F4F1` |
| Accent (hover, highlight, selection) | `#7FD8FF` | `#7FD8FF` |
| Muted surface | `#E6E7E3` | `#3B4048` |
| Muted text | `#55585E` | `#B4BAC3` |
| Destructive | `#FF2D2D` | `#FF2D2D` |
| Focus ring | `#0064D2` | `#FFC800` |
| Text on poster fills | `#000000` | `#000000` |
| Poster 1 | `#FFC800` | `#FFC800` |
| Poster 2 | `#FF2D2D` | `#FF2D2D` |
| Poster 3 | `#FF7A1A` | `#FF7A1A` |
| Poster 4 | `#3BD45C` | `#3BD45C` |
| Poster 5 | `#7FD8FF` | `#7FD8FF` |
| Poster 6 | `#FF4FA3` | `#FF4FA3` |

| Runtime status | Light fill | Dark fill | Text |
|---|---|---|---|
| Completed | `#3BD45C` | `#3BD45C` | on-poster |
| Running | `#FFC800` | `#FFC800` | on-poster |
| Failed | `#FF2D2D` | `#FF2D2D` | on-poster |
| Pending | `#7FD8FF` | `#7FD8FF` | on-poster |
| Terminated | `#A9AFB7` | `#5F6774` | gray text rule |
| Canceled | `#D5D9DE` | `#474D56` | gray text rule |
| ContinuedAsNew | `#B48CFF` | `#B48CFF` | on-poster |
| Suspended | `#FF7A1A` | `#FF7A1A` | on-poster |
| Entity (kind) | `#FF4FA3` | `#FF4FA3` | on-poster |

| Graph node | Light | Dark |
|---|---|---|
| Orchestrator | `#FFC800` | `#FFC800` |
| Activity | `#7FD8FF` | `#7FD8FF` |
| Entity | `#FF4FA3` | `#FF4FA3` |
| Sub-orchestrator | `#B48CFF` | `#B48CFF` |
| HTTP trigger | `#3BD45C` | `#3BD45C` |
| Timer trigger | `#FF7A1A` | `#FF7A1A` |
| Queue / Service Bus / Event Hub trigger | `#C9CED4` | `#A3AAB4` |
| Other binding | card color, ink border | card color, ink border |

## 14. Appendix: dfm-tokens.css

The complete token file, identical to the attached `dfm-tokens.css`.

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
@custom-variant theme-poster (&:is([data-theme="poster"] *));
@custom-variant theme-riso (&:is([data-theme="riso"] *));
@custom-variant theme-memphis (&:is([data-theme="memphis"] *));
@custom-variant theme-blueprint (&:is([data-theme="blueprint"] *));
@custom-variant theme-hazard (&:is([data-theme="hazard"] *));

/* Map raw variables to Tailwind utilities. `inline` so per theme and per mode overrides resolve at use time. */
@theme inline {
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);

  --radius-sm: calc(var(--radius) * 0.5);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) * 1.5);
  --radius-xl: calc(var(--radius) * 2);

  --shadow-brutal: var(--shadow-brutal);
  --shadow-brutal-sm: var(--shadow-brutal-sm);
  --shadow-brutal-lg: var(--shadow-brutal-lg);
  --shadow-brutal-hover: var(--shadow-brutal-hover);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-ink: var(--ink);
  --color-paper: var(--paper);
  --color-on-poster: var(--on-poster);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --color-poster-1: var(--poster-1);
  --color-poster-2: var(--poster-2);
  --color-poster-3: var(--poster-3);
  --color-poster-4: var(--poster-4);
  --color-poster-5: var(--poster-5);
  --color-poster-6: var(--poster-6);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-status-completed: var(--status-completed);
  --color-status-completed-foreground: var(--status-completed-foreground);
  --color-status-running: var(--status-running);
  --color-status-running-foreground: var(--status-running-foreground);
  --color-status-failed: var(--status-failed);
  --color-status-failed-foreground: var(--status-failed-foreground);
  --color-status-pending: var(--status-pending);
  --color-status-pending-foreground: var(--status-pending-foreground);
  --color-status-terminated: var(--status-terminated);
  --color-status-terminated-foreground: var(--status-terminated-foreground);
  --color-status-canceled: var(--status-canceled);
  --color-status-canceled-foreground: var(--status-canceled-foreground);
  --color-status-continued: var(--status-continued);
  --color-status-continued-foreground: var(--status-continued-foreground);
  --color-status-suspended: var(--status-suspended);
  --color-status-suspended-foreground: var(--status-suspended-foreground);
  --color-kind-orchestration: var(--kind-orchestration);
  --color-kind-orchestration-foreground: var(--kind-orchestration-foreground);
  --color-kind-entity: var(--kind-entity);
  --color-kind-entity-foreground: var(--kind-entity-foreground);
  --color-node-orchestrator: var(--node-orchestrator);
  --color-node-activity: var(--node-activity);
  --color-node-entity: var(--node-entity);
  --color-node-suborchestrator: var(--node-suborchestrator);
  --color-node-http: var(--node-http);
  --color-node-timer: var(--node-timer);
  --color-node-queue: var(--node-queue);
  --color-node-other: var(--node-other);
  --color-node-foreground: var(--node-foreground);
  --color-json-key: var(--json-key);
  --color-json-string: var(--json-string);
  --color-json-number: var(--json-number);
  --color-json-boolean: var(--json-boolean);
  --color-json-null: var(--json-null);
  --color-json-punctuation: var(--json-punctuation);
}

/* DFM design tokens. Theme = [data-theme] on <html>, mode = .dark class on <html>. Generated, do not hand edit. */

/* ---------- Poster ---------- */
:root,
[data-theme="poster"] {
  --radius: 0px;
  --border-width: 2px;
  --shadow-offset: 4px;
  --shadow-offset-lg: 8px;
  --pattern: none;
  --background: #F8F6F1;
  --foreground: #000000;
  --card: #FFFFFF;
  --card-foreground: #000000;
  --popover: #FFFFFF;
  --popover-foreground: #000000;
  --primary: #FFD400;
  --primary-foreground: #000000;
  --secondary: #FFFFFF;
  --secondary-foreground: #000000;
  --accent: #6FE3FF;
  --accent-foreground: #000000;
  --muted: #ECE9E0;
  --muted-foreground: #5B5852;
  --destructive: #FF3B3B;
  --destructive-foreground: #000000;
  --border: #000000;
  --input: #F8F6F1;
  --ring: #FF2D8C;
  --ink: #000000;
  --paper: #F8F6F1;
  --shadow-ink: #000000;
  --on-poster: #000000;
  --sidebar: #FFFFFF;
  --sidebar-foreground: #000000;
  --sidebar-primary: #FFD400;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #6FE3FF;
  --sidebar-accent-foreground: #000000;
  --sidebar-border: #000000;
  --sidebar-ring: #FF2D8C;
  --poster-1: #FFD400;
  --poster-2: #FF5DA2;
  --poster-3: #6FE3FF;
  --poster-4: #B6FF5C;
  --poster-5: #9D7BFF;
  --poster-6: #FF8A3D;
  --chart-1: #FFD400;
  --chart-2: #FF5DA2;
  --chart-3: #6FE3FF;
  --chart-4: #B6FF5C;
  --chart-5: #9D7BFF;
  --status-completed: #4EE07A;
  --status-completed-foreground: #000000;
  --status-running: #FFD400;
  --status-running-foreground: #000000;
  --status-failed: #FF3B3B;
  --status-failed-foreground: #000000;
  --status-pending: #6FE3FF;
  --status-pending-foreground: #000000;
  --status-terminated: #C9C3B5;
  --status-terminated-foreground: #000000;
  --status-canceled: #E2DED2;
  --status-canceled-foreground: #000000;
  --status-continued: #9D7BFF;
  --status-continued-foreground: #000000;
  --status-suspended: #FF8A3D;
  --status-suspended-foreground: #000000;
  --kind-orchestration: #FFFFFF;
  --kind-orchestration-foreground: #000000;
  --kind-entity: #FF5DA2;
  --kind-entity-foreground: #000000;
  --node-orchestrator: #FFD400;
  --node-activity: #6FE3FF;
  --node-entity: #FF5DA2;
  --node-suborchestrator: #9D7BFF;
  --node-http: #B6FF5C;
  --node-timer: #FF8A3D;
  --node-queue: #D5D0C4;
  --node-other: #FFFFFF;
  --node-foreground: #000000;
  --json-key: #000000;
  --json-string: #B8175F;
  --json-number: #0B7A99;
  --json-boolean: #5B3FD1;
  --json-null: #5B5852;
  --json-punctuation: #5B5852;
}
.dark,
.dark[data-theme="poster"] {
  --background: #1B1930;
  --foreground: #F8F6F1;
  --card: #262342;
  --card-foreground: #F8F6F1;
  --popover: #262342;
  --popover-foreground: #F8F6F1;
  --primary: #FFD400;
  --primary-foreground: #000000;
  --secondary: #262342;
  --secondary-foreground: #F8F6F1;
  --accent: #6FE3FF;
  --accent-foreground: #000000;
  --muted: #332F52;
  --muted-foreground: #B8B3CF;
  --destructive: #FF5C5C;
  --destructive-foreground: #000000;
  --border: #F8F6F1;
  --input: #1B1930;
  --ring: #FF5DA2;
  --ink: #F8F6F1;
  --paper: #1B1930;
  --shadow-ink: #F8F6F1;
  --on-poster: #000000;
  --sidebar: #262342;
  --sidebar-foreground: #F8F6F1;
  --sidebar-primary: #FFD400;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #6FE3FF;
  --sidebar-accent-foreground: #000000;
  --sidebar-border: #F8F6F1;
  --sidebar-ring: #FF5DA2;
  --poster-1: #FFD400;
  --poster-2: #FF5DA2;
  --poster-3: #6FE3FF;
  --poster-4: #B6FF5C;
  --poster-5: #9D7BFF;
  --poster-6: #FF8A3D;
  --chart-1: #FFD400;
  --chart-2: #FF5DA2;
  --chart-3: #6FE3FF;
  --chart-4: #B6FF5C;
  --chart-5: #9D7BFF;
  --status-completed: #4EE07A;
  --status-completed-foreground: #000000;
  --status-running: #FFD400;
  --status-running-foreground: #000000;
  --status-failed: #FF5C5C;
  --status-failed-foreground: #000000;
  --status-pending: #6FE3FF;
  --status-pending-foreground: #000000;
  --status-terminated: #6F6A85;
  --status-terminated-foreground: #F8F6F1;
  --status-canceled: #4E4A63;
  --status-canceled-foreground: #F8F6F1;
  --status-continued: #9D7BFF;
  --status-continued-foreground: #000000;
  --status-suspended: #FF8A3D;
  --status-suspended-foreground: #000000;
  --kind-orchestration: #262342;
  --kind-orchestration-foreground: #F8F6F1;
  --kind-entity: #FF5DA2;
  --kind-entity-foreground: #000000;
  --node-orchestrator: #FFD400;
  --node-activity: #6FE3FF;
  --node-entity: #FF5DA2;
  --node-suborchestrator: #9D7BFF;
  --node-http: #B6FF5C;
  --node-timer: #FF8A3D;
  --node-queue: #A39EB4;
  --node-other: #262342;
  --node-foreground: #000000;
  --json-key: #F8F6F1;
  --json-string: #FF5DA2;
  --json-number: #6FE3FF;
  --json-boolean: #C4B0FF;
  --json-null: #B8B3CF;
  --json-punctuation: #B8B3CF;
}

/* ---------- Riso ---------- */
[data-theme="riso"] {
  --radius: 2px;
  --border-width: 2px;
  --shadow-offset: 4px;
  --shadow-offset-lg: 8px;
  --pattern: halftone;
  --background: #F2EEE6;
  --foreground: #231F20;
  --card: #FBF9F4;
  --card-foreground: #231F20;
  --popover: #FBF9F4;
  --popover-foreground: #231F20;
  --primary: #FF48B0;
  --primary-foreground: #231F20;
  --secondary: #0078BF;
  --secondary-foreground: #FFFFFF;
  --accent: #FFE800;
  --accent-foreground: #231F20;
  --muted: #E4DED2;
  --muted-foreground: #5F5A57;
  --destructive: #F15060;
  --destructive-foreground: #231F20;
  --border: #231F20;
  --input: #F2EEE6;
  --ring: #0078BF;
  --ink: #231F20;
  --paper: #F2EEE6;
  --shadow-ink: #231F20;
  --on-poster: #231F20;
  --sidebar: #FBF9F4;
  --sidebar-foreground: #231F20;
  --sidebar-primary: #FF48B0;
  --sidebar-primary-foreground: #231F20;
  --sidebar-accent: #FFE800;
  --sidebar-accent-foreground: #231F20;
  --sidebar-border: #231F20;
  --sidebar-ring: #0078BF;
  --poster-1: #FF48B0;
  --poster-2: #0078BF;
  --poster-3: #FFE800;
  --poster-4: #00A29C;
  --poster-5: #FF6C2F;
  --poster-6: #765BA7;
  --chart-1: #FF48B0;
  --chart-2: #0078BF;
  --chart-3: #FFE800;
  --chart-4: #00A29C;
  --chart-5: #FF6C2F;
  --status-completed: #00A95C;
  --status-completed-foreground: #231F20;
  --status-running: #FFE800;
  --status-running-foreground: #231F20;
  --status-failed: #F15060;
  --status-failed-foreground: #231F20;
  --status-pending: #5EC8E5;
  --status-pending-foreground: #231F20;
  --status-terminated: #A8A29B;
  --status-terminated-foreground: #231F20;
  --status-canceled: #D3CDC2;
  --status-canceled-foreground: #231F20;
  --status-continued: #B9A7E6;
  --status-continued-foreground: #231F20;
  --status-suspended: #FF6C2F;
  --status-suspended-foreground: #231F20;
  --kind-orchestration: #FBF9F4;
  --kind-orchestration-foreground: #231F20;
  --kind-entity: #FF48B0;
  --kind-entity-foreground: #231F20;
  --node-orchestrator: #FFE800;
  --node-activity: #5EC8E5;
  --node-entity: #FF48B0;
  --node-suborchestrator: #B9A7E6;
  --node-http: #00A29C;
  --node-timer: #FF6C2F;
  --node-queue: #C9C3B8;
  --node-other: #FBF9F4;
  --node-foreground: #231F20;
  --json-key: #231F20;
  --json-string: #C41E5C;
  --json-number: #0B5FA5;
  --json-boolean: #6A4CA8;
  --json-null: #5F5A57;
  --json-punctuation: #5F5A57;
}
.dark[data-theme="riso"] {
  --background: #10203A;
  --foreground: #F2EEE6;
  --card: #182D52;
  --card-foreground: #F2EEE6;
  --popover: #182D52;
  --popover-foreground: #F2EEE6;
  --primary: #FF48B0;
  --primary-foreground: #231F20;
  --secondary: #5EC8E5;
  --secondary-foreground: #231F20;
  --accent: #FFE800;
  --accent-foreground: #231F20;
  --muted: #24406B;
  --muted-foreground: #B9C6DD;
  --destructive: #F15060;
  --destructive-foreground: #231F20;
  --border: #F2EEE6;
  --input: #10203A;
  --ring: #FFE800;
  --ink: #F2EEE6;
  --paper: #10203A;
  --shadow-ink: #FFE800;
  --on-poster: #231F20;
  --sidebar: #182D52;
  --sidebar-foreground: #F2EEE6;
  --sidebar-primary: #FF48B0;
  --sidebar-primary-foreground: #231F20;
  --sidebar-accent: #FFE800;
  --sidebar-accent-foreground: #231F20;
  --sidebar-border: #F2EEE6;
  --sidebar-ring: #FFE800;
  --poster-1: #FF48B0;
  --poster-2: #5EC8E5;
  --poster-3: #FFE800;
  --poster-4: #00A29C;
  --poster-5: #FF6C2F;
  --poster-6: #B9A7E6;
  --chart-1: #FF48B0;
  --chart-2: #5EC8E5;
  --chart-3: #FFE800;
  --chart-4: #00A29C;
  --chart-5: #FF6C2F;
  --status-completed: #00A95C;
  --status-completed-foreground: #231F20;
  --status-running: #FFE800;
  --status-running-foreground: #231F20;
  --status-failed: #F15060;
  --status-failed-foreground: #231F20;
  --status-pending: #5EC8E5;
  --status-pending-foreground: #231F20;
  --status-terminated: #55627C;
  --status-terminated-foreground: #F2EEE6;
  --status-canceled: #3E4E6E;
  --status-canceled-foreground: #F2EEE6;
  --status-continued: #B9A7E6;
  --status-continued-foreground: #231F20;
  --status-suspended: #FF6C2F;
  --status-suspended-foreground: #231F20;
  --kind-orchestration: #182D52;
  --kind-orchestration-foreground: #F2EEE6;
  --kind-entity: #FF48B0;
  --kind-entity-foreground: #231F20;
  --node-orchestrator: #FFE800;
  --node-activity: #5EC8E5;
  --node-entity: #FF48B0;
  --node-suborchestrator: #B9A7E6;
  --node-http: #00A29C;
  --node-timer: #FF6C2F;
  --node-queue: #9AA7BF;
  --node-other: #182D52;
  --node-foreground: #231F20;
  --json-key: #F2EEE6;
  --json-string: #FF7AC8;
  --json-number: #5EC8E5;
  --json-boolean: #B9A7E6;
  --json-null: #B9C6DD;
  --json-punctuation: #B9C6DD;
}

/* ---------- Memphis ---------- */
[data-theme="memphis"] {
  --radius: 10px;
  --border-width: 3px;
  --shadow-offset: 5px;
  --shadow-offset-lg: 10px;
  --pattern: dots;
  --background: #F6F3FA;
  --foreground: #000000;
  --card: #FFFFFF;
  --card-foreground: #000000;
  --popover: #FFFFFF;
  --popover-foreground: #000000;
  --primary: #FF9ECF;
  --primary-foreground: #000000;
  --secondary: #C4B0F8;
  --secondary-foreground: #000000;
  --accent: #7EE8C4;
  --accent-foreground: #000000;
  --muted: #EBE6F2;
  --muted-foreground: #5A556B;
  --destructive: #FF6B6B;
  --destructive-foreground: #000000;
  --border: #000000;
  --input: #F6F3FA;
  --ring: #7C5CE6;
  --ink: #000000;
  --paper: #F6F3FA;
  --shadow-ink: #000000;
  --on-poster: #000000;
  --sidebar: #FFFFFF;
  --sidebar-foreground: #000000;
  --sidebar-primary: #FF9ECF;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #7EE8C4;
  --sidebar-accent-foreground: #000000;
  --sidebar-border: #000000;
  --sidebar-ring: #7C5CE6;
  --poster-1: #FF9ECF;
  --poster-2: #7EE8C4;
  --poster-3: #FFF06B;
  --poster-4: #C4B0F8;
  --poster-5: #FFAA5C;
  --poster-6: #8ED6FF;
  --chart-1: #FF9ECF;
  --chart-2: #7EE8C4;
  --chart-3: #FFF06B;
  --chart-4: #C4B0F8;
  --chart-5: #FFAA5C;
  --status-completed: #7EE8C4;
  --status-completed-foreground: #000000;
  --status-running: #FFF06B;
  --status-running-foreground: #000000;
  --status-failed: #FF6B6B;
  --status-failed-foreground: #000000;
  --status-pending: #8ED6FF;
  --status-pending-foreground: #000000;
  --status-terminated: #CFCBD6;
  --status-terminated-foreground: #000000;
  --status-canceled: #E9E6EE;
  --status-canceled-foreground: #000000;
  --status-continued: #C4B0F8;
  --status-continued-foreground: #000000;
  --status-suspended: #FFAA5C;
  --status-suspended-foreground: #000000;
  --kind-orchestration: #FFFFFF;
  --kind-orchestration-foreground: #000000;
  --kind-entity: #FF9ECF;
  --kind-entity-foreground: #000000;
  --node-orchestrator: #FFF06B;
  --node-activity: #8ED6FF;
  --node-entity: #FF9ECF;
  --node-suborchestrator: #C4B0F8;
  --node-http: #7EE8C4;
  --node-timer: #FFAA5C;
  --node-queue: #D9D5E0;
  --node-other: #FFFFFF;
  --node-foreground: #000000;
  --json-key: #000000;
  --json-string: #C0397E;
  --json-number: #0E7C86;
  --json-boolean: #6B4BD6;
  --json-null: #5A556B;
  --json-punctuation: #5A556B;
}
.dark[data-theme="memphis"] {
  --background: #2A1F3D;
  --foreground: #FBF7FF;
  --card: #3A2C52;
  --card-foreground: #FBF7FF;
  --popover: #3A2C52;
  --popover-foreground: #FBF7FF;
  --primary: #FF9ECF;
  --primary-foreground: #000000;
  --secondary: #C4B0F8;
  --secondary-foreground: #000000;
  --accent: #7EE8C4;
  --accent-foreground: #000000;
  --muted: #4A3B66;
  --muted-foreground: #CFC3E6;
  --destructive: #FF6B6B;
  --destructive-foreground: #000000;
  --border: #FBF7FF;
  --input: #2A1F3D;
  --ring: #7EE8C4;
  --ink: #FBF7FF;
  --paper: #2A1F3D;
  --shadow-ink: #FBF7FF;
  --on-poster: #000000;
  --sidebar: #3A2C52;
  --sidebar-foreground: #FBF7FF;
  --sidebar-primary: #FF9ECF;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #7EE8C4;
  --sidebar-accent-foreground: #000000;
  --sidebar-border: #FBF7FF;
  --sidebar-ring: #7EE8C4;
  --poster-1: #FF9ECF;
  --poster-2: #7EE8C4;
  --poster-3: #FFF06B;
  --poster-4: #C4B0F8;
  --poster-5: #FFAA5C;
  --poster-6: #8ED6FF;
  --chart-1: #FF9ECF;
  --chart-2: #7EE8C4;
  --chart-3: #FFF06B;
  --chart-4: #C4B0F8;
  --chart-5: #FFAA5C;
  --status-completed: #7EE8C4;
  --status-completed-foreground: #000000;
  --status-running: #FFF06B;
  --status-running-foreground: #000000;
  --status-failed: #FF6B6B;
  --status-failed-foreground: #000000;
  --status-pending: #8ED6FF;
  --status-pending-foreground: #000000;
  --status-terminated: #6E6286;
  --status-terminated-foreground: #FBF7FF;
  --status-canceled: #564A70;
  --status-canceled-foreground: #FBF7FF;
  --status-continued: #C4B0F8;
  --status-continued-foreground: #000000;
  --status-suspended: #FFAA5C;
  --status-suspended-foreground: #000000;
  --kind-orchestration: #3A2C52;
  --kind-orchestration-foreground: #FBF7FF;
  --kind-entity: #FF9ECF;
  --kind-entity-foreground: #000000;
  --node-orchestrator: #FFF06B;
  --node-activity: #8ED6FF;
  --node-entity: #FF9ECF;
  --node-suborchestrator: #C4B0F8;
  --node-http: #7EE8C4;
  --node-timer: #FFAA5C;
  --node-queue: #A79FBE;
  --node-other: #3A2C52;
  --node-foreground: #000000;
  --json-key: #FBF7FF;
  --json-string: #FF9ECF;
  --json-number: #8ED6FF;
  --json-boolean: #C4B0F8;
  --json-null: #CFC3E6;
  --json-punctuation: #CFC3E6;
}

/* ---------- Blueprint ---------- */
[data-theme="blueprint"] {
  --radius: 0px;
  --border-width: 2px;
  --shadow-offset: 4px;
  --shadow-offset-lg: 8px;
  --pattern: grid;
  --background: #EEF2FF;
  --foreground: #0A1A5C;
  --card: #FFFFFF;
  --card-foreground: #0A1A5C;
  --popover: #FFFFFF;
  --popover-foreground: #0A1A5C;
  --primary: #FF6A00;
  --primary-foreground: #0A1A5C;
  --secondary: #1636E0;
  --secondary-foreground: #FFFFFF;
  --accent: #C8FF3D;
  --accent-foreground: #0A1A5C;
  --muted: #DCE3FA;
  --muted-foreground: #3E4E8C;
  --destructive: #FF4D66;
  --destructive-foreground: #0A1A5C;
  --border: #1636E0;
  --input: #EEF2FF;
  --ring: #FF2E88;
  --ink: #1636E0;
  --paper: #EEF2FF;
  --shadow-ink: #1636E0;
  --on-poster: #0A1A5C;
  --sidebar: #FFFFFF;
  --sidebar-foreground: #0A1A5C;
  --sidebar-primary: #FF6A00;
  --sidebar-primary-foreground: #0A1A5C;
  --sidebar-accent: #C8FF3D;
  --sidebar-accent-foreground: #0A1A5C;
  --sidebar-border: #1636E0;
  --sidebar-ring: #FF2E88;
  --poster-1: #FF6A00;
  --poster-2: #1636E0;
  --poster-3: #C8FF3D;
  --poster-4: #FF2E88;
  --poster-5: #33D6FF;
  --poster-6: #FFB300;
  --chart-1: #FF6A00;
  --chart-2: #1636E0;
  --chart-3: #C8FF3D;
  --chart-4: #FF2E88;
  --chart-5: #33D6FF;
  --status-completed: #C8FF3D;
  --status-completed-foreground: #0A1A5C;
  --status-running: #FF6A00;
  --status-running-foreground: #0A1A5C;
  --status-failed: #FF4D66;
  --status-failed-foreground: #0A1A5C;
  --status-pending: #33D6FF;
  --status-pending-foreground: #0A1A5C;
  --status-terminated: #B8C2E6;
  --status-terminated-foreground: #0A1A5C;
  --status-canceled: #D9DFF5;
  --status-canceled-foreground: #0A1A5C;
  --status-continued: #FF7AB8;
  --status-continued-foreground: #0A1A5C;
  --status-suspended: #FFB300;
  --status-suspended-foreground: #0A1A5C;
  --kind-orchestration: #FFFFFF;
  --kind-orchestration-foreground: #0A1A5C;
  --kind-entity: #FF2E88;
  --kind-entity-foreground: #0A1A5C;
  --node-orchestrator: #FF6A00;
  --node-activity: #33D6FF;
  --node-entity: #FF2E88;
  --node-suborchestrator: #6C86FF;
  --node-http: #C8FF3D;
  --node-timer: #FFB300;
  --node-queue: #C5CEEE;
  --node-other: #FFFFFF;
  --node-foreground: #0A1A5C;
  --json-key: #0A1A5C;
  --json-string: #C71F62;
  --json-number: #1636E0;
  --json-boolean: #B34A00;
  --json-null: #3E4E8C;
  --json-punctuation: #3E4E8C;
}
.dark[data-theme="blueprint"] {
  --background: #08205F;
  --foreground: #EEF2FF;
  --card: #0F2C7A;
  --card-foreground: #EEF2FF;
  --popover: #0F2C7A;
  --popover-foreground: #EEF2FF;
  --primary: #FF6A00;
  --primary-foreground: #08205F;
  --secondary: #FFFFFF;
  --secondary-foreground: #08205F;
  --accent: #C8FF3D;
  --accent-foreground: #08205F;
  --muted: #1C3C93;
  --muted-foreground: #B9C7F2;
  --destructive: #FF4D66;
  --destructive-foreground: #08205F;
  --border: #EEF2FF;
  --input: #08205F;
  --ring: #C8FF3D;
  --ink: #EEF2FF;
  --paper: #08205F;
  --shadow-ink: #EEF2FF;
  --on-poster: #08205F;
  --sidebar: #0F2C7A;
  --sidebar-foreground: #EEF2FF;
  --sidebar-primary: #FF6A00;
  --sidebar-primary-foreground: #08205F;
  --sidebar-accent: #C8FF3D;
  --sidebar-accent-foreground: #08205F;
  --sidebar-border: #EEF2FF;
  --sidebar-ring: #C8FF3D;
  --poster-1: #FF6A00;
  --poster-2: #6C86FF;
  --poster-3: #C8FF3D;
  --poster-4: #FF4F9C;
  --poster-5: #33D6FF;
  --poster-6: #FFB300;
  --chart-1: #FF6A00;
  --chart-2: #6C86FF;
  --chart-3: #C8FF3D;
  --chart-4: #FF4F9C;
  --chart-5: #33D6FF;
  --status-completed: #C8FF3D;
  --status-completed-foreground: #08205F;
  --status-running: #FF6A00;
  --status-running-foreground: #08205F;
  --status-failed: #FF4D66;
  --status-failed-foreground: #08205F;
  --status-pending: #33D6FF;
  --status-pending-foreground: #08205F;
  --status-terminated: #4F63A3;
  --status-terminated-foreground: #EEF2FF;
  --status-canceled: #33499A;
  --status-canceled-foreground: #EEF2FF;
  --status-continued: #FF7AB8;
  --status-continued-foreground: #08205F;
  --status-suspended: #FFB300;
  --status-suspended-foreground: #08205F;
  --kind-orchestration: #0F2C7A;
  --kind-orchestration-foreground: #EEF2FF;
  --kind-entity: #FF4F9C;
  --kind-entity-foreground: #08205F;
  --node-orchestrator: #FF6A00;
  --node-activity: #33D6FF;
  --node-entity: #FF4F9C;
  --node-suborchestrator: #6C86FF;
  --node-http: #C8FF3D;
  --node-timer: #FFB300;
  --node-queue: #9AA9E0;
  --node-other: #0F2C7A;
  --node-foreground: #08205F;
  --json-key: #EEF2FF;
  --json-string: #FF7AB8;
  --json-number: #33D6FF;
  --json-boolean: #FFB300;
  --json-null: #B9C7F2;
  --json-punctuation: #B9C7F2;
}

/* ---------- Hazard ---------- */
[data-theme="hazard"] {
  --radius: 0px;
  --border-width: 3px;
  --shadow-offset: 4px;
  --shadow-offset-lg: 8px;
  --pattern: none;
  --background: #F4F4F1;
  --foreground: #000000;
  --card: #FFFFFF;
  --card-foreground: #000000;
  --popover: #FFFFFF;
  --popover-foreground: #000000;
  --primary: #FFC800;
  --primary-foreground: #000000;
  --secondary: #2B2E33;
  --secondary-foreground: #FFFFFF;
  --accent: #7FD8FF;
  --accent-foreground: #000000;
  --muted: #E6E7E3;
  --muted-foreground: #55585E;
  --destructive: #FF2D2D;
  --destructive-foreground: #000000;
  --border: #000000;
  --input: #F4F4F1;
  --ring: #0064D2;
  --ink: #000000;
  --paper: #F4F4F1;
  --shadow-ink: #000000;
  --on-poster: #000000;
  --sidebar: #FFFFFF;
  --sidebar-foreground: #000000;
  --sidebar-primary: #FFC800;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #7FD8FF;
  --sidebar-accent-foreground: #000000;
  --sidebar-border: #000000;
  --sidebar-ring: #0064D2;
  --poster-1: #FFC800;
  --poster-2: #FF2D2D;
  --poster-3: #FF7A1A;
  --poster-4: #3BD45C;
  --poster-5: #7FD8FF;
  --poster-6: #FF4FA3;
  --chart-1: #FFC800;
  --chart-2: #FF2D2D;
  --chart-3: #FF7A1A;
  --chart-4: #3BD45C;
  --chart-5: #7FD8FF;
  --status-completed: #3BD45C;
  --status-completed-foreground: #000000;
  --status-running: #FFC800;
  --status-running-foreground: #000000;
  --status-failed: #FF2D2D;
  --status-failed-foreground: #000000;
  --status-pending: #7FD8FF;
  --status-pending-foreground: #000000;
  --status-terminated: #A9AFB7;
  --status-terminated-foreground: #000000;
  --status-canceled: #D5D9DE;
  --status-canceled-foreground: #000000;
  --status-continued: #B48CFF;
  --status-continued-foreground: #000000;
  --status-suspended: #FF7A1A;
  --status-suspended-foreground: #000000;
  --kind-orchestration: #FFFFFF;
  --kind-orchestration-foreground: #000000;
  --kind-entity: #FF4FA3;
  --kind-entity-foreground: #000000;
  --node-orchestrator: #FFC800;
  --node-activity: #7FD8FF;
  --node-entity: #FF4FA3;
  --node-suborchestrator: #B48CFF;
  --node-http: #3BD45C;
  --node-timer: #FF7A1A;
  --node-queue: #C9CED4;
  --node-other: #FFFFFF;
  --node-foreground: #000000;
  --json-key: #000000;
  --json-string: #B8175F;
  --json-number: #0064D2;
  --json-boolean: #B25800;
  --json-null: #55585E;
  --json-punctuation: #55585E;
}
.dark[data-theme="hazard"] {
  --background: #23262C;
  --foreground: #F4F4F1;
  --card: #2E3239;
  --card-foreground: #F4F4F1;
  --popover: #2E3239;
  --popover-foreground: #F4F4F1;
  --primary: #FFC800;
  --primary-foreground: #000000;
  --secondary: #F4F4F1;
  --secondary-foreground: #000000;
  --accent: #7FD8FF;
  --accent-foreground: #000000;
  --muted: #3B4048;
  --muted-foreground: #B4BAC3;
  --destructive: #FF2D2D;
  --destructive-foreground: #000000;
  --border: #F4F4F1;
  --input: #23262C;
  --ring: #FFC800;
  --ink: #F4F4F1;
  --paper: #23262C;
  --shadow-ink: #FFC800;
  --on-poster: #000000;
  --sidebar: #2E3239;
  --sidebar-foreground: #F4F4F1;
  --sidebar-primary: #FFC800;
  --sidebar-primary-foreground: #000000;
  --sidebar-accent: #7FD8FF;
  --sidebar-accent-foreground: #000000;
  --sidebar-border: #F4F4F1;
  --sidebar-ring: #FFC800;
  --poster-1: #FFC800;
  --poster-2: #FF2D2D;
  --poster-3: #FF7A1A;
  --poster-4: #3BD45C;
  --poster-5: #7FD8FF;
  --poster-6: #FF4FA3;
  --chart-1: #FFC800;
  --chart-2: #FF2D2D;
  --chart-3: #FF7A1A;
  --chart-4: #3BD45C;
  --chart-5: #7FD8FF;
  --status-completed: #3BD45C;
  --status-completed-foreground: #000000;
  --status-running: #FFC800;
  --status-running-foreground: #000000;
  --status-failed: #FF2D2D;
  --status-failed-foreground: #000000;
  --status-pending: #7FD8FF;
  --status-pending-foreground: #000000;
  --status-terminated: #5F6774;
  --status-terminated-foreground: #F4F4F1;
  --status-canceled: #474D56;
  --status-canceled-foreground: #F4F4F1;
  --status-continued: #B48CFF;
  --status-continued-foreground: #000000;
  --status-suspended: #FF7A1A;
  --status-suspended-foreground: #000000;
  --kind-orchestration: #2E3239;
  --kind-orchestration-foreground: #F4F4F1;
  --kind-entity: #FF4FA3;
  --kind-entity-foreground: #000000;
  --node-orchestrator: #FFC800;
  --node-activity: #7FD8FF;
  --node-entity: #FF4FA3;
  --node-suborchestrator: #B48CFF;
  --node-http: #3BD45C;
  --node-timer: #FF7A1A;
  --node-queue: #A3AAB4;
  --node-other: #2E3239;
  --node-foreground: #000000;
  --json-key: #F4F4F1;
  --json-string: #FF7ABB;
  --json-number: #7FD8FF;
  --json-boolean: #FFC800;
  --json-null: #B4BAC3;
  --json-punctuation: #B4BAC3;
}

/* ---------- derived, mode and theme independent ---------- */
:root {
  --font-sans: "Archivo", "Archivo Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "JetBrains Mono Variable", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --shadow-brutal: var(--shadow-offset) var(--shadow-offset) 0 0 var(--shadow-ink);
  --shadow-brutal-lg: var(--shadow-offset-lg) var(--shadow-offset-lg) 0 0 var(--shadow-ink);
  --shadow-brutal-hover: calc(var(--shadow-offset) + 2px) calc(var(--shadow-offset) + 2px) 0 0 var(--shadow-ink);
  --shadow-brutal-sm: 2px 2px 0 0 var(--shadow-ink);
  --control-h: 36px;
  --control-h-lg: 40px;
  --row-h: 36px;
  --row-h-comfortable: 44px;
  --topbar-h: 56px;
  --tab-h: 40px;
  --spine-w: 6px;
  --stripe: repeating-linear-gradient(45deg, var(--primary) 0 12px, var(--ink) 12px 24px);
}


/* ---------- base ---------- */
@layer base {
  * { border-color: var(--border); }
  html { color-scheme: light; }
  html.dark { color-scheme: dark; }
  body { background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; }
  :focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0ms !important; animation-duration: 0ms !important; } }
}

/* ---------- neo-brutalist utilities ---------- */
@utility brutal {
  border: var(--border-width) solid var(--ink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-brutal);
}
@utility brutal-flat {
  border: var(--border-width) solid var(--ink);
  border-radius: var(--radius);
}
@utility brutal-lg {
  border: var(--border-width) solid var(--ink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-brutal-lg);
}
@utility brutal-press {
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
  &:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow-brutal-hover); }
  &:active { transform: translate(var(--shadow-offset), var(--shadow-offset)); box-shadow: none; }
}
@utility rule-b { border-bottom: var(--border-width) solid var(--ink); }
@utility rule-t { border-top: var(--border-width) solid var(--ink); }
@utility rule-r { border-right: var(--border-width) solid var(--ink); }
@utility stripes { background-image: var(--stripe); }
@utility display { font-weight: 800; font-variation-settings: "wdth" 112; letter-spacing: -0.01em; line-height: 1.1; }
@utility condensed { font-weight: 600; font-variation-settings: "wdth" 90; letter-spacing: 0; }
@utility data { font-family: var(--font-mono); font-size: 13px; line-height: 1.35; font-variant-numeric: tabular-nums; }

/* ---------- optional background patterns per theme ---------- */
@utility bg-pattern {
  &:where([data-pattern="halftone"] *, [data-theme="riso"] *) {
    background-image: radial-gradient(var(--muted) 1px, transparent 1.1px);
    background-size: 10px 10px;
  }
  &:where([data-theme="memphis"] *) {
    background-image: radial-gradient(var(--muted) 1.2px, transparent 1.3px);
    background-size: 18px 18px;
  }
  &:where([data-theme="blueprint"] *) {
    background-image: linear-gradient(var(--muted) 1px, transparent 1px), linear-gradient(90deg, var(--muted) 1px, transparent 1px);
    background-size: 16px 16px;
  }
}

/* ---------- svelte-jsoneditor bridge (apply class="jse-theme-dfm" to the editor host) ---------- */
.jse-theme-dfm {
  --jse-theme-color: var(--ink);
  --jse-theme-color-highlight: var(--muted-foreground);
  --jse-background-color: var(--card);
  --jse-text-color: var(--foreground);
  --jse-text-readonly: var(--muted-foreground);
  --jse-main-border: var(--border-width) solid var(--ink);
  --jse-menu-color: var(--paper);
  --jse-panel-background: var(--muted);
  --jse-panel-color: var(--foreground);
  --jse-panel-border: var(--border-width) solid var(--ink);
  --jse-modal-background: var(--card);
  --jse-context-menu-background: var(--popover);
  --jse-context-menu-color: var(--popover-foreground);
  --jse-key-color: var(--json-key);
  --jse-value-color: var(--foreground);
  --jse-value-color-number: var(--json-number);
  --jse-value-color-boolean: var(--json-boolean);
  --jse-value-color-null: var(--json-null);
  --jse-value-color-string: var(--json-string);
  --jse-value-color-url: var(--json-number);
  --jse-delimiter-color: var(--json-punctuation);
  --jse-edit-outline: var(--border-width) solid var(--ring);
  --jse-selection-background-color: var(--accent);
  --jse-hover-background-color: var(--muted);
  --jse-font-family-mono: var(--font-mono);
  --jse-font-size-mono: 13px;
  --jse-font-family: var(--font-sans);
  --jse-font-size: 14px;
  border-radius: var(--radius);
}

/* ---------- Svelte Flow (@xyflow/svelte) bridge ---------- */
.svelte-flow {
  --xy-background-color: var(--background);
  --xy-background-pattern-color: var(--muted-foreground);
  --xy-edge-stroke: var(--ink);
  --xy-edge-stroke-width: 2;
  --xy-edge-stroke-selected: var(--ring);
  --xy-edge-label-background-color: var(--card);
  --xy-edge-label-color: var(--foreground);
  --xy-node-border-radius: var(--radius);
  --xy-node-boxshadow-selected: 0 0 0 3px var(--ring);
  --xy-handle-background-color: var(--ink);
  --xy-handle-border-color: var(--paper);
  --xy-minimap-background-color: var(--card);
  --xy-controls-button-background-color: var(--card);
  --xy-controls-button-color: var(--foreground);
  --xy-controls-button-border-color: var(--ink);
  --xy-attribution-background-color: transparent;
}

```
