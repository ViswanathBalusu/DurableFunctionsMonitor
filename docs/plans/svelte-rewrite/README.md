# Svelte rewrite: plan index

**Executed.** `durablefunctionsmonitor.svelte` is the UI of this repo; `durablefunctionsmonitor.react`
was deleted in E12-S2-T1 (2026-09-05) and lives on only in the history. This plan is kept as the
record of what was built and why: every task carries the deviations the backend or the host forced,
which is the part no commit message holds. `STATUS.md` is the board it was executed from.

**Open work (2026-09-06).** E13, E14 and E15 add two theme families, Glass and Neu, on top of the
finished rewrite. They are the only unticked epics on the board; `notes/theme-families-investigation.md`
is the investigation they came out of.

This folder is the execution plan for replacing `durablefunctionsmonitor.react` with `durablefunctionsmonitor.svelte`, built to match the clickable mockups in `docs/ui-plans-artifacts/` exactly, plus the backend endpoints those mockups read.

It is written for agents that execute one task at a time. Every task names its files, what to do, how to verify it, and which mockup lines it reproduces. Read `00-shared-contracts.md` before any task; it holds every cross-cutting rule so tasks do not repeat them.

## Source of truth, in priority order

1. `docs/ui-plans-artifacts/Screen*.dc.html` and `DFM App.dc.html`: the markup, copy, and behaviour of every screen. Line numbers in tasks refer to these files.
2. `docs/ui-plans-artifacts/dfm-ui.css` and `dfm-tokens.css`: the component classes and tokens. They are copied into the app verbatim (see decision D2).
3. `docs/ui-plans-artifacts/uploads/files/dfm-design-system.md`, `dfm-rewrite-plan.md`, `dfm-migration-plan.md`: rules and rationale.
4. `docs/ui-plans-artifacts/handoff.md`: screen to endpoint map, keyboard map, responsive rules.
5. The React app in `durablefunctionsmonitor.react/src`: reference for behaviour that the mockups do not spell out (filter clause syntax, paging, MSAL login, VS Code bridge). It was frozen while the rewrite ran and deleted at the end of it (E12-S2-T1) - `git show 64a541c:durablefunctionsmonitor.react/src/...` still reaches it.

When a mockup and a design document disagree, the mockup wins for visuals and copy, the design document wins for rules stated as "never" or "always".

## Decisions already made (do not reopen)

