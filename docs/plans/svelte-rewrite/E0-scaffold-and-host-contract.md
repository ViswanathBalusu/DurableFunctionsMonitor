# E0 · Scaffold and host contract

Goal: a Svelte 5 + Vite project that builds into exactly the statics the backend and the VS Code extension serve, talks to the backend through both clients, routes like contracts §4, and renders a placeholder shell in both hosts. Nothing visual beyond the placeholder; that is E1 and E2.

Prerequisites: none. Read contracts §1, §2, §3, §4, §5, §8, §15.

Exit criteria: `npm run build-and-copy` produces `durablefunctionsmonitor.dotnetisolated/DfmStatics`, `node scripts/harness/verify-build-contract.mjs durablefunctionsmonitor.svelte/build` passes, the standalone host serves the app at `/durable-functions-monitor/DurableFunctionsHub` and at an instance URL, the VS Code extension shows it through `Custom Path to Backend Binaries`, and `/about` data is displayed in both.

### E0-S1 Project scaffold

#### E0-S1-T1 Create the project and pin dependencies
Files: `durablefunctionsmonitor.svelte/package.json`, `tsconfig.json`, `tsconfig.node.json`, `.gitignore`, `.npmrc`, `eslint.config.js`, `.prettierrc`, `src/main.ts`, `src/App.svelte`, `src/app.css`, `src/vite-env.d.ts`
Depends: none
Do:
1. In the repo root run `npm create vite@latest durablefunctionsmonitor.svelte -- --template svelte-ts`, then delete the template's `src/lib/Counter.svelte`, `src/assets`, `public/vite.svg`, and the demo markup in `App.svelte`.
2. Set `"private": true`, `"name": "durablefunctionsmonitor.svelte"`, `"version"` equal to `VersionPrefix` in `Directory.Build.props` (6.9.0), `"type": "module"`.
3. Install exactly the versions in README "Package versions": runtime `svelte`, `bits-ui`, `mode-watcher`, `@lucide/svelte`, `svelte-sonner`, `@tanstack/table-core`, `@tanstack/svelte-virtual`, `svelte-jsoneditor`, `d3`, `@xyflow/svelte`, `@dagrejs/dagre`, `@internationalized/date`, `@azure/msal-browser`; dev `vite`, `@sveltejs/vite-plugin-svelte`, `tailwindcss`, `@tailwindcss/vite`, `shadcn-svelte`, `typescript@5.9.3`, `svelte-check`, `vitest`, `jsdom`, `@testing-library/svelte`, `@testing-library/jest-dom`, `@playwright/test`, `@types/d3`, `eslint`, `eslint-plugin-svelte`, `typescript-eslint`, `prettier`, `prettier-plugin-svelte`, `ncp`, `rimraf`. Use `npm install <pkg>@<version> --save-exact`.
4. Scripts: `dev`, `build` (`vite build`), `build-and-copy` (`npm run build && node copy-build-artifacts.js`), `preview`, `check` (`svelte-check --tsconfig ./tsconfig.json`), `lint` (`eslint . && prettier --check .`), `format`, `test` (`vitest run`), `test:watch`, `test:e2e` (`playwright test`), `verify` (`node ../scripts/harness/verify-build-contract.mjs build`).
5. `tsconfig.json`: `strict: true`, `moduleResolution: "bundler"`, `paths: { "$lib/*": ["./src/lib/*"] }` plus the matching `resolve.alias` in `vite.config.ts`.
6. `.npmrc`: `save-exact=true`, `engine-strict=true`; `"engines": { "node": ">=22" }`.
7. `.gitignore`: `node_modules`, `build`, `test-results`, `playwright-report`, `.vite`.
8. Create the folder layout of contracts §1 with a `.gitkeep` in each empty folder.
Accept:
- [ ] `npm ci` succeeds with a lockfile committed.
- [ ] `npm run check`, `npm run lint`, `npm test` (zero tests is fine) and `npm run build` succeed on the empty app.
- [ ] `package.json` versions match README exactly (no `^`).
Test: none beyond the commands above.

