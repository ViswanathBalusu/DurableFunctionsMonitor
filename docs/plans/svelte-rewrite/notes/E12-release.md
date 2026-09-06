# E12 · release notes and manual checks

What was checked by hand, and what a machine checked for us. One section per task; a line that says
**pending** is a check nobody has run yet, not one that failed.

## E12-S3-T1 · Self-hosted fonts (2026-09-05)

`@fontsource-variable/archivo@5.3.0` and `@fontsource-variable/jetbrains-mono@5.3.0`, imported from
`src/app.css` (`wdth.css` for Archivo, because the display and condensed utilities set the `wdth`
axis themselves; `index.css` for JetBrains Mono, which has only `wght`). The Google Fonts links are
gone from `index.html`.

Nothing in the frozen stylesheets had to change: `--font-sans` and `--font-mono` already name
`"Archivo Variable"` and `"JetBrains Mono Variable"` as their second family (dfm-tokens.css
L934-L935), which is exactly what fontsource calls the variable faces.

- **Build** — eight `.woff2` in `static/media/`, `name.<hex>.woff2`, 295 kB in total (Archivo latin,
  latin-ext and vietnamese; JetBrains Mono latin, latin-ext, cyrillic, cyrillic-ext, greek,
  vietnamese). The CSS references them as `../media/…`, which is what the VS Code webview needs.
- **Verify script** — two new rules: `index.html` may not link to another host at all (it used to be
  allowed to, for the font host), and every `url()` in the CSS must resolve to a file that is in the
  build. It also asserts that at least one woff2 is there, so a future build that quietly loses the
  fonts fails instead of falling back.
- **Browser host** — checked against the standalone host on the built statics: no request leaves the
  origin (`performance.getEntriesByType('resource')` has nothing off-origin), `Archivo Variable` and
  `JetBrains Mono Variable` load from `/static/media/`, and the machine's own Archivo - which this
  box happens to have installed - is what `--font-sans` picks first, as the token file intends.
- **VS Code webview** — **pending**: it needs an interactive extension host (the same thing that
  blocks E0-S5-T2). What can be said without one: the webview only rewrites `href`/`src` in
  `index.html`, and the fonts are reached from the CSS by relative url, so they resolve next to the
  stylesheet's own `vscode-webview-resource:` URI. The build contract now enforces exactly that.

## E12-S4-T1 · VS Code extension check and docs (2026-09-05)

### The defect this check found, and the fix

**The webview never asked `/about`.** `AppState` builds the memory-mode `Router` without a hub
(`src/lib/state/app.svelte.ts:100-104`), `RouterOptions.hub` defaulted to `''`, and `loadAbout()`
returns immediately when there is no hub (`app.svelte.ts:291-293`). So in VS Code — and only there —
`about` stayed `null`, which means every capability false and `readOnly` true: no write buttons, no
Failures/Storage/Activity in the nav, an empty hub name in the top bar, and a route persisted as `/`
or `//instances/{id}`, which parses back as the login screen the webview cannot show. This is the
same gap that left E0-S5-T2 blocked.

The hub could not come from the URL, because a webview has none. It now comes from the host, through
the tag that already carries host-chosen defaults:

- `MonitorView.embedThemeAndSettings` writes `DfmClientConfig={"theme":…,"showTimeAs":…,"hubName":…}`
  (the value is `hubNameWithoutSchema`, the same string it prepends to every API call, and `<` is
  escaped so a hub name cannot close the script tag).
- `ClientConfig.hubName` is declared in `host.svelte.ts`, and the memory-mode `Router` defaults its
  hub to it - the same way it already defaults the instance id to `host.orchestrationIdFromVsCode`.
