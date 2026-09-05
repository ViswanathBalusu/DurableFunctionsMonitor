# E2 · Shell, navigation and login

Goal: `DFM App.dc.html` and `ScreenLogin.dc.html` as working Svelte: side nav, top bar, bottom tab bar and More sheet, peek panel, command palette, keyboard map, toasts, loading bar, and the browser login flow. Screens plug into the outlet; until their epics land, the outlet shows a titled placeholder per route.

Prerequisites: E0, E1. Read contracts §3, §4, §7, §8, §13, §14; mockup `DFM App.dc.html` (whole file) and `ScreenLogin.dc.html`.

Exit criteria: the shell renders in both hosts with capability-gated nav, every top bar control works against the real backend, the palette and shortcuts work, Login lists hubs and signs in through MSAL when configured, and the Playwright smoke spec of E3 passes.

### E2-S1 Shell frame and side nav

#### E2-S1-T1 Shell layout and route outlet
Files: `src/App.svelte`, `src/lib/shell/Shell.svelte`, `src/lib/shell/Outlet.svelte`, `src/routes/*.svelte` (placeholders), tests
Depends: E1-S4-T1
Do:
1. `App.svelte`: create `AppState`, provide context, `prefs.apply()`, then render: `Login` when the route is `login` (browser only); otherwise `Shell` (or `routes/Functions.svelte` alone when `host.viewMode === 1`).
2. `Shell.svelte`: `<div class="shell {collapsed ? 'collapsed' : ''}"><SideNav/><div class="main"><TopBar/>{#if app.progress > 0}<ProgressBar inline/>{/if}<main class="content" id="main"><Outlet/></main></div><BottomNav/></div>` plus `MoreSheet`, `PeekPanel`, `CommandPalette`, `ToastHost` mounted once (App L25–L134).
3. `Outlet.svelte`: switch on `app.router.current.name` rendering the screen components; placeholders are `Page` + `PageTitle` with the screen name until each epic replaces them. On `redirectTo` routes call `router.navigate(..., { replace: true })` in an effect.
4. `window.scrollTo(0, 0)` on route change (App L287).
Accept:
- [ ] Grid columns are 240 px / 64 px when collapsed (class toggles), main scrolls, content has 24 px padding (CSS).
- [ ] Route change renders the matching placeholder.
Test: component test renders `Shell` with a fake app state and checks the outlet switches.

#### E2-S1-T2 SideNav
Files: `src/lib/shell/SideNav.svelte`, `src/lib/shell/nav-items.ts`, tests
Depends: E2-S1-T1, E1-S7-T1
Do:
1. `nav-items.ts`: ordered list `overview, instances, failures, entities, functions, storage, activity` + `settings` at the bottom, each `{ id, label, icon, route, visible(capabilities, host) }`: overview always; instances always; failures `capabilities.failures`; entities always; functions `capabilities.stats || host.functionGraphAvailable`; storage `capabilities.storageHealth`; activity `capabilities.audit`; settings always. Hidden, never disabled (design §3).
2. Markup App L26–L38: `<nav class="snav" aria-label="Main">` brand (logo square + `DFM` label), items as `<button class="item active?">` with `NavIcon`, `<span class="lbl">`, Failures carries `<span class="cnt chip st-failed sm">{count}</span>` when `app.failuresCount > 0` (E9 fills it), `<div class="gap">`, Settings, then the collapse toggle (`title` "Collapse"/"Expand", glyph polylines `15 6 9 12 15 18` / `9 6 15 12 9 18`).
3. Active item: `instances` is active for both `instances` and `instance` routes (App L374).
4. Collapse persists `prefs.navCollapsed`; in VS Code the default is collapsed (contracts §3).
Accept:
- [ ] With `capabilities.audit=false` the Activity item is absent from the DOM.
- [ ] Collapse toggle flips the shell class and persists.
Test: as above.

### E2-S2 Top bar

