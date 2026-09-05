# Durable Functions Monitor: Svelte migration plan

Companion to `dfm-design-system.md` (visual language) and `dfm-rewrite-plan.md` (screens and backend additions). This is the engineering side: how the new app is built, hosted, wired to the backend in `ViswanathBalusu/DurableFunctionsMonitor`, and delivered in phases. Everything here was checked against the fork's `main` (commit `6bb5ec9`).

## 1. Outcome

`durablefunctionsmonitor.svelte/` replaces `durablefunctionsmonitor.react/` inside `DurableFunctionsMonitor.slnx`, produces the same `DfmStatics` folder the isolated backend and the VS Code extension already serve, reaches functional parity with the React app under the new information architecture (side nav, Overview, Instances, Instance workspace, Failures, Entities, Functions, Storage, Activity, Settings), and adds the Inputs tab for the new input-event operations. Parity needs no backend change; the new screens need the endpoints in the rewrite plan section 5, listed here in section 4 as "new".

## 2. Build output contract

The backend (`ServeStatics.cs`) and the extension (`MonitorView.fixLinksToStatics`) fix what the build may emit.

| Constraint | Source | What the build does |
|---|---|---|
| Only `static/css/*`, `static/js/*`, `manifest.json`, `favicon.png`, `logo.svg` are served; anything else returns `index.html` | `FileMap` in `ServeStatics.cs` | JS to `static/js/`, CSS to `static/css/`, the three files from `public/` |
| Paths are at most three segments (`{p1?}/{p2?}/{p3?}`) | `ServeStatics` route | `static/js/main.<hash>.js`, never deeper |
| Asset links are rewritten from `href="/` and `src="/` to `/{routePrefix}/` | `ReturnIndexHtml` | `base: '/'`, root-absolute asset URLs, no relative `./` |
| VS Code rewrites links matching `/ (href|src)="\/([0-9a-z.\/]+)"/i` | `fixLinksToStatics` | File names use only letters, digits and dots: hex hashes, no `-` or `_` |
| One bundle (CRA build was patched with `LimitChunkCountPlugin({ maxChunks: 1 })`) | `disable-webpack-chunking.js` | `inlineDynamicImports: true`, `cssCodeSplit: false` |
| Placeholders replaced by exact string match | `ReturnIndexHtml`, `MonitorView.ts`, `FunctionGraphView.ts` | `index.html` keeps the seven tags below byte for byte |
| Default CSP: `default-src 'self'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src 'self' https://fonts.gstatic.com`, `connect-src 'self' https://login.microsoftonline.com`, `img-src data: 'self'` | `DefaultContentSecurityPolicyMeta` | No inline scripts beyond the placeholders, no eval, fonts either from Google or self-hosted (section 10) |

`index.html` (project root, consumed by Vite) must contain, unchanged:

```html
<meta name="durable-functions-monitor-meta">
<script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script>
<script>var DfmRoutePrefix=""</script>
<script>var DfmApiRoutePrefix=""</script>
<script>var DfmClientConfig={}</script>
<script>var DfmViewMode=0</script>
<script>var IsFunctionGraphAvailable=0</script>
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  base: '/',
  build: {
    outDir: 'build',
    sourcemap: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        hashCharacters: 'hex',
        entryFileNames: 'static/js/main.[hash].js',
        chunkFileNames: 'static/js/[name].[hash].js',
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? '';
          if (name.endsWith('.css')) return 'static/css/main.[hash][extname]';
          return 'static/media/[name].[hash][extname]';
        },
      },
    },
  },
  server: { port: 3000, proxy: { '/durable-functions-monitor': 'http://localhost:7072' } },
});
```

`copy-build-artifacts.js` stays, minus `service-worker.js`, copying `build/` to `../durablefunctionsmonitor.dotnetisolated/DfmStatics`. `durablefunctionsmonitor.svelte.esproj` mirrors the React one (`BuildCommand` = `npm run build`, `JavaScriptTestFramework` = Playwright, `ShouldRunNpmAudit` = false) and replaces the React entry in `DurableFunctionsMonitor.slnx`.

