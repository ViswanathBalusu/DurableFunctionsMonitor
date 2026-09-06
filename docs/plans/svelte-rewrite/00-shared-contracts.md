# Shared contracts

Everything more than one task depends on lives here. Tasks reference sections by number (`contracts §4`). Change this file only through a task that says so, and update every dependent task in the same commit.

## §1 Project layout

```
durablefunctionsmonitor.svelte/
  index.html                      # template with the 7 placeholder tags (§2)
  vite.config.ts                  # §2
  package.json                    # scripts: dev, build, build-and-copy, check, lint, test, test:e2e
  durablefunctionsmonitor.svelte.esproj
  copy-build-artifacts.js         # build/ -> ../durablefunctionsmonitor.dotnetisolated/DfmStatics
  public/favicon.png, logo.svg, manifest.json
  src/
    main.ts                       # mounts App.svelte
    App.svelte                    # host detection, router outlet, shell
    app.css                       # @import "tailwindcss"; tokens; @import "./styles/dfm-ui.css"
    styles/dfm-tokens.css         # verbatim copy of docs/ui-plans-artifacts/uploads/files/dfm-tokens.css
    styles/dfm-ui.css             # verbatim copy of docs/ui-plans-artifacts/dfm-ui.css minus its reset lines (E1-S1-T2 says which)
    styles/dfm-ext.css            # the app's additions; never overrides a dfm-ui.css rule
    styles/families/base.css      # theme families (§16): what every family shares - the `--glyph` default - imported after dfm-ext.css
    styles/families/<key>.css     # one plain-CSS sheet per non-brutalist theme, every rule scoped to its own [data-theme] (§16)
    lib/
      host.svelte.ts              # the only file that reads the injected globals (§3)
      router.svelte.ts            # §4
      api/                        # backend clients and typed endpoints (§5, §6)
        client.ts                 # BackendClient interface + errors
        http-client.ts            # fetch + MSAL + xsrf + etag
        vscode-client.ts          # postMessage bridge
        endpoints.ts              # one typed function per endpoint
        types.ts                  # DTOs (§6)
      state/                      # rune modules, one class per module (§7)
      storage/                    # ITypedLocalStorage, TypedLocalStorage, VsCodeTypedLocalStorage, prefs (§8)
      format/                     # time.ts, duration.ts, json.ts, bytes.ts (§9, §10)
      filters/                    # odata.ts (filter clause builder), time-range.ts
      components/                 # shared UI (E1), one folder per component
        ui/                       # shadcn-svelte generated primitives (restyled)
      charts/                     # D3 charts (StackedColumns, Swimlane, Sparkline, SequenceDiagram)
      graph/                      # Svelte Flow function graph + dagre layout + svg export
      shell/                      # SideNav, TopBar, BottomNav, MoreSheet, PeekPanel, CommandPalette, ToastHost, ProgressBar
      instances/, instance/, failures/, entities/, functions/, storage/, activity/, settings/, overview/, login/
    routes/                       # screen components: Overview.svelte, Instances.svelte, Instance.svelte, Failures.svelte,
                                  # Entities.svelte, Functions.svelte, Storage.svelte, Activity.svelte, Settings.svelte, Login.svelte
  tests/
    unit/                         # vitest, *.test.ts next to code is also fine
    e2e/                          # playwright specs, seed/, fixtures/
  scripts/                        # local helpers (harness lives in repo-root scripts/harness)
```

Naming: components `PascalCase.svelte`; rune modules `kebab.svelte.ts`; pure modules `kebab.ts`; tests `*.test.ts` (vitest) and `*.spec.ts` (playwright).

## §2 Build output contract (must never break)

The backend `durablefunctionsmonitor.dotnetisolated.core/Functions/ServeStatics.cs` and the extension `durablefunctionsmonitor-vscodeext/src/MonitorView.ts` fix what the build may emit.

| Rule | Reason |
|---|---|
| JS goes to `static/js/main.<hexhash>.js`, one file. CSS goes to `static/css/main.<hexhash>.css`, one file. Other assets to `static/media/<name>.<hexhash>.<ext>`. | `ServeStatics.FileMap` serves only `static/css`, `static/js`, `manifest.json`, `favicon.png`, `logo.svg` (B0 adds `static/media`). Anything else returns `index.html`. |
| Paths are at most three segments deep. | Route is `{p1?}/{p2?}/{p3?}`. |
| Asset URLs in `index.html` are root-absolute (`href="/static/..."`, `src="/static/..."`) and contain only `[0-9a-z./]`. | Backend rewrites `href="/` and `src="/` to `/{routePrefix}/`. VS Code rewrites with the regex `/ (href|src)="\/([0-9a-z.\/]+)"/ig`. Hex hashes are lowercase; never use `-` or `_` in emitted file names. |
| No code splitting: `inlineDynamicImports: true`, `cssCodeSplit: false`, `modulePreload: { polyfill: false }`. | The hosts do not serve chunks reliably and the VS Code regex would miss them. |
| `index.html` keeps these seven tags byte for byte: | The hosts replace them by exact string match. |

```html
<meta name="durable-functions-monitor-meta">
<script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script>
<script>var DfmRoutePrefix=""</script>
<script>var DfmApiRoutePrefix=""</script>
<script>var DfmClientConfig={}</script>
<script>var DfmViewMode=0</script>
<script>var IsFunctionGraphAvailable=0</script>
```

| Rule | Reason |
|---|---|
| No inline `<script>` beyond the placeholders, no `eval`, no external scripts. Styles may be inline. Fonts from Google Fonts (allowed by the default CSP) until E12 self-hosts them. | Default CSP in `ServeStatics.DefaultContentSecurityPolicyMeta`: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://login.microsoftonline.com; img-src data: 'self'`. |
| Font files, once self-hosted, are referenced from CSS with relative URLs. | The VS Code rewrite only touches `index.html`; CSS `url()` resolves relative to the CSS file's webview URI. Set `experimental.renderBuiltUrl` to `{ relative: true }` for `hostType === 'css'`. |

`vite.config.ts` reference (E0-S1-T2 creates it):