| Id | Decision | Why |
|---|---|---|
| D1 | Svelte 5 (runes) + Vite, plain SPA. No SvelteKit. `src/routes/` is an ordinary folder of screen components. | The backend serves `index.html` for every path and both hosts inject globals into it; a hand-rolled router is required (see contracts §4). |
| D2 | `dfm-ui.css` is copied into the app as `src/styles/dfm-ui.css` and its class names (`.btn`, `.chip`, `.tbl`, `.snav`, ...) are used directly by components. Tailwind v4 utilities are used for layout only. shadcn-svelte / bits-ui provide behaviour (focus traps, keyboard menus, combobox, command) and receive the DFM classes. | Pixel parity with the mockups, which are built on that stylesheet. |
| D3 | JSON editor: `svelte-jsoneditor`. Tree mode for read-only viewing, text mode (CodeMirror 6) for editing. Monaco is rejected. | The user asked for the VS Code editor or its best Svelte alternative. Monaco needs web workers and its own theme format, breaks the single-bundle contract and the CSP, and adds 5 MB. svelte-jsoneditor is native Svelte 5, themed through `--jse-*` variables (bridge already in `dfm-tokens.css`), and ships JSON lint and repair. |
| D4 | Every JSON value shown anywhere is pretty-printed (2 spaces) and fully expanded. The only exception is a one-line truncated preview inside a table cell, which opens the full viewer on click. | Explicit user requirement. See contracts §9. |
| D5 | Graph layout: `@dagrejs/dagre`, left to right. ELK is not used. | Synchronous, small, no worker; fits `inlineDynamicImports: true`. |
| D6 | Charts: D3 (`d3-scale`, `d3-shape`, `d3-axis`, `d3-brush`, `d3-selection`, `d3-time`) rendering into SVG owned by Svelte. Function graph: `@xyflow/svelte`. | As specified by the design system. |
| D7 | Data table: shadcn-svelte `data-table` pattern over `@tanstack/table-core`, virtualised with `@tanstack/svelte-virtual`. | Column chooser, sorting and sticky header come for free; matches the design document. |
| D8 | Canonical instance route is `/{hub}/instances/{instanceId}`. `/{hub}/durable-instances/{id}` (React) and `/{hub}/orchestrations/{id}` (design docs) are accepted and rewritten to the canonical form. | Keeps old bookmarks and the VS Code deep link working. |
| D9 | Capability driven UI. Nav items, actions and panels appear according to `/about.capabilities`, never according to a provider name. Where a capability is missing, the UI degrades (fallback or hidden) as each task specifies. | Lets UI epics ship before or without their backend epic, and keeps MSSQL and Netherite honest. |
| D10 | Backend aggregation endpoints are cached in memory for 30 s per hub and query, with in-flight de-duplication, and scans are capped at 50,000 rows with `partial: true` in the response. | Table Storage has no server-side counts. |
| D11 | Mockup-only affordances are removed: Settings › Mockup states, the Inputs tab "Mock outcome" select, and the feature-flag switches (they become read-only chips). The Login "connection string" form is omitted because the backend has no endpoint for it. | Not part of the product. |
| D12 | A theme has a `family` (`brutal`, `glass`, `neu`). The five papers are `brutal`; Glassmorphism and Neumorphism are one theme each (`glass`, `neu`), with a light and a dark face like every other theme. There is no second preference. | Seven themes × two modes to QA instead of five papers × three families × two modes; `dfm.theme`, `dfmTheme`, the menu, the tiles and the palette stay exactly as they are. |
| D13 | A family is one plain-CSS sheet, `src/styles/families/<key>.css`, every rule scoped under its own `[data-theme]`, declaring every token Poster declares in both modes. It may override `dfm-ui.css` rules for its theme; nothing else may, and the two frozen stylesheets stay verbatim. Shared plumbing (the `--glyph` token) lives in `families/base.css`. | The frozen stylesheets are the contract with the mockups; a soft look needs a few overrides (hover motion, table backgrounds, the overlay) that `dfm-ext.css` is forbidden to make. |
| D14 | The design system's §3 rules split in two. Universal, every family: status is a solid fill with dark text and keeps its hue; colour is a vocabulary; one loud element per screen; sentence case; verb + object on destructive buttons; icons never alone; the focus ring is a colour, never the line; motion only in answer to an action. Brutalist only: ink outline, hard offset shadow, no alpha, no gradients, no blur, paper patterns. `--glyph` is the colour of a small solid mark; it is `--ink` in the papers and a strong colour in the soft families. | Glass needs translucency and blur, Neu needs soft dual shadows and no line; the rules that carry meaning survive, the ones that describe the brutalist look do not. |

## Package versions (resolved 2026-09-04, pin these)