#### E2-S2-T1 TopBar frame, hub switcher, badges
Files: `src/lib/shell/TopBar.svelte`, `src/lib/shell/HubSwitcher.svelte`, `src/lib/state/hubs.svelte.ts`, tests
Depends: E2-S1-T1, E1-S4-T3
Do:
1. TopBar markup App L40–L95 in order: logo, `display` product name (`hide-m`), muted slash, `HubSwitcher`, `InstanceJump` (E2-S2-T2), Read only chip (`chip sm` with muted background, title "/about does not list DurableFunctionsMonitor.ReadWrite") when `app.readOnly`, `DangerBadge sm hide-m` when `app.dangerous`, `grow hide-m`, auto-refresh `Select` (`Never`, `Every 1 sec.`, `Every 5 sec.`, `Every 10 sec.`; bound to `app.autoRefresh` which the current screen's loader consumes), UTC/Local `Segmented` (bound to `prefs.showTimeAs`, `title` = `timeZoneLabel()`), `ThemeMenu` (E2-S2-T3), palette button (`btn flat hide-m` with `<span class="fine">Ctrl K</span>`), `UserMenu` (E2-S2-T4).
2. `hubs.svelte.ts`: loads `task-hub-names` once per session (browser; in VS Code the list is the single attached hub) and caches; `current` from the route.
3. `HubSwitcher`: `Pop kind="menu"` with the trigger `<button class="btn flat" style="font-family:var(--font-mono);font-weight:600;gap:10px;padding:0 10px">{hub} <span class="meta hide-m sans">{accountName}</span> <span class="tri down"></span></button>`; content: `<div class="meta">Task hubs in {accountName}</div>`, one `MenuItem` per hub (`role="menuitemradio"`, mono name, trailing meta "current" for the active hub; no instance counts, the backend does not provide them), separator, "Switch account or connection…" → `router.navigate({ name: 'login' })` (browser) / hidden in VS Code. Picking a hub navigates to that hub's Overview and reloads `/about`.
Accept:
- [ ] Badges render according to `about` (test with readOnly true/false, dangerous true/false).
- [ ] Picking a hub changes the route hub segment and triggers `loadAbout`.
Test: as above.

#### E2-S2-T2 Instance jump
Files: `src/lib/shell/InstanceJump.svelte`, `src/lib/state/suggestions.svelte.ts`, tests
Depends: E1-S3-T4
Do:
1. `Combobox` with placeholder `Find instance   /`, `aria-label="Find instance"`, `mono`, wrapper `anchor grow` with `max-width:340px;min-width:140px` (App L57–L67).
2. `suggestions.svelte.ts`: debounce 150 ms, calls `idSuggestions(prefix)` when the query is at least 2 characters (React `reloadSuggestions`), keeps only the latest response (requestId), max 6 shown.
3. Enter opens the first suggestion, or the typed id when there is none; selecting an option opens it; both clear the input. Open = `router.navigate({ name: 'instance', hub, instanceId })`; with Ctrl/⌘ held, `client.host.openInNewWindow(id)`.
4. `/` shortcut focuses it (E2-S5-T1 wires it through an exported `focus()`).
Accept:
- [ ] Typing `ord` calls the endpoint once after the debounce; suggestions render as `.mi.mono` options.
- [ ] Enter with no suggestions navigates to the typed id.
Test: as above with fake timers.

#### E2-S2-T3 Theme menu
Files: `src/lib/shell/ThemeMenu.svelte`, `src/lib/themes.ts`, tests
Depends: E1-S4-T3, E0-S4-T1
Do:
1. `themes.ts`: the five entries from App L232–L238 (`key, label, idea, paper, ink, primary`) plus `dark` paper from Settings L124–L128 and `metrics` strings.
2. Trigger `<button class="btn"><span class="swq" style="background:var(--primary)"></span>{label} · {Light|Dark}</button>` (`hide-m` wrapper). Content (App L76–L85): meta "Theme · data-theme", five `ttile` radios (`active` for the current; three swatches paper/ink/primary; label; trailing muted idea), separator, meta "Mode · .dark", `Switch` "Dark mode" (in VS Code a third option "Follow VS Code" as a `MenuItem` radio group: Follow VS Code / Light / Dark), `Switch` "Comfortable density".
3. Everything writes `prefs` and applies immediately (instant, no transition; design §6).
Accept:
- [ ] Choosing Riso sets `data-theme="riso"` on `<html>` and `prefs.theme`.
- [ ] Dark switch toggles the `dark` class.
Test: as above.

#### E2-S2-T4 User menu
Files: `src/lib/shell/UserMenu.svelte`, tests
Depends: E1-S4-T3
Do:
1. Trigger `<button class="btn flat" style="padding:0 8px"><span class="avatar">{initial}</span><span class="hide-m">{shortName}</span></button>`; `initial` = first letter of the user name (or `a` for anonymous), `shortName` = part before `@`.
2. Content (App L92): meta `{email} · {ReadWrite|Read only}{ · DangerousOperations}`, `Settings`, `Command palette` (`show-m`), separator, `Sign out` (browser: `login.signOut()`; VS Code: hidden).
Accept:
- [ ] Anonymous (no user name) shows `anonymous` and no Sign out when `login.isAnonymous`.
Test: as above.

### E2-S3 Bottom navigation (≤ 768 px)

#### E2-S3-T1 BottomNav and MoreSheet
Files: `src/lib/shell/BottomNav.svelte`, `src/lib/shell/MoreSheet.svelte`, tests
Depends: E2-S1-T2
Do:
1. `BottomNav` App L127–L133: five buttons Overview, Instances, Failures (with `<span class="bcnt">` count), Entities, More (`active` when the sheet is open or the route is one of functions/storage/activity/settings). Items hidden by capability are skipped; if Failures is hidden, Functions takes its slot; the CSS only shows this nav under 768 px.
2. `MoreSheet` App L135–L148: `Sheet` (bottom) restyled as `.overlay > .sheet[role=menu]`: meta "More", items Functions, Storage, Activity, Settings (trailing meta "theme, mode, density"), separator, Command palette, "Switch hub or sign out" (browser). Closes on selection, overlay click, Escape.
Accept:
- [ ] Sheet items respect capability visibility.
Test: as above.

### E2-S4 Peek panel

#### E2-S4-T1 peek.svelte.ts and PeekPanel
Files: `src/lib/state/peek.svelte.ts`, `src/lib/shell/PeekPanel.svelte`, `src/lib/shell/PeekTimeline.svelte`, tests
Depends: E1-S1-T2, E1-S6-T2, E1-S8-T4
Do:
1. `PeekItem = { id, name, kind: EntityType, status, created, updated, duration, customStatus?, state?, history?: string }`; `peek.open(item)`, `peek.close()`. Opening from any table keeps the table's scroll and selection (the panel is an overlay outside the table).
2. `PeekPanel` App L149–L197 as a right `Sheet` restyled to `.overlay.clear > aside.peek`: `phead` (`tile st-*` 72 px with the status text, mono 20 id with `overflow-wrap:anywhere`, meta `{name} · {kind}`, `Open` primary → instance route, `×` ghost), `pbody`: Summary `Kv` (created, last updated, duration, customStatus (preview or `none`), history (`31 rows · 18.2 KB` from spans when E8 provides it, else `—`)), then for orchestrations a `Timeline` section (`PeekTimeline`: until E8, one lane with the instance bar created→updated; E8 swaps in the first four span lanes) and an actions row (`Suspend`/`Resume`, `Raise event`, `Terminate` destructive, all disabled in read-only; each opens the same confirm dialogs E5 provides through `app.actions`), for entities a `State` section (`JsonPre` of the entity state, formatted and expanded, under a `.jse-bar` header) and actions `Send signal`, `Purge`; footer meta "Esc or click outside to close. The list keeps its scroll position and selection."
3. Escape and outside click close; focus returns to the row that opened it.
Accept:
- [ ] Opening a peek does not reset the Instances selection (test with the selection store).
- [ ] Entity peek shows the state pretty-printed.
Test: as above.

### E2-S5 Command palette and keyboard

#### E2-S5-T1 Keyboard map
Files: `src/lib/shell/shortcuts.ts`, tests
Depends: E2-S1-T1
Do:
1. One `keydown` listener on `window` implementing contracts §13 exactly (App L289–L302): Ctrl/⌘+K toggles the palette; Escape closes, innermost first: palette → dialog (bits-ui handles its own) → peek → menus; `/` focuses the instance jump; `g` then `o|i|f|e|s` within 900 ms navigates; ignored while typing (INPUT/TEXTAREA/SELECT/contenteditable), while the palette is open, and on the login route.
2. Exposes `installShortcuts(app, { focusJump, togglePalette })` returning a disposer; installed by `Shell`.
Accept:
- [ ] Unit test drives synthetic events for each chord and asserts the callbacks.
Test: as above.

#### E2-S5-T2 palette.svelte.ts and CommandPalette
Files: `src/lib/state/palette.svelte.ts`, `src/lib/shell/CommandPalette.svelte`, tests
Depends: E1-S1-T2, E2-S5-T1
Do:
1. Groups exactly as App L318–L338, computed from live state: Go to (Overview `g o`, Instances `g i`, Failures `g f`, Entities `g e`, Functions, Storage, Activity, Settings `g s`, respecting capability visibility; plus up to six "Instance {id}" entries from `suggestions` when the query has 2+ characters, and "Instance {id} (failed)" opens the Inputs tab when the suggestion is known failed (only when the Failures state has it; otherwise plain)), Actions (Start new instance → instances with `start=1`; Refresh → `app.refresh()` which the current screen subscribes to; Suspend/Resume current instance (only on the instance route; opens the confirm); Purge instance history… → settings; Switch task hub → opens the hub menu), Preferences (Switch to light/dark mode; Theme: X ×5 with `current` kbd; Density: compact/comfortable; Time range: five presets with `current`; Show time as local/UTC).
2. Filter: case-insensitive substring on the label; empty result shows "Nothing matches. Try a screen, a theme name or an instance id." (App L209).
3. Markup App L198–L214 through the restyled Command: `.overlay.pal > .palette[role=dialog]`, input with the placeholder "Type a command, a screen or an instance id", `.plist` groups, `.prow.sel` for the highlighted row with `.kbd`, footer `.pfoot.fine.muted` "Up and down to move · Enter to run · Esc to close · Ctrl K opens this anywhere".
Accept:
- [ ] Typing `riso` leaves one Preferences row; Enter applies the theme and closes.
- [ ] Arrow keys move `.sel`; mouse hover moves it too (App L345).
Test: as above.

### E2-S6 Toasts, progress, host commands

#### E2-S6-T1 ToastHost and toast API
Files: `src/lib/shell/ToastHost.svelte`, `src/lib/state/toast.svelte.ts`, tests
Depends: E1-S4-T4
Do:
1. `toast.ok(message)` auto-dismisses after 5 s; `toast.error(message, { retry?: () => void })` stays until dismissed; only one toast is visible at a time (the newest replaces, App L303–L308); `toast.fromError(prefix, err, retry?)` formats `${prefix}. ${err.message}`.
2. `ToastHost` renders the current toast with the E1 `Toast` component through `svelte-sonner`'s custom component API (position bottom-right; the CSS already positions `.toast` fixed, so disable sonner's own positioning) or, if that fights the stylesheet, a plain conditional render (acceptable; note it in the file).
Accept:
- [ ] `toast.ok` disappears after 5 s (fake timers); `toast.error` persists and shows Retry when given.
Test: as above.