```ts
import { defineConfig } from 'vitest/config'; // not 'vite': the `test` key only type-checks through vitest/config
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
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      return hostType === 'css' ? { relative: true } : undefined;
    },
  },
  server: { port: 3000, proxy: { '/durable-functions-monitor': 'http://localhost:7072', '/a/p/i': 'http://localhost:7072' } },
  resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    passWithNoTests: true, // until the first test file exists
    setupFiles: ['tests/unit/setup.ts'], // E3-S1-T1 creates the file and adds this line
    // E3-S1-T1 also adds svelteTesting() from '@testing-library/svelte/vite' to `plugins` (or resolve.conditions ['browser'] under VITEST):
    // without it Vite resolves the svelte package to its server build and @testing-library/svelte render() cannot mount any component.
  },
});
```

`scripts/harness/verify-build-contract.mjs` (repo root) checks a `build/` folder against these rules. Run it after every build.

Amendments recorded from E0-S1-T1/T2 (2026-09-05): `defineConfig` comes from `vitest/config`; `passWithNoTests` stays until the first test file exists; `setupFiles` and `svelteTesting()` are added by E3-S1-T1; the `$lib` alias is required (add `import { fileURLToPath } from 'node:url'`). Vite 8.2.2 prints "inlineDynamicImports option is deprecated, please use codeSplitting: false instead": keep `inlineDynamicImports: true` (it still works and is what the contract tests) until a task switches both together. Until E0-S1-T3 imports `./app.css` from `src/main.ts` no CSS bundle is emitted and the verify script reports "found 0 CSS"; that is expected only for E0-S1-T2.

## §3 Host globals and host detection

`src/lib/host.svelte.ts` is the only module allowed to read `window.*` globals. Everything else imports `host`.

```ts
export type HostKind = 'browser' | 'vscode';
export interface ClientConfig { theme?: 'light' | 'dark'; showTimeAs?: 'Local' | 'UTC'; dfmTheme?: ThemeName; [k: string]: unknown }
export const host = {
  kind: typeof (globalThis as any).acquireVsCodeApi === 'function' ? 'vscode' : 'browser',
  vsCodeApi: /* acquireVsCodeApi() once, or null */,
  routePrefix: string,          // DfmRoutePrefix, '' at root
  apiRoutePrefix: string,       // DfmApiRoutePrefix, ends with /a/p/i (no leading slash)
  clientConfig: ClientConfig,   // DfmClientConfig
  viewMode: 0 | 1,              // DfmViewMode: 0 monitor, 1 function graph only
  functionGraphAvailable: boolean, // IsFunctionGraphAvailable
  orchestrationIdFromVsCode: string,
  stateFromVsCode: Record<string, unknown>,
};
```

Behaviour that depends on the host:

| Concern | browser | vscode |
|---|---|---|
| Backend client | `HttpBackendClient` | `VsCodeBackendClient` |
| Login screen | shown when no hub in URL or MSAL needs sign-in | never |
| Router | history mode (`location.pathname` + `pushState`) | memory mode; the current route is state, persisted through `PersistState` under key `route` |
| Mode (light/dark) default | `clientConfig.theme` else `prefers-color-scheme` | `clientConfig.theme` (follows the editor); the theme menu offers "Follow VS Code" |
| Side nav | expanded unless `dfm.nav` says collapsed | collapsed by default |
| `DfmViewMode === 1` | n/a | render `routes/Functions.svelte` alone, no shell |
| Open instance in a new tab/panel | `window.open(href)` | `host.openInNewWindow(instanceId)` |
| Downloads and SVG export | `<a download>` | `Download` / `SaveAs` bridge messages |

## §4 Routing

All client routes sit under the hub segment. `hubSegment` is the URL segment the backend already uses: `{connName}-{hubName}` or just `{hubName}` for the default connection.

| Route | Screen | Query params |
|---|---|---|
| `/` (or `/{routePrefix}/`) | Login / hub picker (browser only) | |
| `/{hub}` | Overview | `range`, `from`, `to` |
| `/{hub}/instances` | Instances | `range`, `from`, `to`, `status` (csv), `name` (csv), `col`, `op`, `val`, `entities` (`1`), `view` (`table`/`timeline`/`histogram`), `orderby`, `dir`, `hidden` (pipe csv), `start` (`1` opens Start new instance) |
| `/{hub}/instances/{instanceId}` | Instance workspace | `tab` (`summary`/`timeline`/`history`/`inputs`/`sequence`/`graph`/`raw`/`custom:<name>`), `timeFrom`, `col`, `op`, `val` (history filter), `seq` (scroll Inputs to that sequence number) |
| `/{hub}/durable-instances/{id}`, `/{hub}/orchestrations/{id}` | redirect (replaceState) to `/{hub}/instances/{id}` | |
| `/{hub}/failures` | Failures | `range`, `from`, `to` |
| `/{hub}/entities` | Entities | `name`, `key`, `updated` |
| `/{hub}/functions` | Functions | `range`, `from`, `to`, `layout` (`table`/`both`/`graph`), `selected` |
| `/{hub}/storage` | Storage | |
| `/{hub}/activity` | Activity | `range`, `from`, `to`, `operation` |
| `/{hub}/settings` | Settings | |

Rules:

- `href(path, query?)` in `router.svelte.ts` builds every link: `/${routePrefix}/${hub}${path}` with `routePrefix` empty at root, plus the query string. Never concatenate paths by hand in components.
- Global time range (`range` preset `15m|1h|24h|7d|30d`, or `from`/`to` ISO for custom) is shared by Overview, Instances, Failures, Functions and Activity. Changing it on one screen updates the URL and therefore every screen. Default `24h`. Preset labels: "Last 15 minutes", "Last hour", "Last 24 hours", "Last 7 days", "Last 30 days".
- Unknown path under a hub renders Overview. Unknown hub segment is not validated client side; `/about` failing with 401/403 shows the error toast with Retry.
- `instanceId` in the path is `encodeURIComponent`-ed. Entity ids (`@name@key`) are legal.
- In VS Code memory mode the same route objects are used; `OrchestrationIdFromVsCode` opens `/instances/{id}` directly.
- Client routing must not depend on `window.onpopstate` being unique (React did); use one `popstate` listener owned by the router.

## §5 Backend client

Interface (`src/lib/api/client.ts`):