| Package | Version | Notes |
|---|---|---|
| svelte | 5.57.0 | runes only |
| vite | 8.2.2 | |
| @sveltejs/vite-plugin-svelte | 7.3.0 | |
| tailwindcss, @tailwindcss/vite | 4.3.3 | |
| bits-ui | 2.19.0 | peer `@internationalized/date ^3.8.1` |
| shadcn-svelte (CLI, dev) | 1.6.1 | Tailwind v4 mode |
| mode-watcher | 1.1.0 | |
| @lucide/svelte | 1.41.0 | not `lucide-svelte` (that package is stale) |
| svelte-sonner | 1.2.1 | |
| @tanstack/table-core | 9.2.4 | via shadcn data-table |
| @tanstack/svelte-virtual | 3.13.36 | |
| svelte-jsoneditor | 3.13.0 | |
| d3 | 7.9.0 | + `@types/d3` 7.4.3 |
| @xyflow/svelte | 1.6.6 | |
| @dagrejs/dagre | 3.1.1 | |
| @internationalized/date | 3.12.4 | |
| @azure/msal-browser | 5.21.0 | |
| @fontsource-variable/archivo, @fontsource-variable/jetbrains-mono | 5.3.0 | used in E12 only |
| typescript | 5.9.3 | do not use TypeScript 7 yet; `svelte-check` 4.x targets 5.x |
| svelte-check | 4.7.6 | |
| vitest | 5.0.0 | with `jsdom` 30.0.1 |
| @testing-library/svelte | 5.4.2 | |
| @playwright/test | 1.63.0 | |
| @azure/data-tables, @azure/storage-blob, @azure/storage-queue (dev, e2e seed) | 13.3.2, 12.33.0, 12.31.0 | |
| Azure.Storage.Queues (NuGet) | 12.27.1 | backend B4 |

Toolchain on the reference machine: Node 22.23.2 (pinned in the repo-root `.node-version`; install with `fnm install` and let `fnm env --use-on-cd` select it), npm 11.6, .NET SDK 10.0.400, Azure Functions Core Tools 4 (`func` 4.126.0 from `%LOCALAPPDATA%/AzureFunctionsTools/Releases/4.126.0/cli_x64`).

Dev tooling not listed above (eslint, eslint-plugin-svelte, typescript-eslint, prettier, prettier-plugin-svelte, @testing-library/jest-dom, ncp, rimraf, html-to-image if ever needed): take the latest stable at install time and pin it exactly (`--save-exact`); record the chosen versions in the E0-S1-T1 commit message.

## Id scheme

`E<n>-S<m>-T<k>`: epic, story, task. Backend epics are `B<n>`. A task is one unit of work for one agent: it creates or changes a handful of files and ends with its acceptance list green. Stories group tasks that ship together. Every task lists `Depends:`; do not start a task whose dependencies are unchecked in `STATUS.md`.

## Delivery order and dependencies

```
E0 scaffold ──► E1 design system ──► E2 shell/login ──► E3 test harness
                                                            │
                     ┌──────────────────────────────────────┤
                     ▼                                      ▼
                 E4 instances ──► E5 workspace ──► E6 settings
                     │                │
B0 about/caps ───────┴────────────────┘
B1 stats/children ──► E7 overview + functions
B2 spans ───────────► E8 timeline + summary
B3 failures/batch ──► E9 failures + bulk wiring
B4 storage/entities ► E10 entities + storage
B5 audit ───────────► E11 activity
E12 ci/docker/cleanup/polish (last)

E13 theme families ──► E14 glass
                   └─► E15 neu        (E14 and E15 are independent of each other)
```

Backend epics B0 to B5 have no UI dependency and can run in parallel with E1 to E6. The UI epics that need them (E7 to E11) gate their panels on capabilities, so they can be built against a backend that has the endpoint and skipped gracefully against one that does not.

Steps E0 to E6 replace the React app one for one. Everything after is new value.

## Definition of done (every task)

1. The acceptance checklist of the task is fully checked.
2. `npm run check` (svelte-check, no errors), `npm run lint`, and `npm test` pass in `durablefunctionsmonitor.svelte/`. For backend tasks: `dotnet build DurableFunctionsMonitor.slnx` and `dotnet test` of both test projects pass (integration tests report Inconclusive without Azurite; run Azurite locally when the task touches storage).
3. New behaviour has a test at the level the task names (unit, component, e2e). No task is done without its named test.
4. The task's checkbox in `STATUS.md` is ticked, with the commit hash.
5. One commit per task, message `E4-S2-T1: <what changed>` (or `B1-...`). No unrelated changes in the commit.

## Epic files