Smoke test for phase 0, before any feature work: build, copy, run `durablefunctionsmonitor.dotnetisolated` locally, open `/durable-functions-monitor/DurableFunctionsHub` and `/durable-functions-monitor/DurableFunctionsHub/orchestrations/some-id`, then open the same statics through the extension's `Custom Path to Backend Binaries` setting. Both hosts must render the shell and reach `/about`.

## 3. Runtime host contract

`src/lib/host.svelte.ts` is the only file that reads the injected globals.

| Global | Set by | Meaning |
|---|---|---|
| `DfmRoutePrefix` | backend | Prefix for statics and client routes (`""` at root) |
| `DfmApiRoutePrefix` | backend | Prefix for API calls, ends with `/a/p/i`; the client appends `/{connName}-{hubName}/...` |
| `DfmClientConfig` | backend from `DFM_CLIENT_CONFIG`, or extension | `{ theme: 'light' or 'dark', showTimeAs: 'Local' or 'UTC' }`; any extra key passes through, so `dfmTheme: 'blueprint'` can pin a theme per deployment without a backend change |
| `IsFunctionGraphAvailable` | backend when a function map exists for the hub | Shows the Functions Graph tabs |
| `DfmViewMode` | extension | `0` monitor, `1` function graph only |
| `OrchestrationIdFromVsCode`, `StateFromVsCode` | extension | Open straight on an instance; restore persisted UI state |
| `acquireVsCodeApi` | VS Code | Present only inside the webview; selects the bridge client |

Client routing is hand rolled: `location.pathname` minus `DfmRoutePrefix`, then `/{connName-hubName}` (Overview), `/{connName-hubName}/instances`, `/{connName-hubName}/orchestrations/{instanceId}` (kept for existing links and for `OrchestrationIdFromVsCode`), `/{connName-hubName}/failures`, `/entities`, `/functions`, `/storage`, `/activity`, `/settings`. The global time range, filters and the open tab live in the query string so views are shareable. The backend serves `index.html` for any path, so no SvelteKit and no history API adapter are needed. Links are built through one `href()` helper that prepends the prefix.

## 4. Backend client

One interface, two implementations, same as the React app.

`HttpBackendClient`: `fetch` against `DfmApiRoutePrefix`, bearer token from `@azure/msal-browser` when `easyauth-config` returns a client id (the redirect flow, `task-hub-names` to pick the hub), `x-dfm-nonce` header when the nonce is present in the page, JSON error bodies mapped to typed errors.

`VsCodeBackendClient`: `postMessage({ id, method, url, data })` for GET, POST, PUT and DELETE, answered by `window` message events keyed by `id`; plus `Download` (url, file name), `OpenInNewWindow`, `SaveAs` (SVG), `GotoFunctionCode`, `GotoBinding`, `IAmReady` on start, and `PersistState` (key, data) for `VsCodeTypedLocalStorage`. The extension handles `/function-map` locally, so the client calls it like any other GET.

Endpoints (all relative to `/{connName}-{hubName}`):