- Restoring a persisted route now keeps the *screen* and takes the hub from the host, so state
  written by a build without the hub (`/`, or another hub's path) opens the right hub instead of the
  login route.

Covered by `src/lib/router.test.ts` (three cases: hub from the injected config, restore under this
hub, and the unchanged no-config behaviour) and by the assertion in
`src/test/suite/MonitorView.test.ts`. `npx vitest run` 1633 passed, `npm run check` 0 errors,
`npm run lint` clean, `tsc -p ./` on the extension clean.

### Verified in code (both sides), no human needed

| Check | Where it is settled |
|---|---|
| Statics load from the packaged backend's `DfmStatics` | `MonitorView.ts:32-34,174,178-188`; `localResourceRoots` covers `static/media`, so the fonts are inside it |
| The link rewriter matches what the build emits | `MonitorView.ts:124-140` against `build/index.html` - both links root-absolute, lowercase hex, one JS and one CSS bundle; `verify-build-contract.mjs` passes |
| Fonts resolve in the webview | the CSS references `../media/*.woff2` relatively, from `DfmStatics/static/css/`, and the contract check enforces that every `url()` resolves inside the build |
| Shell opens collapsed | not a tag: `prefs.svelte.ts:230-232` defaults `navCollapsed` to `host.kind === 'vscode'`, and a stored choice wins |
| `PersistState` round trip | UI posts `{ method:'PersistState', key, data }` (`vscode-typed-local-storage.ts:57-61`), the extension stores the bag under `durableFunctionsMonitorWebViewState` (`MonitorView.ts:221-229,157`) and injects it back as `StateFromVsCode` (`:182,415-420`); keys used are `prefs`, `view.route`, `view.{screen}` |
| `OrchestrationIdFromVsCode` deep link | `MonitorView.ts:111-121,415-420` → `host.svelte.ts:62` → `router.svelte.ts` starts on the instance route |
| `DfmViewMode=1`, Save as JSON, GotoFunctionCode | `FunctionGraphView.ts:82-92,123-144,146-173`; UI at `App.svelte:57,67-68`, `functions.svelte.ts:68-71`, `routes/Functions.svelte:101-113,172-177` |
| `Custom Path to Backend Binaries` | `Settings.ts:14` → `BackendProcess.ts:377-382` → `MonitorView.ts:32-34`. Note it is read *before* the custom-backend selection, so a custom path also opts out of the bundled MSSQL/Netherite backends |
| Custom backends start, and the UI gates on capabilities only | `BackendProcess.ts:126-148,396-403`; `nav-items.ts:27,37,39,40` - no provider name anywhere in `src/` |

Two things worth knowing that the check turned up and nothing was done about:

- `GotoBinding` is still handled by the extension (`MonitorView.ts:279-291`) and declared on the
  client, but no Svelte code calls it. The React graph node had an entry point; this one does not.
- `SaveAs`, `SaveFunctionGraphAsJson`, `GotoFunctionCode`, `GotoBinding` and `OpenInNewWindow` get no
  reply from the extension, so their promises never settle. Every call site voids them, so nothing
  hangs, but the request map keeps an entry per call.

### Still needs a human at an extension host

`durablefunctionsmonitor-vscodeext/backend/DfmStatics` and the two `custom-backends/*/DfmStatics`
folders are gitignored build output, and on this box they still hold the **React** bundle. The VSIX
that CI builds is fine (`build.yml:213-221` refreshes them), but F5 on a working tree that has not
been refreshed loads the old app. So step 1 is not optional:

1. `npm run build-and-copy` in `durablefunctionsmonitor.svelte`, then
   `dotnet publish durablefunctionsmonitor.dotnetisolated -o durablefunctionsmonitor-vscodeext/backend`;
   confirm `backend/DfmStatics/index.html` names the same `main.<hex>.js` as `build/static/js/`.
2. F5, attach to an Azurite task hub: the Svelte shell, side nav collapsed, no blank page.
3. Webview developer tools: the JS and CSS bundles and all eight `static/media/*.woff2` return 200
   with no CSP or CORS error; headings in Archivo, ids in JetBrains Mono.
4. The hub name shows in the top bar and `/about` is requested — this is the fix above, and the one
   check that E0-S5-T2 also needs.
5. Pick a theme and dark mode, close and reopen the panel: both survive (`StateFromVsCode.prefs`).
6. Navigate to Instances, close and reopen: it comes back on Instances, under the same hub.
7. "Go to instanceId…" with a seeded id: a second panel opens on that instance's workspace.
8. "Visualize Functions as a Graph…" on a `host.json`: graph only, no shell; a node's code link jumps
   to the source; Save as SVG and Save as JSON both offer a file.
9. Attach to MSSQL and then to Netherite: Failures and Storage are absent for both, the Functions
   table half is absent for Netherite, Activity is absent unless the environment sets
   `DFM_AUDIT_ENABLED` (the extension sets neither that nor `DFM_DANGEROUS_OPERATIONS_ENABLED`).
10. Set `durableFunctionsMonitor.customPathToBackendBinaries` to a published folder and reopen: the
    statics come from there.
11. Re-enable `npm run test` in the extension: CI has it behind `if: 'false'` (`build.yml:229-233`),
    which is why the `DfmClientConfig` assertion in `MonitorView.test.ts` could drift unnoticed.

### The documentation

`docs/ui.md` is new: the screens with a screenshot each, the keyboard map, themes and the small
screen, the capability matrix per provider, every environment variable and preference key, and the
build contract for contributors. The root `README.md` gained a feature tour over the same
screenshots, and `durablefunctionsmonitor-vscodeext` gained a "The monitoring UI" section and a
`6.9.0` changelog entry describing the new UI.

Every checkable claim in both documents was read back against the code before it was written down,
and the drift that found is fixed in this task: there is no built-in "Everything" tab (the tab in the
screenshots is a custom Liquid tab the seeded hub publishes; the built-in extra tab is Summary), the
bulk bar has six actions and not eight, `update-input-and-rewind` is an ordinary write rather than a
dangerous operation, `/children` is not cached, `DFM_STATS_CAP` defaults to 50000, the local-storage
keys are `dfm.*` and not the `DFM_CLIENT_CONFIG` names, and a capability the backend lacks hides a
*screen* but only ever disables a *button*.

The screenshots under `readme/screenshots` are the Svelte UI against the seeded Azurite hub; the
React-era ones were deleted. Four of them are still referenced by old entries of the extension's
changelog, which points at `raw.githubusercontent.com/microsoft/…`, so those keep rendering from
upstream.