| File | Scope |
|---|---|
| `00-shared-contracts.md` | Build output contract, host globals, routing, API and error contracts, state modules, storage keys, status vocabulary, JSON rule, class map, test commands |
| `E0-scaffold-and-host-contract.md` | Project, build pipeline, esproj and slnx, host globals, both backend clients, router, theme runtime, smoke test in both hosts |
| `E1-design-system-and-shared-components.md` | Tokens and stylesheet, restyled shadcn primitives, every shared component (buttons, chips, tiles, dialogs, table, JSON viewer, charts base) |
| `E2-shell-navigation-login.md` | Side nav, top bar, bottom nav, More sheet, peek panel, command palette, keyboard map, toasts, progress, login and hub picker |
| `E3-test-harness.md` | Vitest, component tests, Playwright with Azurite and the isolated host, hub seeding, CI job |
| `E4-instances.md` | Instances screen: chips, rail, saved views, table, timeline, histogram, selection and bulk bar (client fan-out), Start new instance, Long JSON |
| `E5-instance-workspace.md` | Workspace header and actions, History, Raw, Inputs tab with recovery dialogs, Sequence, Graph, custom tabs; Summary and Timeline placeholders until E8 |
| `E6-settings.md` | Connection, hub administration dialogs, appearance, thresholds, feature flags, templates |
| `E7-overview-and-functions.md` | Overview (tiles, throughput, needs attention, top orchestrators, backlog, recent activity) and Functions (table + graph, DfmViewMode=1) |
| `E8-workspace-timeline-and-summary.md` | Timeline tab swimlane, where-the-time-went, children tree, execution panel, peek mini timeline |
| `E9-failures-and-bulk.md` | Failures screen, group actions, bulk bar over `/orchestrations/batch` |
| `E10-entities-and-storage.md` | Entities screen with state peek, Storage screen |
| `E11-activity.md` | Activity screen and the Overview recent-activity panel |
| `E12-ci-docker-cleanup-polish.md` | CI on the Svelte build, Docker stages, VS Code packaging, React removal, self-hosted fonts, accessibility and reduced motion pass, theme QA |
| `E13-theme-families.md` | `family` on the theme model, the `--glyph` token, family-aware tests, the style preview harness, contracts §16 and the review checklist split |
| `E14-glass-theme.md` | The Glass theme (`glass`): frosted translucent surfaces over a colour backdrop, light and dark, QA and a11y in the app, docs |
| `E15-neu-theme.md` | The Neu theme (`neu`): one soft material with dual shadows and sunk inputs, light and dark, QA and a11y in the app, docs |
| `B0-about-capabilities-conditional-get.md` | `/about` provider and capabilities, capability flags for admin operations, `ETag`/`If-None-Match` on details and history, `static/media` in `ServeStatics` |
| `B1-stats-and-children.md` | `GET /stats`, `GET orchestrations('{id}')/children`, aggregation cache, scan cap |
| `B2-spans.md` | `GET orchestrations('{id}')/spans`, episode markers, timer pairing |
| `B3-failures-and-batch.md` | `GET /failures`, failure signatures, `POST /orchestrations/batch` |
| `B4-storage-and-entities.md` | `GET /storage` (queues, partitions, task hub), `GET /entities` |
| `B5-audit.md` | Audit writer middleware, `{hub}DfmAudit` table, `GET /audit` |
| `STATUS.md` | The board. Tick tasks here. |

## How an agent works a task

1. Open `STATUS.md`, pick the first unchecked task whose dependencies are checked (or the one you were assigned).
2. Read `00-shared-contracts.md` sections the task references, then the task, then the mockup lines it cites.
3. Implement. Use the skills in `.claude/skills/` (`dfm-svelte-ui`, `dfm-backend-endpoint`, `dfm-d3-charts`, `dfm-e2e-harness`) for patterns and templates.
4. Run the checks in the definition of done. Fix until green.
5. Tick the task in `STATUS.md` with the commit hash. Commit.

Do not widen a task. If a task turns out to be wrong or impossible, write why under the task in the epic file, mark it `BLOCKED` in `STATUS.md`, and move to the next one.