#### E0-S1-T2 Vite config and index.html template
Files: `vite.config.ts`, `index.html`, `public/favicon.png`, `public/logo.svg`, `public/manifest.json`
Depends: E0-S1-T1
Do:
1. Write `vite.config.ts` exactly as contracts §2 (plugins, base, build output names, `inlineDynamicImports`, `hashCharacters: 'hex'`, `renderBuiltUrl`, dev proxy, vitest block). Add `resolve.alias['$lib']`.
2. `index.html`: `<!doctype html>`, `lang="en"`, charset, viewport, `<title>Durable Functions Monitor</title>`, the seven placeholder tags from contracts §2 verbatim inside `<body>` before `<div id="root"></div>`, the Google Fonts links from `DFM App.dc.html` L12–L14 (preconnects + `Archivo:wdth,wght@62..125,100..900` + `JetBrains+Mono:wght@400;600`), `<link rel="manifest" href="/manifest.json" crossorigin="use-credentials">`, `<link rel="shortcut icon" href="/favicon.png">`, `<noscript>` text, and `<script type="module" src="/src/main.ts"></script>`.
3. Copy `favicon.png`, `logo.svg`, `manifest.json` from `durablefunctionsmonitor.react/public/`. Do not copy `static/icons/all-azure-icons.svg` (not used).
4. `src/main.ts` mounts `App.svelte` into `#root` with Svelte 5 `mount`.
Accept:
- [ ] `npm run build` emits exactly `build/index.html`, `build/static/js/main.<hex>.js`, `build/static/css/main.<hex>.css`, `build/favicon.png`, `build/logo.svg`, `build/manifest.json` (plus `.map` files).
- [ ] `node ../scripts/harness/verify-build-contract.mjs build` passes.
- [ ] `build/index.html` contains the seven placeholder lines unchanged (the verify script checks this).
Test: the verify script.

#### E0-S1-T3 Tokens, Tailwind and shadcn-svelte init
Files: `src/app.css`, `src/styles/dfm-tokens.css`, `components.json`, `src/lib/utils.ts`
Depends: E0-S1-T2
Do:
1. Copy `docs/ui-plans-artifacts/uploads/files/dfm-tokens.css` to `src/styles/dfm-tokens.css` unchanged (it starts with `@import "tailwindcss";` and holds `@theme inline`, all five themes, the utilities and the two library bridges).
2. `src/app.css`: `@import "./styles/dfm-tokens.css";` then `@import "./styles/dfm-ui.css";` (the second file is created in E1-S1-T1; until then create it empty).
3. Run `npx shadcn-svelte@1.6.1 init` in the project: Tailwind v4, base color neutral (colors are overridden by tokens anyway), css file `src/app.css`, component path `$lib/components/ui`, utils path `$lib/utils`. Verify `components.json` points at those paths and that init did not rewrite the token file (if it did, restore it and re-check).
4. Import `./app.css` in `src/main.ts`.
Accept:
- [ ] `document.documentElement` with `data-theme="riso"` and `class="dark"` yields `getComputedStyle(document.body).backgroundColor` of `rgb(16, 32, 58)` in a vitest jsdom test that loads the CSS? jsdom does not compute custom properties; instead write a vitest test that reads `src/styles/dfm-tokens.css` and asserts it is byte-identical to the artifact file (guards drift).
- [ ] The built CSS contains `--status-failed` for all five themes (grep the emitted CSS in a small node test under `tests/unit/build-css.test.ts` that runs only when `build/` exists).
Test: `tests/unit/tokens-verbatim.test.ts`.