```ts
export interface BackendClient {
  readonly isVsCode: boolean;
  get<T>(url: string, opts?: { conditional?: boolean }): Promise<T>;   // conditional: send If-None-Match, resolve cached body on 304 (http only)
  post<T>(url: string, body?: unknown): Promise<T>;
  put<T>(url: string, body?: unknown): Promise<T>;
  download(url: string, fileName: string): Promise<void>;   // POST, saves the response as a file (json/txt/dat by content type)
  host: {
    openInNewWindow(instanceId: string): void;
    saveAs(svg: string, suggestedName: string): Promise<void>;
    gotoFunctionCode(functionName: string): Promise<void>;
    gotoBinding(functionName: string, bindingIndex: number): Promise<void>;
    saveFunctionGraphAsJson(): Promise<void>;
    persistState(key: string, data: unknown): void;   // no-op in browser
  };
}
```

URL building (port of React `BackendClient.getTaskHubName`):

- `url` is relative to the hub: `/orchestrations?...`, `/about`, `/orchestrations('id')/history`.
- HTTP: `${apiRoutePrefix}/${hubSegmentForApi}${url}` where `hubSegmentForApi` is the hub segment, prefixed with `--` when it contains no `-` (the backend route is `{connName}-{hubName}`; `--hub` means default connection). Keep the React workaround: when the hub name ends with `TestHubName` and the call is `POST` to `/orchestrations` or `.../restart`, lowercase `TestHubName`.
- Calls under `/a/p/i` without a hub (`easyauth-config`, `task-hub-names`) use `${apiRoutePrefix}/${name}` directly.
- VS Code: `postMessage({ id, method, url, data })`; the extension prepends `/--{hub}` itself. Responses arrive as `window` `message` events `{ id, data }` or `{ id, err: { message, response?: { data } } }`. Extra methods: `Download` (`data` = file name), `OpenInNewWindow` (`url` = instanceId), `SaveAs` (`data` = svg string), `GotoFunctionCode` (`url` = name), `GotoBinding` (`url` = name, `data` = index), `SaveFunctionGraphAsJson`, `IAmReady` (send once after handlers are registered), `PersistState` (`key`, `data`). Custom inbound commands from the extension: `purgeHistory`, `cleanEntityStorage`, `startNewInstance`, `batchOps` (see E2-S6-T3 for what each opens). The extension answers `GET /function-map` locally; call it like any other GET.
- HTTP headers: `x-dfm-xsrf-token` from the cookie of the same name (decode URI component), `Authorization: Bearer` from MSAL when `easyauth-config` returned a `clientId`. `credentials: 'same-origin'`.

Error mapping (`src/lib/api/client.ts`), shared by both clients:

| Status | Class | Notes |
|---|---|---|
| 400 | `BadRequestError` | message = body text |
| 401 | `UnauthorizedError` | http client reloads the page when the easy-auth cookie expired (React did this on "Network Error"); otherwise toast |
| 403 | `ForbiddenError` | read-only mode or dangerous disabled |
| 404 | `NotFoundError` | |
| 409 | `ConflictError` | |
| 413 | `PayloadTooLargeError` | |
| 304 | not an error | http client returns the cached body |
| 5xx | `ServerError` | `body` keeps the parsed JSON when the response is JSON (recovery payloads of the input-event endpoints) |
| network | `NetworkError` | |

All carry `{ status: number; message: string; body?: unknown }`. `toastError(prefix, err)` renders `${prefix}. ${err.message}`.

## §6 Endpoints and DTOs

All relative to the hub. Existing endpoints keep their shapes (see `src/lib/api/types.ts` for the full TypeScript). New endpoints are marked with the backend epic that adds them and the capability flag that announces them.

| Call | Method | Capability | Shape |
|---|---|---|---|
| `/about` | GET | always | `About` (B0 extends) |
| `/orchestrations?$filter=&$orderby=&$top=&$skip=&hidden-columns=` | GET | always | `OrchestrationStatus[]` |
| `/orchestrations` | POST | write | `{ id?: string; name: string; data: unknown }` → `{ instanceId }` |
| `/orchestrations('{id}')` | GET | always | `OrchestrationDetails` (ETag after B0) |
| `/orchestrations('{id}')/history?$top=&$skip=&$filter=` | GET | always | `{ history: HistoryEvent[] }` (`totalCount` is not returned by the isolated backend; do not rely on it) |
| `/orchestrations('{id}')/{suspend,resume,rewind,terminate}` | POST | write | body = reason string or empty |
| `/orchestrations('{id}')/raise-event` | POST | write | `{ name: string; data: unknown }` (entities: signal) |
| `/orchestrations('{id}')/set-custom-status` | POST | write | JSON object or empty body to clear |
| `/orchestrations('{id}')/restart` | POST | write | `{ restartWithNewInstanceId: boolean }` |
| `/orchestrations('{id}')/purge` | POST | write | |
| `/orchestrations('{id}')/{input,output,custom-status}` | POST (download) | always | file |
| `/orchestrations('{id}')/custom-tab-markup('{template}')` | POST | always | HTML string |
| `/orchestrations('{id}')/input-events` | GET | always (400 for entities) | `InputEventsResponse` |
| `/orchestrations('{id}')/update-input-and-rewind` | POST | write + `storageSupports.updateInput` | `UpdateInputAndRewindRequest` → `UpdateInputAndRewindResult`; 500 body `UpdateInputRecovery` |
| `/orchestrations('{id}')/replay` | POST | dangerous + `truncateHistory` | `ReplayRequest` → `ReplayResult`; 500 body `ReplayRecovery` |
| `/orchestrations('{id}')/restart-in-place` | POST | dangerous | `RestartInPlaceRequest` → `RestartInPlaceResult`; 500 body `RestartInPlaceRecovery` |
| `/id-suggestions(prefix='{prefix}')` | GET | always | `string[]` |
| `/function-map` | GET | `IsFunctionGraphAvailable` | `{ functions: FunctionsMap; proxies: ProxiesMap }` |
| `/purge-history` | POST | `capabilities.purgeHistory` | `{ timeFrom, timeTill, statuses: RuntimeStatus[], entityType: 'Orchestration' \| 'DurableEntity' }` → `{ instancesDeleted }` |
| `/clean-entity-storage` | POST | `capabilities.cleanEntityStorage` | `{ removeEmptyEntities, releaseOrphanedLocks }` → `{ numberOfEmptyEntitiesRemoved, numberOfOrphanedLocksRemoved }` |
| `/delete-task-hub` | POST | `capabilities.deleteTaskHub` | |
| `/manage-connection` | GET | always | `{ connectionString (masked), hubName, isReadOnly: true }` |
| `../easyauth-config` | GET | browser | `{ clientId?: string; authority?: string; userName?: string }` |
| `../task-hub-names` | GET | browser | `string[]` |
| `/stats?from&to&bins&stuckAfterMinutes&pendingAfterMinutes` | GET | `stats` (B1) | `StatsResponse` |
| `/orchestrations('{id}')/children` | GET | `children` (B1) | `ChildrenResponse` |
| `/orchestrations('{id}')/spans` | GET | `spans` (B2) | `SpansResponse` |
| `/failures?from&to` | GET | `failures` (B3) | `FailuresResponse` |
| `/orchestrations/batch` | POST | `batch` (B3), write | `BatchRequest` → `BatchResponse` |
| `/storage?counts=true&instanceId=` | GET | `storageHealth` (B4) | `StorageResponse` |
| `/entities?name&keyPrefix&updatedFrom&updatedTo&$top&$skip` | GET | `entities` (B4) | `EntitiesResponse` |
| `/audit?from&to&operation&$top&$skip` | GET | `audit` (B5) | `AuditResponse` |