| Call | Method | Notes |
|---|---|---|
| `/about` | GET | `{ accountName, hubName, version, permissions[] }` today; the rewrite adds `provider` and `capabilities`. `permissions` drives `readOnlyMode` (no `DurableFunctionsMonitor.ReadWrite`) and `dangerousOperationsEnabled` (`DurableFunctionsMonitor.DangerousOperations`); `capabilities` shows or hides nav items |
| `/orchestrations?$filter=...&$orderby=...&$top=&$skip=` | GET | List; filter clause built from the rail exactly as `OrchestrationsState` does today |
| `/orchestrations` | POST | Start new instance |
| `/orchestrations('{id}')` | GET | Details (fields, tab template names) |
| `/orchestrations('{id}')/history?$top=&$skip=` | GET | History events, now with `SequenceNumber` |
| `/orchestrations('{id}')/suspend`, `resume`, `rewind`, `terminate`, `raise-event`, `set-custom-status`, `restart`, `purge` | POST | Existing actions |
| `/orchestrations('{id}')/input`, `output`, `custom-status` | GET | Blob-backed field download |
| `/orchestrations('{id}')/custom-tab-markup('{template}')` | GET | Liquid tabs |
| `/orchestrations('{id}')/input-events` | GET | New, section 5 |
| `/orchestrations('{id}')/update-input-and-rewind` | POST | New, Write |
| `/orchestrations('{id}')/replay` | POST | New, Dangerous |
| `/orchestrations('{id}')/restart-in-place` | POST | New, Dangerous |
| `/stats?from&to&bins` | GET | New (rewrite plan 5): totals, bins, byName, stuck, oldestPending, entities count, plus scanned and partial |
| `/failures?from&to` | GET | New: failure groups by name and error signature |
| `/orchestrations('{id}')/spans` | GET | New: timeline spans and where-the-time-went totals |
| `/orchestrations('{id}')/children` | GET | New: sub-orchestrations by id range |
| `/orchestrations/batch` | POST | New: bounded batch of an action over instance ids |
| `/storage` | GET | New, Azure Storage only: queues, partitions, task hub info |
| `/audit?from&to&operation` | GET | New: audit rows written by the middleware |
| `/id-suggestions(prefix='{prefix}')` | GET | Combobox |
| `/function-map` | GET | Functions Graph |
| `/purge-history`, `/clean-entity-storage`, `/delete-task-hub`, `/manage-connection` | POST or GET | Main menu dialogs |
| `../easyauth-config`, `../task-hub-names` | GET | Under `/a/p/i` without the hub segment |

Error mapping, shared by all calls: 400 `BadRequestError`, 403 `ForbiddenError`, 404 `NotFoundError`, 409 `ConflictError`, 413 `PayloadTooLargeError`, 500 `ServerError` with the parsed body kept on the error, because the three input-event endpoints return recovery data in a 500 body.

## 5. Input events contract, typed

```ts
export type InputEventOperation = 'restart-in-place' | 'update-input-and-rewind' | 'replay';

export interface OperationEligibility {
  allowed: boolean;
  reason?: string;            // render verbatim when allowed is false
  requiresTerminate?: boolean; // replay only
}

export interface InputEvent {
  sequenceNumber: number | null;
  eventType: 'ExecutionStarted' | 'EventRaised';
  name: string;
  timestamp: string;
  input: unknown;             // parsed JSON, or the raw string when not JSON
  isLast: boolean;
  operations: Partial<Record<InputEventOperation, OperationEligibility>>;
}

export interface InputEventsResponse {
  instanceId: string;
  runtimeStatus: string;
  parentInstanceId: string | null;
  dangerousOperationsEnabled: boolean;
  storageSupports: { updateInput: boolean; truncateHistory: boolean };
  warning?: string;           // sub-orchestration note, render once
  events: InputEvent[];
}

// requests
export interface RestartInPlaceRequest { input?: unknown }
export interface UpdateInputAndRewindRequest { sequenceNumber: number; input: unknown; reason?: string }
export interface ReplayRequest { sequenceNumber: number; input?: unknown; terminateIfRunning?: boolean }

// 200 responses
export interface RestartInPlaceResult { instanceId: string; purged: true; input: unknown }
export interface UpdateInputAndRewindResult { sequenceNumber: number; inputUpdated: true; rewound: true }
export interface ReplayResult { sequenceNumber: number; eventName: string; deletedRows: number; raised: true }

// 500 recovery bodies (shape of the objects the functions return on the partial failure paths)
export interface RestartInPlaceRecovery { instanceId: string; purged: true; name: string; input: unknown; message: string }
export interface ReplayRecovery { sequenceNumber: number; eventName: string; input: unknown; deletedRows: number; message: string }
export interface UpdateInputRecovery { sequenceNumber: number; inputUpdated: true; rewound: false; message: string }
```

Client rules, from `docs/plans/input-events-restart-rewind-replay.md` section 11:

- Send `sequenceNumber` back exactly as received; it is the concurrency token.
- Only the two dangerous buttons depend on the `/about` permission; eligibility for everything else comes from the response.
- After any of the three operations succeeds, reload details, history and inputs together.
- The size meter uses UTF-16 byte count (`new TextEncoder` is UTF-8, so count `str.length * 2` after JSON serialisation with the editor's formatting), limit 61,440 bytes.

## 6. State modules

MobX classes become Svelte 5 rune modules with the same names and responsibilities, so the port is mechanical and reviewable side by side.

| React (`states/`) | Svelte (`src/lib/state/`) |
|---|---|
| `MainState` | `main.svelte.ts`: host detection, routing, login, which view is open |
| `LoginState` | `login.svelte.ts`: easyauth-config, msal, task hub names |
| `MainMenuState` + dialog states | `menu.svelte.ts` and one module per dialog |
| `OrchestrationsState`, `ResultsListTabState`, `ResultsHistogramTabState`, `ResultsGanttDiagramTabState`, `ResultsFunctionGraphTabState` | `orchestrations.svelte.ts` plus one tab module each |
| `OrchestrationDetailsState`, `SequenceDiagramTabState`, `GanttDiagramTabState`, `FunctionGraphTabState`, `LiquidMarkupTabState` | `details.svelte.ts` plus tab modules; new `inputs.svelte.ts` for the Inputs tab |
| `FunctionGraphState`, `FunctionGraphStateBase` | `function-graph.svelte.ts` (shared by both views and by `DfmViewMode=1`) |
| `TypedLocalStorage`, `VsCodeTypedLocalStorage`, `ITypedLocalStorage` | same three, unchanged contract |
| `DfmContext` | `context.svelte.ts`: read-only mode, dangerous mode, show time as, theme and mode |
| `ErrorMessageState` | `toast.svelte.ts` over svelte-sonner |
| (new) | `shell.svelte.ts`: nav state, collapsed rail, time range, command palette; `overview.svelte.ts`, `failures.svelte.ts`, `entities.svelte.ts`, `storage.svelte.ts`, `audit.svelte.ts`, `selection.svelte.ts` (bulk selection and the action bar), `peek.svelte.ts` |

Auto-refresh timers, the filter clause builder (`FilterOperatorEnum`, time range enum) and the history paging logic port as pure functions with unit tests.

## 7. Theme and mode at runtime

- `<html data-theme="..." class="dark">`, driven by mode-watcher. Persist `dfm.theme` and `dfm.mode` through `ITypedLocalStorage`, so the extension keeps them across sessions via `PersistState`.
- Precedence for mode: user choice, then `DfmClientConfig.theme`, then `prefers-color-scheme`. Inside the webview `DfmClientConfig.theme` follows the editor theme, so the user choice is offered as "Follow VS Code" plus light and dark.
- Precedence for theme: user choice, then `DfmClientConfig.dfmTheme`, then `poster`.
- Fonts: self-host Archivo and JetBrains Mono (`@fontsource-variable/archivo`, `@fontsource-variable/jetbrains-mono`) once the `static/media` `FileMap` entry exists (section 10). Until then, keep the Google Fonts link, which the default CSP already allows, and let the stack fall back to system fonts offline.

## 8. Phases

The UI steps follow the delivery order in the rewrite plan section 6; the backend steps B0 to B5 are the endpoints in its section 5. Each step ends with the Playwright suite green in both hosts.

| Step | UI | Backend | Exit |
|---|---|---|---|
| 0 | Scaffold: Vite, Svelte 5, Tailwind v4, shadcn-svelte init, tokens, esproj, copy step, slnx entry, host contract, both backend clients, router, mode-watcher | none | Shell renders in the backend and in the extension, `/about` displayed |
| 1 | Shell and side nav, hub switcher, instance jump, command palette, login flow, Settings with the existing dialogs, Instances table with chips, saved views, peek panel | none | Old list replaced |
| 2 | Instance workspace: header and actions with confirms, History with `#` column, Raw, Long JSON on svelte-jsoneditor, Inputs tab with recovery dialogs, Sequence, Graph, custom tabs | B0 (`/about` capabilities, conditional GET) | Old details page replaced, new feature shipped |
| 3 | Overview tiles, throughput chart with brush, needs attention, top orchestrators; Functions table | B1 (`/stats`, `/children`) | First new screen |
| 4 | Timeline tab, Summary column with where-the-time-went, children tree | B2 (`/spans`) | Workspace complete |
| 5 | Failures screen, bulk selection and action bar across tables | B3 (`/failures`, `/batch`) | Group recovery |
| 6 | Entities page; Storage page behind the capability | B4 (`/storage`, optional `/entities`) | |
| 7 | Activity page | B5 (`/audit`) | |
| 8 | Remove the React project, CI and Docker on the Svelte build, remaining themes polish, keyboard and screen reader pass, reduced motion | none | React folder deleted |

Steps 1 and 2 are a shippable replacement; steps 3 to 7 go out one screen at a time behind `capabilities`, so a hub on MSSQL or Netherite simply never shows the screens its provider cannot serve.

## 9. Tests and CI

- Unit (Vitest): filter clause builder, time range math, route parsing with and without prefix, eligibility rendering (matrix from the backend's `InputEventEligibilityTests`), size meter, recovery dialog selection by response shape, chip serialisation to and from the URL, partial-results banner logic.
- Backend unit and Azurite tests for the new endpoints follow the pattern the fork already uses: pure aggregation functions over synthetic rows (`stats`, `failures` signatures, `spans` from history events) with MSTest, and Azurite runs for the scans, the children range query and the audit writer.
- Component (Vitest + Testing Library): status chip, input event card, confirm dialogs, editor read-only switching.
- End to end (Playwright, `tests/` next to the existing `playwright.config.ts`): run `durablefunctionsmonitor.dotnetisolated` against the Azurite service container the fork's `build.yml` already starts, seed a hub with the same synthetic History and Instances layout the integration tests use (`StorageEmulator.cs`), then cover list, details, each action, the Inputs tab happy paths and the 409 path (change a row between load and submit).
- CI: add a Node 22 job to `build.yml` and `pr-build.yml` that runs `npm ci`, `npm run build-and-copy`, unit tests and Playwright, before the `dotnet build` of `durablefunctionsmonitor.dotnetisolated`. The esproj already invokes npm during `dotnet build`, so a Node toolchain is required in every job that builds the solution.
- Docker: the fork removed committed build outputs, so the three `Dockerfile`s (`durablefunctionsmonitor.dotnetisolated`, `custom-backends/dotnetIsolated-mssql`, `dotnetIsolated-netherite`) get a `node:22` stage that builds the SPA and copies `build/` into `DfmStatics` before `dotnet publish`.
- VS Code extension: `push-to-vscode-marketplace.yml` packages `backend/DfmStatics` from the same build; no code change beyond the statics path already in `FunctionGraphView.ts`.

## 10. Backend changes in the fork

Required by the new screens: the endpoints in `dfm-rewrite-plan.md` section 5 (B0 to B5). Small ones that help parity:

1. `ServeStatics.FileMap`: add `static/media` with `font/woff2` so fonts can be self-hosted; keep the Google Fonts entries in the CSP as a fallback. One line.
2. `DfmClientConfig`: document `dfmTheme` in the README as a supported key of `DFM_CLIENT_CONFIG`. No code change; the object is passed through as JSON.
3. `GET input-events`: nothing needed for the UI. If `HistoryEvent.SequenceNumber` ever becomes non-nullable for MSSQL, the "provider without sequence numbers" state in the UI simply never renders.

## 11. Package list

`svelte@5`, `vite`, `@sveltejs/vite-plugin-svelte`, `tailwindcss@4`, `@tailwindcss/vite`, `bits-ui`, shadcn-svelte components (added through its CLI, Tailwind v4 mode), `mode-watcher`, `lucide-svelte`, `svelte-sonner`, `@tanstack/table-core` with the shadcn-svelte data table pattern, `@tanstack/svelte-virtual`, `svelte-jsoneditor`, `d3` (`d3-scale`, `d3-axis`, `d3-brush`, `d3-selection`, `d3-shape`, `d3-time`), `@xyflow/svelte`, `elkjs` or `@dagrejs/dagre`, `@internationalized/date`, `@azure/msal-browser`, `@fontsource-variable/archivo`, `@fontsource-variable/jetbrains-mono`. Dev: `vitest`, `@testing-library/svelte`, `@playwright/test`, `typescript`, `svelte-check`.