#### E2-S6-T2 Progress and refresh plumbing
Files: `src/lib/state/app.svelte.ts` (extend), tests
Depends: E0-S4-T2
Do:
1. `app.track(promise)` increments `progress` while pending; screens wrap their loads with it so the stripe bar under the top bar shows during any request.
2. `app.onRefresh(cb)` registration (a `Set`, cleared on route change); `app.refresh()` calls them (top bar Refresh, palette Refresh, VS Code).
3. `app.autoRefresh` (seconds) persisted per screen kind (`prefs.autoRefresh.instances` for list screens, `.instance` for the workspace); screens read it in their timers.
Accept:
- [ ] `track` shows the bar during a pending promise and hides after both resolve and reject.
Test: as above.

#### E2-S6-T3 VS Code custom commands
Files: `src/lib/shell/vscode-commands.ts`, tests
Depends: E0-S2-T3, E2-S1-T1
Do:
1. In VS Code, register the bridge handlers once the shell is mounted: `purgeHistory` → navigate to Settings with `?dialog=purge` (E6 opens it); `cleanEntityStorage` → Settings `?dialog=clean`; `startNewInstance` → Instances `?start=1`; `batchOps` → Instances with `?selectAll=1` (E4 selects every loaded row so the bulk bar shows). Then `IAmReady`.
2. `OrchestrationIdFromVsCode` handled by the router (E0-S3-T1).
Accept:
- [ ] Dispatching a fake `batchOps` message navigates to Instances with `selectAll=1`.
Test: as above.