#### E0-S1-T4 Copy step, esproj and solution entry
Files: `copy-build-artifacts.js`, `durablefunctionsmonitor.svelte.esproj`, `DurableFunctionsMonitor.slnx`
Depends: E0-S1-T2
Do:
1. Port `durablefunctionsmonitor.react/copy-build-artifacts.js`: rimraf `../durablefunctionsmonitor.dotnetisolated/DfmStatics`, then copy `build/` there with `ncp`. Do not copy `service-worker.js` (there is none). Keep `.map` files.
2. Create `durablefunctionsmonitor.svelte.esproj` from the React one: SDK `Microsoft.VisualStudio.JavaScript.SDK/1.0.6578810`, `StartupCommand` `npm run dev`, `BuildCommand` `npm run build-and-copy`, `BuildOutputFolder` `$(MSBuildProjectDirectory)\build`, `JavaScriptTestRoot` `tests\`, `JavaScriptTestFramework` `Playwright`, `ShouldRunNpmAudit` `false`. Note in a comment that `npm run build-and-copy` is what places statics into the host project.
3. In `DurableFunctionsMonitor.slnx`, replace the React project entry with `durablefunctionsmonitor.svelte/durablefunctionsmonitor.svelte.esproj` (same `Platform` and `Build` children). The React folder stays in the repo, out of the solution, until E12.
Accept:
- [ ] `dotnet build DurableFunctionsMonitor.slnx -c Release` runs the Svelte build and leaves `durablefunctionsmonitor.dotnetisolated/DfmStatics/index.html` in place.
- [ ] `dotnet build` of the React esproj is no longer triggered (check the build log).
Test: the dotnet build.

### E0-S2 Host contract

#### E0-S2-T1 host.svelte.ts
Files: `src/lib/host.svelte.ts`, `src/lib/host.test.ts`
Depends: E0-S1-T1
Do:
1. Implement `host` exactly as contracts §3. Read each global through `(globalThis as any).X` with a default when undefined, so unit tests can set them. Call `acquireVsCodeApi()` once and cache it; wrap in try/catch.
2. Export `declare global` typings for the seven globals in `src/vite-env.d.ts`.
Accept:
- [ ] With no globals defined, `host.kind === 'browser'`, `routePrefix === ''`, `apiRoutePrefix === 'a/p/i'`? No: when `DfmApiRoutePrefix` is empty the React client used `RoutePrefix + 'a/p/i'`; replicate: `apiRoutePrefix = DfmApiRoutePrefix || (routePrefix ? routePrefix + '/a/p/i' : 'a/p/i')`.
- [ ] With `acquireVsCodeApi` defined, `host.kind === 'vscode'` and `host.vsCodeApi` is the returned object.
Test: `host.test.ts` sets globals before importing the module (use `vi.resetModules()` and dynamic import).

#### E0-S2-T2 Typed storage
Files: `src/lib/storage/typed-local-storage.ts`, `src/lib/storage/vscode-typed-local-storage.ts`, `src/lib/storage/prefs-storage.ts`, `src/lib/storage/view-state-storage.ts`, `src/lib/storage/query-string.ts`, tests next to each
Depends: E0-S2-T1
Do:
1. Port `ITypedLocalStorage<T>`, `TypedLocalStorage` (localStorage + query string mirror, key `${prefix}::${field}`), `VsCodeTypedLocalStorage` (seeded from `host.stateFromVsCode[prefix]`, saves through `host.vsCodeApi.postMessage({ method: 'PersistState', key, data })`), and `QueryString` (parse, set, apply with replaceState/pushState) from `durablefunctionsmonitor.react/src/states/`.
2. `PrefsStorage`: `ITypedLocalStorage<Prefs>` writing plain keys `dfm.<field>` to localStorage (no query string) in the browser, `PersistState` key `prefs` in VS Code (contracts §8).
3. `ViewStateStorage(screen)`: query string first, then `dfm.view.<screen>::<field>` (browser) or `PersistState` key `view.<screen>` (VS Code).
4. `createStorages(host)` picks the implementations by `host.kind`.
Accept:
- [ ] Round trip of set/get/remove for both implementations in jsdom; VS Code implementation posts one `PersistState` per `setItems` call.
- [ ] `TypedLocalStorage.getItem` prefers the query string over localStorage.
Test: unit tests for each class.

#### E0-S2-T3 Backend clients
Files: `src/lib/api/client.ts`, `src/lib/api/http-client.ts`, `src/lib/api/vscode-client.ts`, `src/lib/api/hub-segment.ts`, tests
Depends: E0-S2-T1
Do:
1. `client.ts`: the `BackendClient` interface and error classes from contracts §5 (`BackendError` base with `status`, `message`, `body`; subclasses per status; `NetworkError`). `mapError(status, bodyText)` parses JSON bodies when the content type is JSON and keeps them on `body`.
2. `hub-segment.ts`: `apiHubSegment(hub, method, url)` implementing the `--` prefix rule and the `TestHubName` workaround; `clientHubSegment(hub)` (the URL segment as typed).
3. `http-client.ts`: `HttpBackendClient(getHub, getAuthHeaders)`. `fetch` with `credentials: 'same-origin'`, `x-dfm-xsrf-token` from the cookie, `Authorization` from `getAuthHeaders()`, JSON bodies, `Accept: application/json`. `get(url, { conditional })` stores `ETag` per URL and sends `If-None-Match`; on 304 resolves the cached body. Plain text responses (custom tab markup) resolve as string when the content type is not JSON. On 401 with `NetworkError`-like failure (TypeError from fetch) after a successful login, reload the page once (React's cookie-expiry workaround), guarded by a session flag so it cannot loop. `download(url, fileName)` POSTs, reads `content-type`, picks `.json`/`.txt`/`.dat`, creates an object URL and clicks an `<a download>`. `host.*` methods: `openInNewWindow` = `window.open(href)`, `saveAs` = download of the SVG string with `image/svg+xml`, the rest no-ops resolving immediately.
4. `vscode-client.ts`: port of `VsCodeBackendClient`: request id map, `window` message listener, custom handlers (`purgeHistory`, `cleanEntityStorage`, `startNewInstance`, `batchOps`) registered through `setCustomHandlers(handlers)`, which posts `IAmReady` once. Errors from the bridge (`{ err: { message, response: { data } } }`) become `BackendError` with `status` guessed from the message (`404`, `409`, `403`, `413`, `400` when the message contains "status code NNN", else 500) and `body` = `response.data`.
Accept:
- [ ] URL for hub `DurableFunctionsHub` and `/about` is `${apiRoutePrefix}/--DurableFunctionsHub/about`; for hub `conn-hub` it is `${apiRoutePrefix}/conn-hub/about`.
- [ ] 404 text body → `NotFoundError` with `message` = body; 500 JSON body → `ServerError` with `body` parsed.
- [ ] A second `get(url, { conditional: true })` sends `If-None-Match` with the first response's ETag and returns the cached body on 304.
- [ ] VS Code client resolves the right promise by id and rejects with the bridge error.
Test: `http-client.test.ts` with `vi.stubGlobal('fetch', ...)`; `vscode-client.test.ts` with a fake `postMessage` and dispatched `MessageEvent`s.

#### E0-S2-T4 Typed endpoints and DTOs
Files: `src/lib/api/types.ts`, `src/lib/api/endpoints.ts`, `src/lib/api/endpoints.test.ts`
Depends: E0-S2-T3
Do:
1. `types.ts`: every interface from contracts §6, exported.
2. `endpoints.ts`: `createEndpoints(client)` returning one function per row of the endpoint table in contracts §6, e.g. `about()`, `listOrchestrations(query: { filter, orderBy?, top, skip, hiddenColumns? })`, `getOrchestration(id, conditional)`, `getHistory(id, { top, skip, filter })`, `postAction(id, action, body)`, `raiseEvent(id, name, data)`, `setCustomStatus(id, value|null)`, `restart(id, withNewId)`, `purge(id)`, `downloadField(id, field)`, `customTabMarkup(id, template)`, `inputEvents(id)`, `updateInputAndRewind(id, req)`, `replay(id, req)`, `restartInPlace(id, req)`, `idSuggestions(prefix)`, `functionMap()`, `purgeHistory(req)`, `cleanEntityStorage(req)`, `deleteTaskHub()`, `manageConnection()`, `easyAuthConfig()`, `taskHubNames()`, `stats(req)`, `children(id)`, `spans(id)`, `failures(range)`, `batch(req)`, `storage(opts)`, `entities(query)`, `audit(query)`.
3. Instance ids in `orchestrations('{id}')` are inserted with `encodeURIComponent(id).replace(/'/g, "%27")`.
4. `normalizeAbout(raw)`: fills missing B0 fields as contracts §6 says (before B0 ships).
Accept:
- [ ] `listOrchestrations` builds `/orchestrations?$top=50&$skip=0&$filter=...&$orderby=createdTime desc&hidden-columns=input|output` (order of params as shown).
- [ ] `getOrchestration("a'b")` calls `/orchestrations('a%27b')`.
- [ ] `normalizeAbout({ permissions: [] })` yields `readOnly: true`, every capability `false`, `provider: 'unknown'`.
Test: `endpoints.test.ts` with a recording fake client.

### E0-S3 Router

#### E0-S3-T1 Route model and parser
Files: `src/lib/router.svelte.ts`, `src/lib/router.test.ts`, `src/lib/filters/time-range.ts`, `src/lib/filters/time-range.test.ts`
Depends: E0-S2-T1
Do:
1. `Route` union: `{ name: 'login' } | { name: 'overview' | 'instances' | 'failures' | 'entities' | 'functions' | 'storage' | 'activity' | 'settings'; hub } | { name: 'instance'; hub; instanceId }`, plus `query: URLSearchParams`.
2. `parsePath(pathname, routePrefix)`: strip the prefix (case-insensitive, once), split, map to a `Route` per contracts §4 including the two alias forms (`durable-instances`, `orchestrations`) which return `{ ..., redirectTo }`. Unknown sub-path under a hub → `overview`. Decode `instanceId` with `decodeURIComponent`.
3. `Router` class (rune module): `current` (`$state`), `mode: 'history' | 'memory'`, `navigate(route, { replace?, query? })`, `href(pathOrRoute, query?)`, `setQuery(patch, { replace })` (merges, deletes `null` values), `back()`. History mode listens to `popstate`; memory mode keeps `current` in state and persists `{ route, query }` through `ViewStateStorage('route')` (VS Code). On construction in VS Code with `host.orchestrationIdFromVsCode`, start on `instance`.
4. `time-range.ts`: `TimeRange = { preset: '15m'|'1h'|'24h'|'7d'|'30d' } | { from: string; to: string }`; `parseTimeRange(query)`, `toQuery(range)`, `resolve(range, now)` → `{ from: Date, to: Date }`, `label(range)` ("Last 24 hours" or `2026-09-04 08:30 → 14:02`).
Accept:
- [ ] `parsePath('/prefix/DurableFunctionsHub/instances/order-1', 'prefix')` → instance route with hub and id; `/DurableFunctionsHub/durable-instances/x` → `redirectTo` `/DurableFunctionsHub/instances/x`.
- [ ] `href({ name: 'failures', hub })` with prefix `''` is `/DurableFunctionsHub/failures`; with prefix `dfm` it is `/dfm/DurableFunctionsHub/failures`.
- [ ] `setQuery({ range: '7d', from: null })` removes `from` and keeps other params.
- [ ] Memory mode navigation does not touch `window.history`.
Test: unit tests above; `time-range.test.ts` covers every preset and the custom form.

### E0-S4 App state, prefs and placeholder shell

#### E0-S4-T1 Prefs module and theme runtime
Files: `src/lib/state/prefs.svelte.ts`, `src/lib/state/prefs.test.ts`
Depends: E0-S2-T2
Do:
1. `Prefs` class with `$state` fields `theme` (`'poster'|'riso'|'memphis'|'blueprint'|'hazard'`), `mode` (`'light'|'dark'|'system'`), `density` (`'compact'|'comfortable'`), `showTimeAs` (`'UTC'|'Local'`), `navCollapsed`, `thresholds` (`{ stuckMinutes: 60, pendingMinutes: 10, queueDepth: 1000 }`), `savedViews: { name, url }[]`, `autoRefresh: { instances: number; instance: number }` (seconds, 0 = never).
2. Load from `PrefsStorage` with the precedence of contracts §8; `resolvedMode` getter applies `clientConfig.theme`, then `prefers-color-scheme` (through `mode-watcher`'s `systemPrefersMode`).
3. `apply()` sets `data-theme`, toggles `dark` (through `mode-watcher` `setMode`), sets `data-density` on `document.documentElement`. In VS Code, `mode === 'system'` means "Follow VS Code" and reads `clientConfig.theme`.
4. Every setter persists immediately.
Accept:
- [ ] Fresh storage + `clientConfig = { theme: 'dark', dfmTheme: 'blueprint' }` → `theme 'blueprint'`, `resolvedMode 'dark'`.
- [ ] Setting `theme` writes `dfm.theme` and updates `document.documentElement.dataset.theme`.
Test: `prefs.test.ts` in jsdom with a fake storage.

#### E0-S4-T2 App state and placeholder App.svelte
Files: `src/lib/state/app.svelte.ts`, `src/App.svelte`, `src/lib/state/app.test.ts`
Depends: E0-S2-T4, E0-S3-T1, E0-S4-T1
Do:
1. `AppState`: holds `host`, `client`, `endpoints`, `router`, `prefs`, `hub` (from the route), `about: About | null`, `aboutError`, `capabilities` (from `about`, all false until loaded), `readOnly`, `dangerous`, `userName`, `progress` counter (`begin()`/`end()`), `timeRange` (parsed from the current route's query; `setTimeRange(range)` writes the query on the current route), `autoRefresh` (global seconds, mirrors prefs per screen). `loadAbout()` calls `endpoints.about()` when a hub is known; sets `document.title` to `Durable Functions Monitor (${accountName}/${hubName}${readOnly ? ', ReadOnly' : ''}) v${version}` (React parity).
2. `App.svelte`: creates `AppState` once, `setContext('dfm', app)`, calls `prefs.apply()`, and for E0 renders a placeholder: the route name, hub, and the `about` JSON pretty-printed in a `<pre>` (formatted and expanded, contracts §9), plus five buttons that set the theme and one that toggles the mode (temporary, replaced in E2).
3. When the route is `login` in the browser, render "Login (E2)"; in VS Code never.
Accept:
- [ ] Opening `http://localhost:3000/DurableFunctionsHub` against a running host shows the about JSON.
- [ ] Theme buttons switch the page background between the five papers; mode toggle switches to the dark papers; reload keeps the choice.
Test: `app.test.ts` with a fake endpoints object: `loadAbout` sets `readOnly` and `document.title`.

### E0-S5 Smoke in both hosts

#### E0-S5-T1 Standalone host smoke
Files: `docs/plans/svelte-rewrite/notes/E0-smoke.md` (new, your findings)
Depends: E0-S1-T4, E0-S4-T2
Do:
1. Start Azurite (`npx azurite --silent --location .azurite` in the repo root). Create `durablefunctionsmonitor.dotnetisolated/local.settings.json` from contracts §15.
2. `npm run build-and-copy`, then `dotnet build durablefunctionsmonitor.dotnetisolated` and `func host start --port 7072` inside `durablefunctionsmonitor.dotnetisolated/bin/Debug/net10.0`.
3. Open `http://localhost:7072/durable-functions-monitor/DurableFunctionsHub` and `http://localhost:7072/durable-functions-monitor/DurableFunctionsHub/instances/some-id` (the hub tables may be empty; `/about` still answers). Confirm the CSS and JS load through the rewritten `/durable-functions-monitor/static/...` URLs (network tab) and the placeholder shows the about JSON.
4. Repeat with `DFM_INGRESS_ROUTE_PREFIX=proxy` set in `local.settings.json` and confirm the app still loads under `/proxy/...` rewritten links (verifies root-absolute asset URLs).
5. Write what you saw, including any workaround, in the notes file.
Accept:
- [ ] Both URLs render the placeholder with about data in the standalone host, with and without the ingress prefix.
Test: manual; automated in E3.

#### E0-S5-T2 VS Code webview smoke
Files: `docs/plans/svelte-rewrite/notes/E0-smoke.md` (append)
Depends: E0-S5-T1
Do:
1. Build the extension (`npm install && npm run compile` in `durablefunctionsmonitor-vscodeext`), run it with F5, set the setting `durableFunctionsMonitor.customPathToBackendBinaries` to the absolute path of `durablefunctionsmonitor.dotnetisolated/bin/Debug/net10.0` (it must contain `DfmStatics`).
2. Attach to the Azurite task hub. Confirm the placeholder renders inside the webview, `host.kind === 'vscode'` (the placeholder should print it), and that a theme change survives closing and reopening the panel (PersistState round trip).
3. Confirm `OrchestrationIdFromVsCode` opens the instance route: right-click a hub → "Go to instanceId…".
Accept:
- [ ] Webview renders, persists prefs, opens an instance route.
Test: manual (E12 repeats it as a release check).