DTOs (authoritative; C# DTOs in the B epics serialise to exactly these, camelCase, enums as strings, dates as ISO 8601 UTC):

```ts
export type RuntimeStatus = 'Completed' | 'Running' | 'Failed' | 'Pending' | 'Terminated' | 'Canceled' | 'ContinuedAsNew' | 'Suspended';
export type EntityType = 'Orchestration' | 'DurableEntity';

export interface About {
  accountName: string; hubName: string; version: string;
  permissions: string[];                       // 'DurableFunctionsMonitor.ReadWrite', 'DurableFunctionsMonitor.DangerousOperations'
  // B0:
  provider: 'AzureStorage' | 'MsSql' | 'Netherite' | string;
  readOnly: boolean; dangerousOperations: boolean;
  capabilities: {
    stats: boolean; failures: boolean; spans: boolean; children: boolean; batch: boolean;
    storageHealth: boolean; audit: boolean; entities: boolean;
    updateInput: boolean; truncateHistory: boolean;
    purgeHistory: boolean; purgeEntities: boolean; cleanEntityStorage: boolean; deleteTaskHub: boolean;
    conditionalGet: boolean; episodeMarkers: boolean;
  };
  templates: { functionMapAvailable: boolean; functionCount: number | null; liquidTabs: string[]; customMetaTag: boolean };
}
// Before B0 ships, the client fills missing fields: provider 'unknown', readOnly from permissions, every capability false, templates empty.

export interface OrchestrationStatus {
  instanceId: string; name: string; runtimeStatus: RuntimeStatus; entityType: EntityType;
  entityId?: { name: string; key: string };
  createdTime: string; lastUpdatedTime: string; duration: number;   // ms, lastUpdated - created
  input?: unknown; output?: unknown; customStatus?: unknown; lastEvent?: string; parentInstanceId?: string;
}
export interface OrchestrationDetails extends OrchestrationStatus { parentInstanceId: string | null; tabTemplateNames: string[]; tags?: Record<string, string> /* B0 */ }

export interface HistoryEvent {
  SequenceNumber: number | null; Timestamp: string; EventType: string; EventId: number | null; Name: string | null;
  ScheduledTime: string | null; DurationInMs: number | null; SubOrchestrationId: string | null;
  Input: unknown; Result: unknown; Details: unknown;
  // B2 adds: TimerId?: number | null; FireAt?: string | null
}

// Input events: unchanged from the backend plan (docs/plans/input-events-restart-rewind-replay.md §4) and dfm-migration-plan.md §5.
export type InputEventOperation = 'restart-in-place' | 'update-input-and-rewind' | 'replay';
export interface OperationEligibility { allowed: boolean; reason?: string; requiresTerminate?: boolean; warning?: string }
export interface InputEvent { sequenceNumber: number | null; eventType: 'ExecutionStarted' | 'EventRaised'; name: string; timestamp: string; input: unknown; isLast: boolean; operations: Record<InputEventOperation, OperationEligibility> }
export interface InputEventsResponse { instanceId: string; runtimeStatus: RuntimeStatus; parentInstanceId: string | null; dangerousOperationsEnabled: boolean; storageSupports: { updateInput: boolean; truncateHistory: boolean }; events: InputEvent[] }
export interface RestartInPlaceRequest { input?: unknown }
export interface UpdateInputAndRewindRequest { sequenceNumber: number; input: unknown; reason?: string }
export interface ReplayRequest { sequenceNumber: number; input?: unknown; terminateIfRunning?: boolean }
export interface RestartInPlaceResult { instanceId: string; purged: true; input: unknown }
export interface UpdateInputAndRewindResult { sequenceNumber: number; inputUpdated: true; rewound: true }
export interface ReplayResult { sequenceNumber: number; eventName: string; deletedRows: number; raised: true }
export interface RestartInPlaceRecovery { error: string; orchestratorName: string; instanceId: string; input: unknown }
export interface ReplayRecovery { error: string; sequenceNumber: number; eventName: string; deletedRows: number; raised: false; input: unknown }
export interface UpdateInputRecovery { error: string; sequenceNumber: number; inputUpdated: true; rewound: false }
// Note: the `warning` for sub-orchestrations arrives per operation (`operations[op].warning`), not at the top level. Render it once at the top of the tab if any operation carries it.

// B1
export interface StatsRequest { from: string; to: string; bins?: number; stuckAfterMinutes?: number; pendingAfterMinutes?: number }
export interface StatsBin { start: string; end: string; counts: Partial<Record<RuntimeStatus, number>> }
export interface StatsByName { name: string; started: number; completed: number; failed: number; running: number; failureRate: number; p50Ms: number | null; p95Ms: number | null; lastFailedAt: string | null }
export interface StatsResponse {
  from: string; to: string; binCount: number;
  totals: Partial<Record<RuntimeStatus, number>> & { all: number; entities: number };
  bins: StatsBin[]; byName: StatsByName[]; entitiesByName: { name: string; count: number }[];
  stuck: { count: number; oldestLastUpdatedAt: string | null; sampleIds: string[] };
  oldestPending: { count: number; oldestCreatedAt: string | null; sampleIds: string[] };
  suspended: { count: number; oldestLastUpdatedAt: string | null; sampleIds: string[] };
  scanned: number; partial: boolean; cap: number; elapsedMs: number; generatedAt: string; cached: boolean;
}
export interface ChildrenResponse { children: { instanceId: string; name: string; runtimeStatus: RuntimeStatus; createdTime: string; lastUpdatedTime: string }[]; complete: boolean }

// B2
export type SpanKind = 'orchestrator' | 'activity' | 'subOrchestration' | 'timer' | 'externalEvent' | 'eventWait';
export interface Span { id: string; kind: SpanKind; name: string; attempt: number; start: string; end: string | null; status: 'completed' | 'failed' | 'running' | 'fired' | 'waiting' | 'raised'; sequenceNumbers: number[]; subOrchestrationId?: string; durationMs: number | null }
export interface SpansResponse { instanceId: string; executionId: string | null; generation: number | null; executionStartedAt: string | null; executionEndedAt: string | null; now: string; spans: Span[]; totals: { activitiesMs: number; subOrchestrationsMs: number; timersMs: number; externalEventWaitMs: number; orchestratorMs: number | null; totalMs: number }; historyRows: number; historyBytes: number | null; largeMessageBlobs: number | null }

// B3
export interface FailureInstance { instanceId: string; createdTime: string; completedTime: string | null; durationMs: number | null; reason: string }
export interface FailureGroup { key: string; name: string; signature: string; count: number; lastSeenAt: string; sampleIds: string[]; instances: FailureInstance[] }
export interface FailuresResponse { groups: FailureGroup[]; totalFailed: number; scanned: number; partial: boolean; cap: number; elapsedMs: number; generatedAt: string; cached: boolean }
export type BatchAction = 'suspend' | 'resume' | 'rewind' | 'terminate' | 'raise-event' | 'set-custom-status' | 'restart' | 'purge';
export interface BatchRequest { action: BatchAction; instanceIds: string[]; payload?: { reason?: string; name?: string; data?: unknown; customStatus?: unknown; restartWithNewInstanceId?: boolean } }
export interface BatchResponse { action: BatchAction; results: { instanceId: string; ok: boolean; status: number; message?: string }[]; okCount: number; failedCount: number; elapsedMs: number }

// B4
export interface StorageResponse {
  provider: 'AzureStorage'; accountName: string;
  taskHub: { name: string; partitionCount: number | null; createdAt: string | null; source: 'taskhub.json' | 'unknown' };
  queues: { name: string; kind: 'workitems' | 'control'; partition: number | null; approximateMessageCount: number | null }[];
  partitions: { name: string; owner: string | null; ownedSince: string | null; isDraining: boolean | null; nextOwner: string | null; source: 'table' | 'lease-blob' | 'none' }[];
  tables: { instances: string; history: string; partitions: string | null; audit: string | null };
  largeMessages: { container: string; exists: boolean; blobCount: number | null; totalBytes: number | null };
  counts: { instancesRows: number | null; historyRows: number | null; partial: boolean };
  generatedAt: string; elapsedMs: number; cached: boolean;
}
export interface EntityRow { instanceId: string; entityName: string; key: string; state: unknown | null; stateSummary: string | null; stateError: string | null; lastUpdatedTime: string; runtimeStatus: RuntimeStatus }
export interface EntitiesResponse { entities: EntityRow[]; hasMore: boolean }

// B5
export interface AuditRow { at: string; user: string; operation: string; kind: 'Write' | 'Dangerous'; instanceId: string | null; outcome: 'ok' | 'failed'; status: number; message: string | null }
export interface AuditResponse { rows: AuditRow[]; hasMore: boolean }
```

`$filter` clause syntax (port of React `OrchestrationsState.getFilterClause` and `FilterOperatorEnum.toOdataFilterQuery`; implement in `src/lib/filters/odata.ts` with unit tests):

```
createdTime ge '<fromIso>' and createdTime le '<toIso>'
  [and runtimeStatus in ('Running','Failed','DurableEntities')]
  [and <column> eq '<v>' | <column> ne '<v>' | startswith(<column>, '<v>') [eq false] | contains(<column>, '<v>') [eq false] | <column> in ('a','b') [eq false]]
```

Values are `encodeURIComponent`-ed inside the quotes. `In`/`Not In` accept a JSON array or CSV. Columns: `instanceId`, `name`, `runtimeStatus`, `createdTime`, `lastUpdatedTime`, `lastEvent`, `customStatus`, `input`, `output`, `parentInstanceId`. `lastEvent` and `parentInstanceId` are only populated by the backend when filtered on; the table shows those columns only then. Entities are included only when `'DurableEntities'` is in the status list; when no status list is sent the backend returns entities too, so the Instances screen always sends a status list (all eight statuses, plus `DurableEntities` when the include-entities chip is on).

History filter: `timestamp ge '<iso>'` plus the same column predicates over `Timestamp, EventType, EventId, Name, ScheduledTime, Input, Result, Details`. Paging `$top=200&$skip=n`.

## §7 State modules

One class per module in `src/lib/state/`, fields declared with `$state`, derived values as getters or `$derived` fields, no `$effect` inside modules (effects live in components). A module receives its dependencies (client, storage, router) in its constructor; a single `AppState` in `app.svelte.ts` wires them and is provided through Svelte context (`setContext('dfm')`).

| Module | Owns |
|---|---|
| `app.svelte.ts` | host, client, router, hub, `about`, capabilities, readOnly, dangerous, progress counter, toast queue, global time range |
| `login.svelte.ts` | easyauth-config, MSAL, user name, allowed hub names, sign in/out |
| `prefs.svelte.ts` | theme, mode, density, showTimeAs, nav collapsed, thresholds, saved views (§8) |
| `instances.svelte.ts` | filters, chips, ordering, hidden columns, page loading, selection, auto-refresh, cancel token; `list`, `timeline`, `histogram` sub-states |
| `instance.svelte.ts` | details, history paging + filter, tabs, actions, auto-refresh; `inputs.svelte.ts`, `spans`, `children`, `sequence`, `graph`, `custom tabs` sub-states |
| `overview.svelte.ts`, `failures.svelte.ts`, `entities.svelte.ts`, `functions.svelte.ts`, `storage.svelte.ts`, `activity.svelte.ts`, `settings.svelte.ts` | one per screen |
| `selection.svelte.ts` | selected instance ids for the bulk bar (shared by Instances, Failures groups) |
| `peek.svelte.ts` | the peeked row (id, name, status, kind, timestamps, customStatus, entity state) |
| `palette.svelte.ts` | command palette items and query |

Loading pattern (port of React `CancelToken`): each loader holds `inProgress` and a monotonically increasing `requestId`; a response is applied only if its `requestId` is still current. Auto-refresh reloads the first page only; manual "Load more" appends.

## §8 Persistence keys

Two storages, both behind `ITypedLocalStorage<T>` (`setItem`, `setItems`, `getItem`, `removeItem`, port of React's interface):

- `PrefsStorage`: localStorage in the browser (`dfm.theme`, `dfm.mode`, `dfm.density`, `dfm.showTimeAs`, `dfm.nav`, `dfm.thresholds`, `dfm.savedViews`, `dfm.autoRefresh.instances`, `dfm.autoRefresh.instance`), `PersistState` with key `prefs` in VS Code. Never written to the URL.
- `ViewStateStorage`: URL query first, then localStorage `dfm.view.<screen>::<field>` (browser) or `PersistState` key `view.<screen>` (VS Code). Used for filters, tab, ordering, hidden columns so links are shareable and the state survives reload.

Precedence for mode: user choice → `clientConfig.theme` → `prefers-color-scheme`. For theme: user choice → `clientConfig.dfmTheme` → `poster`; a value counts when it is one of the keys of `THEMES` (`src/lib/themes.ts`), which is the one list of themes in the app - the tests and the docs derive theirs from it (§16). Density: `compact` unless chosen. Time display: user choice → `clientConfig.showTimeAs` → `UTC`.

Applying: `document.documentElement.dataset.theme = theme`, `classList.toggle('dark', mode === 'dark')`, `dataset.density = density`. Use `mode-watcher` for the dark class and system preference; set the attribute yourself.

## §9 JSON display rule (D4)

- `formatJson(value: unknown): string` in `src/lib/format/json.ts`: if `value` is a string that parses as JSON, parse it first (the backend often returns JSON inside a string); then `JSON.stringify(parsed, null, 2)`. Non-JSON strings are returned unchanged. `null`/`undefined` → `''`.
- `JsonViewer` (read-only, tree mode, `expand([], () => true)` after every content change, `mainMenuBar` on for dialogs and the Raw tab, off inside cards, `navigationBar` on when the document has more than 200 nodes, `statusBar` off, `indentation: 2`, class `jse-theme-dfm`). `JsonEditor` (text mode, `indentation: 2`, `statusBar` on, `mainMenuBar` off, lint on; `readOnly` toggles the `.ed.ro` look). `JsonDialog` (dialog wrapper with title, subtitle, copy, close, optional download button for blob-backed fields).
- Inline `<pre class="json">` previews (Summary column input/output/customStatus, peek entity state) always render `formatJson(value)`, syntax-coloured with the `.jk .js .jn .jb .jz .jp` spans (a tiny tokenizer in `json.ts`, unit tested), clipped by `max-height` with an "open" button that opens `JsonDialog`.
- Table cells: `previewJson(value, 120)` gives a single-line, whitespace-collapsed string truncated with `…`; the cell is a mono link that opens `JsonDialog`. This is the only place JSON is not expanded.
- Copy to clipboard copies the pretty-printed text.
- Blob-backed fields: when a field value is a string starting with `https://` (large payload offloaded by the engine), show it as a mono link with a Download button (`client.download`) instead of an editor.

## §10 Formatting

`src/lib/format/time.ts`: all inputs are ISO strings from the backend (UTC). `showTimeAs` from prefs.

| Function | Output | Used by |
|---|---|---|
| `fmtDateTime(iso)` | `2026-09-04 14:02:11` (UTC or local per prefs) | tables, meta lines |
| `fmtDateTimeMs(iso)` | `2026-09-04 14:02:11.913` | history, inputs |
| `fmtTime(iso)` | `14:02:11` | axis ticks, compact tables |
| `fmtTimeMs(iso)` | `14:02:11.913` | history timestamp column |
| `fmtAgo(iso, now)` | `47 s ago`, `11 min ago`, `1 h 52 min ago`, `1 d ago` | header meta |
| `timeZoneLabel()` | `UTC`, `UTC+2`, `UTC-5.5` | top bar toggle tooltip |

`src/lib/format/duration.ts`:

| Function | Rule | Examples |
|---|---|---|
| `fmtDuration(ms)` | `< 1000` → `n ms`; `< 60 s` → `n s` (no decimals); `< 60 min` → `n.n min` with one decimal below 10 minutes, else integer; `< 24 h` → `n h` (one decimal below 10 h); else `n d` (one decimal below 10 d). Null/NaN/negative → `—`. | `47 s`, `2.3 min`, `41 min`, `14 h`, `2 d` |
| `fmtDurationClock(ms)` | `HH:MM:SS`, days as prefix `1d 02:03:04` | header tile `00:00:47` |
| `fmtDurationCompact(ms)` | port of React `DateTimeHelpers.formatDuration`: `1d2h`, `2h13m`, `17s`, `250ms`, two most significant units | Gantt labels |

`src/lib/format/bytes.ts`: `fmtBytes(n)` → `0.9 KB`, `41.2 KB`, `211 MB`; `utf16Bytes(str) = str.length * 2` (the backend's `Encoding.Unicode` rule); inline limit constant `MAX_INLINE_BYTES = 61440`.

Numbers: `fmtInt(n)` uses `toLocaleString('en-US')` → `1,204`. Percent: `fmtPct(x)` → `0.7 %` (one decimal, space before `%`).

## §11 Status and kind vocabulary

| Runtime status | class | spine attribute |
|---|---|---|
| Completed | `st-completed` | `data-st="Completed"` |
| Running | `st-running` | |
| Failed | `st-failed` | |
| Pending | `st-pending` | |
| Terminated | `st-terminated` | |
| Canceled | `st-canceled` | |
| ContinuedAsNew | `st-continued` | `data-st="ContinuedAsNew"` |
| Suspended | `st-suspended` | |
| entity kind | `kind-entity` | |
| orchestration kind | `kind-orchestration` | |

`statusClass(status)` and `spineAttr(status)` in `src/lib/format/status.ts`. Entities have `runtimeStatus` `Running` from the backend but display the chip the mockup shows for entities (`Pending`/`Running` as returned; do not invent).

Graph node kinds: `orchestrator`, `activity`, `entity`, `suborchestrator`, `http`, `timer`, `queue`, `other` → classes `n-<kind>`.

## §12 Class map (dfm-ui.css → component)

| Class(es) | Component (E1 unless noted) | Notes |
|---|---|---|
| `.btn`, `.primary`, `.secondary`, `.destructive`, `.danger`, `.ghost`, `.sm`, `.flat` | `Button.svelte` `variant`, `size`, `flat` props | `.danger` = destructive with stripe top border (Dangerous ops) |
| `.link` | `LinkButton.svelte` | mono via `mono` prop |
| `.chip`, `.chip.sm`, `.st-*`, `.kind-*` | `Chip.svelte`, `StatusChip.svelte` | |
| `.dbadge` | `DangerBadge.svelte` | stripe-topped |
| `.tag` | `Tag.svelte` | history "input" tag |
| `.mini` | `MiniCounter.svelte` | graph nodes |
| `.seg` | `Segmented.svelte` | UTC/Local, Table/Both/Graph |
| `.tri`, `.swq`, `.avatar` | inline in owners | |
| `.input`, `.sel`, `.field`, `.check`, `.box`, `.switch` | `TextInput`, `Select`, `Field`, `Checkbox`, `Switch` | Select wraps bits-ui Select; Checkbox/Switch wrap bits-ui |
| `.ed`, `.ed.ro`, `.ed .foot`, `.meter` | `JsonEditor.svelte` (+ `SizeMeter.svelte`) | |
| `.tabs`, `.tab`, `.summary-tab` | `Tabs.svelte` | bits-ui Tabs for roving focus |
| `.tbl-wrap`, `.tbl`, `.spine`, `.trunc`, `.sort`, `.sel-cell`, `.tfoot`, `[data-clickable]` | `DataTable.svelte` + cell snippets | `.keep` opts out of the mobile card layout |
| `.page`, `.ptitle`, `.section-h`, `.banner`, `.panel`, `.panel-h`, `.panels`, `.card`, `.two`, `.stack`, `.row`, `.grow`, `.kv`, `.empty`, `.vsep`, `.sep` | `Page`, `PageTitle`, `Banner`, `Panel`, `Card`, `Kv`, `EmptyState` | layout classes used directly |
| `.tiles`, `.stat-tile` | `StatTile.svelte` (E7) | sparkline inside |
| `.attn` | `NeedsAttention.svelte` (E7) | |
| `.chips2`, `.fchip`, `.fchip.add`, `.fchip .x`, `select.fchip` | `FilterChips.svelte`, `FacetChip.svelte`, `RangeSelect.svelte` (E4) | |
| `.shell`, `.snav`, `.main`, `.topbar`, `.logo`, `.content`, `.anchor`, `.pop`, `.mi`, `.ttile`, `.progress`, `.bottom-nav`, `.sheet` | E2 shell components | `.pop` is the popover/menu surface; use bits-ui DropdownMenu/Popover with these classes |
| `.overlay`, `.dialog`, `.warn`, `.body`, `.foot` | `Dialog.svelte`, `ConfirmDialog.svelte` | `.warn` stripe band for destructive |
| `.toast`, `.toast.ok` | `ToastHost.svelte` over svelte-sonner (E2) | |
| `.bulk` | `BulkActionBar.svelte` (E4) | |
| `.peek`, `.phead`, `.pbody`, `.tile` | `PeekPanel.svelte` (E2), `StatusTile.svelte` | |
| `.palette`, `.plist`, `.grp`, `.prow`, `.kbd`, `.pfoot` | `CommandPalette.svelte` (E2) | bits-ui Command |
| `.hero`, `.hmeta`, `.actions`, `.ws`, `.summary`, `.tabbody`, `.wbar`, `.icard`, `.ops`, `.op`, `.note`, `.json`, `.jk...`, `.jse-bar` | E5/E8 workspace components | `.jse-bar` is the svelte-jsoneditor menu bar look; the real editor replaces the `<pre>` |
| `.swim`, `.swim-in`, `.axis`, `.lane`, `.track`, `.bar`, `.blbl`, `.now` | `Swimlane.svelte` (D3, E1-S8) | |
| `.seq`, `.seq-in`, `.parts`, `.part`, `.life`, `.smsg`, `.arrow` | `SequenceDiagram.svelte` (D3, E5) | |
| `.node`, `.band`, `.metrics`, `.n-*`, `.graph`, `.gcanvas`, `.gctl`, `.minimap` | `FunctionGraph.svelte` (Svelte Flow, E5/E7) | node component reproduces `.node` markup |
| `.hist`, `.col`, `.seg-b`, `.brush`, `.legend` | `StackedColumns.svelte` (D3, E1-S8) | |
| `.group`, `.ghead`, `.frow`, `.gfoot` | `FailureGroup.svelte` (E9) | |
| `.login`, `.hubrow` | `Login.svelte` (E2) | |

## §13 Keyboard map (E2-S5)

`Ctrl/⌘ K` palette · `/` focus instance jump · `g o` `g i` `g f` `g e` `g s` navigate (900 ms chord window) · `Esc` closes palette, peek, menus, dialogs (innermost first) · arrows + Enter inside palette and comboboxes. Shortcuts are ignored while typing in inputs, textareas, selects, contenteditable, and on the Login route.

## §14 Responsive rules (already in dfm-ui.css)

≤ 1100 px: filter rail wraps, Overview tiles 3-up, workspace Summary becomes a tab (`.ws[data-tab="summary"]`), inputs cards stack, failures rows wrap. ≤ 768 px: side nav → bottom tab bar, tables → stacked cards (`td[data-label]` becomes the label; `.tbl-wrap.keep` opts out), bulk bar and toast sit above the bottom nav, peek → bottom sheet, palette → full screen, theme/mode controls leave the top bar. Components must emit the `data-label` attributes and the `hide-m`/`show-m` classes the CSS expects.

## §15 Commands

| Where | Command | Purpose |
|---|---|---|
| `durablefunctionsmonitor.svelte/` | `npm run dev` | Vite dev server on :3000, proxies API to :7072 |
| | `npm run build` | production build to `build/` |
| | `npm run build-and-copy` | build + copy to `../durablefunctionsmonitor.dotnetisolated/DfmStatics` |
| | `npm run check` | `svelte-check --tsconfig ./tsconfig.json` |
| | `npm run lint` | eslint + prettier check |
| | `npm test` | vitest run |
| | `npm run test:e2e` | playwright (needs Azurite + host, see E3) |
| | `npm run preview:styles` | the design-system preview page with the family sheets, photographed per theme and mode (§16) |
| repo root | `node scripts/harness/verify-build-contract.mjs durablefunctionsmonitor.svelte/build` | build contract check |
| | `node scripts/harness/plan-status.mjs [next|E4]` | next open task / epic status |
| | `node scripts/harness/style-preview.mjs [--shoot]` | builds `durablefunctionsmonitor.svelte/build/style-preview/index.html`; `--shoot` photographs it |
| | `dotnet build DurableFunctionsMonitor.slnx` | everything, including the esproj (runs npm build) |
| | `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.tests` | backend unit tests |
| | `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests` | Azurite tests (Inconclusive without Azurite) |
| `durablefunctionsmonitor.dotnetisolated/bin/Debug/net10.0` | `func host start --port 7072` | the standalone host (needs `local.settings.json`, see E3-S3-T1) |

Local host environment for development and e2e (`local.settings.json`, gitignored):

```json
{ "IsEncrypted": false, "Values": {
  "AzureWebJobsStorage": "UseDevelopmentStorage=true",
  "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
  "DFM_NONCE": "i_sure_know_what_i_am_doing",
  "DFM_DANGEROUS_OPERATIONS_ENABLED": "true",
  "DFM_AUDIT_ENABLED": "true"
} }
```

`DFM_NONCE=i_sure_know_what_i_am_doing` disables authentication; `easyauth-config` then returns no `clientId` and the UI skips MSAL.

## §16 Theme families (E13; README D12–D14)

A theme has a `family` (`ThemeDescriptor.family` in `src/lib/themes.ts`): `brutal` for the papers, `glass` and `neu` for the two soft families. The family is a property of the theme and never a second preference: `dfm.theme`, `dfmTheme`, the menu, the Settings tiles and the palette list themes, and nothing in the app branches on the family except the tests and the metrics label.

A family is one plain-CSS sheet, `src/styles/families/<key>.css`, imported from `app.css` after `families/base.css`, which comes after `dfm-ext.css`:

- every rule is scoped under `[data-theme="<key>"]`, `.dark[data-theme="<key>"]`, `html[data-theme="<key>"]` or `html.dark[data-theme="<key>"]`, or sits inside `@media (prefers-reduced-transparency: reduce)` / `@media (prefers-contrast: more)` with the same scoping, so nothing of it reaches the papers;
- it declares every token `[data-theme="poster"]` declares in its light block, every token `.dark[data-theme="poster"]` declares in its dark block, and `--glyph` in both - a token left out would silently inherit Poster's value;
- it is plain CSS the browser loads without Tailwind (no `@utility`, `@theme`, `@custom-variant`, `@apply`, no Tailwind classes), which is how `node scripts/harness/style-preview.mjs` loads it;
- a family sheet may override a `dfm-ui.css` rule for its own theme; nothing else may. `base.css` holds only what every family shares (today one rule, `:root { --glyph: var(--ink); }`), `dfm-ext.css` holds nothing family-related, and `dfm-tokens.css` and `dfm-ui.css` stay verbatim.

`tests/unit/family-sheets.test.ts` enforces the first three for every non-brutal entry of `THEMES`; `tests/e2e/themes.spec.ts` asserts each theme by its family and photographs the seven-screen matrix for all of them; `tests/e2e/a11y.spec.ts` runs one theme per family.

`--glyph` is the colour of a small solid mark: the checkbox tick, the switch knob, the select caret, the sort triangle, an arrowhead, the "now" line, the orchestration bar, a hatch. In the papers it is `--ink`; a soft family sets it to a strong colour while its `--ink` goes soft, so a line can fade without the marks drawn in it disappearing. Components that draw marks themselves read it (`glyphColor()` in `chart-tokens.ts`, `var(--glyph)` in `dfm-ext.css` and the histogram brush); outlines - segment strokes, node frames, participant boxes - stay `--ink`.

The design system's §3 rules split in two (D14). Universal, in every family:

- status is a solid fill with dark text and keeps its hue; the status spine stays on every list row;
- colour is a vocabulary - eight statuses, two kinds, seven node kinds, five series - and a theme changes the hue, never the meaning;
- one loud element per screen;
- sentence case; verb + object on destructive buttons; icons never alone;
- the focus ring is a colour, never the line;
- motion only in answer to an action, and `prefers-reduced-motion` removes it;
- dark mode is a second face of the theme, not an inversion.

Brutalist only (`family === 'brutal'`; the "papers are flat and hard" test in `themes.spec.ts` reads them from computed styles):

- the ink outline as the line of every control and container;
- the hard offset shadow, never blur;
- no alpha, no gradients, no backdrop filter;
- the paper patterns.

What a soft family looks like is its own epic's business: E14 for Glass (one blur per surface, never on rows, chips or buttons; a strong glyph; the backdrop only on the page), E15 for Neu (one material, raised surfaces, inset inputs and pressed states, no visible line).