### E2-S7 Login and hub picker (browser)

#### E2-S7-T1 login.svelte.ts with MSAL
Files: `src/lib/state/login.svelte.ts`, `src/lib/api/auth.ts`, tests
Depends: E0-S2-T4
Do:
1. Port `LoginState` from React with `@azure/msal-browser` 5: `login()` calls `easyAuthConfig()`; without `clientId` → anonymous or server-directed (`userName` from the response), done. With `clientId`: `new PublicClientApplication({ auth: { clientId, authority, redirectUri: rootUri } })`, `await initialize()`, `handleRedirectPromise()`; no account → `loginRedirect()` and stop; account → `userName = account.username`.
2. `getAuthHeaders()`: xsrf cookie header always; when MSAL is active, `acquireTokenSilent({ scopes: [clientId] })` → `Authorization: Bearer`; on failure `acquireTokenRedirect`.
3. `rootUri` and `locationPathName` ports (React `LoginState.rootUri`, `locationPathName`), replacing `OrchestrationsPathPrefix` logic with the router's parser (the hub is the first segment after the prefix).
4. `loadHubs()`: `taskHubNames()`; exactly one hub → navigate to it (React parity); else expose `hubs` for the picker. For each hub (max 20, parallel) call `/about` to get the badge (`ReadWrite` / `Read only`) and the version; failures show no badge.
5. `signOut()`: MSAL `logoutRedirect()` when active, else `window.location.replace('/.auth/login/aad?post_login_redirect_url=%2F')` (React parity).
Accept:
- [ ] Config without clientId → `isAnonymous` true when no `userName`.
- [ ] One hub → router navigates to its Overview without rendering the picker.
Test: unit tests with a mocked `@azure/msal-browser` module.

#### E2-S7-T2 Login screen
Files: `src/routes/Login.svelte`, `src/lib/login/HubRow.svelte`, tests
Depends: E2-S7-T1, E1-S4-T1
Do:
1. Markup `ScreenLogin.dc.html` L15–L60 without the connection-string card (README D11): `section.login` centered column 560 px: logo 56 px with shadow + `display` 32 title + meta `{version} · {location.host}` (version from the first successful `/about`, else hidden); Sign in card when MSAL is configured and no account (title "Sign in", copy "This deployment uses Easy Auth. Sign in with your work account to list the task hubs you can see.", primary "Sign in with Microsoft"); Task hubs card (header "Task hubs" + meta "signed in as {user}" + `chip sm` with the account name from about, `HubRow` per hub: `swq` primary square, mono 15/600 name, meta grow (empty), badge chip `ReadWrite`/`Read only` (`st-terminated` for read only), `tri`; footer meta "Hubs come from GET ../task-hub-names for this storage account." + ghost "Sign out"); bottom meta line L58.
2. Clicking a hub navigates to its Overview.
Accept:
- [ ] Three hubs render three rows; clicking the second navigates to `/{hub2}`.
Test: as above.
