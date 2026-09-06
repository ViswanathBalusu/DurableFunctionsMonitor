# E12 · CI, Docker, cleanup and polish

Goal: the Svelte app is the only UI: Docker images and the VS Code extension ship it, the React project is deleted, fonts are self-hosted, and the accessibility, reduced-motion and theme passes are done.

Prerequisites: E0–E11 and B0–B5 merged. Read contracts §2, §15.

Exit criteria: `main-build`, `push-to-ghcr` (was `push-to-docker-hub`, see E12-S1-T2) and `push-to-vscode-marketplace` workflows succeed on the Svelte build; `durablefunctionsmonitor.react/` no longer exists; the release checklist in E12-S4 is green.

### E12-S1 Docker and CI

#### E12-S1-T1 Node stage in the three Dockerfiles
Files: `durablefunctionsmonitor.dotnetisolated/Dockerfile`, `custom-backends/dotnetIsolated-mssql/Dockerfile`, `custom-backends/dotnetIsolated-netherite/Dockerfile`
Depends: E3-S3-T1
Do:
1. Add a first stage `FROM node:22-alpine AS ui` that copies `durablefunctionsmonitor.svelte/` (package files first for layer caching, then the rest), runs `npm ci` and `npm run build`, then in the SDK stage `COPY --from=ui /src/durablefunctionsmonitor.svelte/build /src/durablefunctionsmonitor.dotnetisolated/DfmStatics` before `dotnet publish`. Keep the repo-root build context note.
2. `.dockerignore`: add `durablefunctionsmonitor.svelte/node_modules`, `durablefunctionsmonitor.svelte/build`, `**/DfmStatics`.
Accept:
- [ ] `docker build -f durablefunctionsmonitor.dotnetisolated/Dockerfile .` produces an image whose `/home/site/wwwroot/DfmStatics/index.html` contains the Svelte bundle reference.
Test: the docker build (CI `push-to-docker-hub` dry run through `docker/build-push-action` with `push: false` on PRs is optional; at minimum build once locally and note it in the PR).

**Done, E12-S1-T1 (2026-09-05).** All three images built locally on Docker 29.7.2, and all three serve
the same bundle pair out of `/home/site/wwwroot/DfmStatics` (`main.58690934.js`, `main.3c26323f.css`).
`node:22-alpine` builds the UI without trouble - the native packages of Vite and Tailwind all have
musl builds in the lockfile. `.dockerignore` also drops `test-results` and `playwright-report`, which
are the other two things a working tree accumulates and no image needs.

#### E12-S1-T2 Workflows final pass
Files: `.github/workflows/build.yml`, `push-to-docker-hub.yml`, `push-to-vscode-marketplace.yml`, `.github/workflows/playwright.yml` (delete the React one under `durablefunctionsmonitor.react/.github`)
Depends: E12-S2-T1
Do:
1. Remove every remaining reference to `durablefunctionsmonitor.react`; ensure `setup-node` caches on the Svelte lockfile; the VSIX packaging copies `backend/DfmStatics` from the published output (unchanged path).
2. Add a `concurrency` guard for the e2e job and upload traces on failure.
Accept:
- [ ] `grep -r "durablefunctionsmonitor.react" .github` returns nothing.
Test: workflow run.

**Deviation, E12-S1-T2 (2026-09-05).** **The images publish to GHCR, not to Docker Hub** - asked for
by the user during this task, because `ghcr.io` authenticates with the `GITHUB_TOKEN` a workflow
already has, while Docker Hub needed `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` to be created and
stored first. `push-to-docker-hub.yml` is replaced by `push-to-ghcr.yml`: `packages: write`, a
`docker/login-action` against `ghcr.io`, and image names under
`ghcr.io/<owner in lower case>/durablefunctionsmonitor[.mssql|.netherite]`. That workflow no longer
builds the UI either - since E12-S1-T1 each image builds its own - so what it does around the three
image builds is run the .NET and Azurite tests. The README's Docker Hub pulls badge is left alone: it
counts pulls of the images already published there, which this change does not remove.

The rest of point 1 was already true: no `.github` file mentioned the React project, `setup-node`
already cached on the Svelte lockfile, and the VSIX still takes `backend/DfmStatics` from the
published output. The React project's own `playwright.yml` went with the folder in E12-S2-T1.

Point 2 landed on `build.yml`'s one job (it is where the e2e run lives): a `concurrency` group per
caller workflow and ref, cancelling in progress only for pull requests, and a `playwright-traces`
artifact uploaded on failure - `trace: 'on-first-retry'` writes them under `test-results/`.

**Not verified here:** no workflow was actually run. The YAML parses and every path it names exists,
but "Test: workflow run" needs a push to GitHub.

### E12-S2 Remove the React project

#### E12-S2-T1 Delete durablefunctionsmonitor.react
Files: `durablefunctionsmonitor.react/` (delete), `README.md`, `durablefunctionsmonitor.dotnetisolated.core/README.md`, `durablefunctionsmonitor.dotnetisolated/README.md`, `custom-backends/README.md`, `.gitignore`
Depends: E11 complete
Do:
1. `git rm -r durablefunctionsmonitor.react`. Update every README sentence that names it ("client UI implementation. A React app…" → the Svelte app), the repo-root `package-lock.json` stub if it only existed for the React project, and the `.gitignore` comments.
2. Keep `docs/ui-plans-artifacts/` (design source) and add a line in `docs/plans/svelte-rewrite/README.md` marking the plan as executed.
Accept:
- [ ] `dotnet build DurableFunctionsMonitor.slnx` and the workflows are green without the folder.
Test: build.

**Deviation, E12-S2-T1 (2026-09-05).** Three things the plan's file list does not name but the delete
made necessary.

(1) **`azure-pipelines.yml` built the React UI.** It now installs Node 22, runs `npm ci` and
`npm run build` in `durablefunctionsmonitor.svelte`, checks the build contract and copies that output
into `DfmStatics` (without `service-worker.js`, which the Svelte build does not emit).

(2) **The committed `DfmStatics` was the React build.** With the React source gone it would have
served a UI nobody can rebuild, so it is now the Svelte build - produced by `npm run build-and-copy`
as the frozen-path rule requires. It is smaller than what it replaces (1.9 MB bundle and a 9.2 MB map
against 4.7 MB and 17 MB), and the eight self-hosted woff2 of E12-S3-T1 come with it.

(3) **The frozen-path guard and CLAUDE.md** named the React folder; a guard for a path that cannot
exist is noise, so both lost that entry, as did the task-runner skill.

`.gitignore` needed nothing: its comments are about the in-process backends, not about React. The
repo-root `package-lock.json` is an empty stub (`"packages": {}`) that names the solution, not the
React project, so it stays.

### E12-S3 Fonts, accessibility, motion, themes

#### E12-S3-T1 Self-hosted fonts
Files: `src/app.css`, `index.html`, `package.json`, `durablefunctionsmonitor.dotnetisolated.core/Functions/ServeStatics.cs` (B0-S4 already added `static/media`)
Depends: B0-S4-T1
Do:
1. Add `@fontsource-variable/archivo` and `@fontsource-variable/jetbrains-mono`; import `@fontsource-variable/archivo/wdth.css` (the `wdth`+`wght` axes file) and `@fontsource-variable/jetbrains-mono/index.css` in `app.css`; remove the Google Fonts links from `index.html`.
2. Confirm the emitted CSS references fonts as relative `url(../media/…woff2)` (`renderBuiltUrl`, contracts §2) and that the files land in `static/media/` with lowercase hex names; the verify script gains a check that every `url(` in the CSS is relative.
3. Check in both hosts (VS Code webview must show Archivo, not the fallback).
Accept:
- [ ] No request to `fonts.googleapis.com` in the network tab; fonts render in the webview.
Test: verify script + manual webview check noted in `notes/E12-release.md`.

**Deviation, E12-S3-T1 (2026-09-05).** The verify script already had the "CSS urls are relative"
rule; what it gained instead is stricter: `index.html` may no longer link to *any* external host (the
font host was its one exemption), every `url()` in the CSS must resolve to a file that is in the
build, and at least one woff2 must be in `static/media` - so a build that quietly loses the fonts
fails rather than falling back to a system face. The webview half of the acceptance is **pending**
for want of an interactive extension host; see `notes/E12-release.md` for what holds without one.

#### E12-S3-T2 Accessibility and keyboard pass
Files: touched components, `tests/e2e/a11y.spec.ts`
Depends: E11
Do:
1. Run `@axe-core/playwright` on every screen in both modes of the Poster theme; fix every serious/critical violation (labels on icon-only buttons such as `×`, `aria-expanded` on menu triggers, `role="status"` on toasts and banners, table headers with `scope`, dialog titles wired with `aria-labelledby`).
2. Keyboard: every screen operable without a mouse: tables (Tab to the row's first link; Enter opens the peek), chips (`×` focusable), palette, menus, dialogs (focus trap, Escape), the swimlane (bars focusable with `tabindex` and `aria-label`), the graph (Svelte Flow keyboard navigation on).
3. `prefers-reduced-motion`: the stylesheet already zeroes transitions; make sure the stripe progress animation and the bulk bar slide respect it (they do via the global rule) and that D3 brush/zoom have no scripted animation.
Accept:
- [ ] `a11y.spec.ts` reports zero serious/critical violations across screens.
Test: itself.

**Done, E12-S3-T2 (2026-09-05).** axe (wcag2a/2aa/21a/21aa) over eight screens plus the workspace, in
both modes of the Poster theme, and over the three overlays - peek, confirm dialog, palette. Six real
violations, all fixed:

1. **`aria-valid-attr-value`** (critical): the Instances view strip's tabs pointed
   `aria-controls` at `panel-table`, which nothing rendered. The three views now sit in a
   `role="tabpanel"` named after the tab that controls it, the way the workspace's tabs already did.
2. **`aria-required-children`** (critical): `.tabs` was the `role="tablist"` *and* the row that holds
   the screen's own controls, and a tablist may own nothing but tabs. The tabs moved into an inner
   `role="tablist"` with `display: contents` (dfm-ext.css), so the strip looks exactly as it did.
3. **`aria-required-attr`** (critical): the palette's input is a `combobox` and bits-ui does not give
   it `aria-controls`; the list carries an id of ours now and the input names it.
4. **`scrollable-region-focusable`** (serious): the two Storage tables and the swimlane scroll
   sideways and held nothing focusable, so a keyboard could not reach what was past the edge. All
   three are `tabindex="0"` regions now - and, as the task asks, a swimlane bar that does something is
   a `role="button"` with an `aria-label` and Enter/Space.
5. **`color-contrast`** (serious, dark mode): the picked theme tile paints its own foreground, but the
   metrics inside it kept `.meta`'s muted grey. That span inherits the tile's colour when it is the
   picked one.
6. **`color-contrast`** (serious, dark mode): a swimlane bar carries a status class, whose foreground
   is black in most themes - but `.bar` (dfm-ui.css L299) comes later in the file than `.st-*` (L60)
   and wins for `background`, leaving black text on a near-black card at about 1.2:1. `.swim .bar`
   takes `--card-foreground` in dfm-ext.css, the one colour that is readable on the card it really
   has. The mockup composes the same two classes, so it has the same defect in dark mode.

Reduced motion needed no change: the stylesheet's global rule zeroes every transition and animation,
and the spec asserts it for the bulk bar, the running stripe and an ordinary button. The `serious` and
`critical` levels are what fails the run; `moderate` and `minor` are advisory and full of choices the
design system makes on purpose.

#### E12-S3-T3 Theme QA matrix
Files: `tests/e2e/themes.spec.ts`, `docs/plans/svelte-rewrite/notes/E12-theme-qa.md`
Depends: E11
Do:
1. Playwright screenshots of Overview, Instances (two rows selected, bulk bar), Instance Timeline tab, Instance Inputs tab with the replay dialog open, Failures (one group open), Settings, Login, for 5 themes × 2 modes at 1440 px, plus Instances and the workspace at 1024 px and 390 px. Store under `test-results/themes/` (artifact, not committed).
2. Review the matrix against `dfm-design-system.md` §7 and §13 (paper, ink, shadow colours, radius, line width, patterns) and fix deviations. Record the checklist in the notes file.
Accept:
- [ ] Every theme/mode pair matches its token table; no alpha tints or soft shadows anywhere (grep the built CSS for `rgba(` and `blur(` outside the overlay rule).
Test: the spec + manual review.

**Done, E12-S3-T3 (2026-09-05).** 78 shots under `test-results/themes/`, and the token table is
asserted rather than eyeballed: paper, accent, ink (the theme's in light, a light one in dark, since
the pair inverts), ink-on-paper over 7:1, the `radius · line · shadow` metrics the Settings screen
prints, a shadow that is a hard offset and not a blur, and the paper's pattern per theme. The bundle
carries no `rgba(` at all; its only `blur(` is Tailwind's unused `.blur` utility definition, and its
only translucent surface is `.overlay` - the other `color-mix` is Tailwind's placeholder rule, which
paints text.

The narrow widths are shot in Poster, the theme the mockups are drawn in, rather than in all five:
1024 px and 390 px are about layout, and the token half is already covered ten times over.

No §7 or §13 deviation was found; `notes/E12-theme-qa.md` records what was read and against what. The
two colour defects this pass turned up came from axe, not from the eye, and are fixed under
E12-S3-T2 - both compositions of frozen rules rather than wrong tokens.

### E12-S4 Release checklist and docs

#### E12-S4-T1 VS Code extension check and docs
Files: `docs/ui.md` (new), `durablefunctionsmonitor-vscodeext/CHANGELOG.md`, `docs/plans/svelte-rewrite/notes/E12-release.md`
Depends: E12-S1, E12-S2, E12-S3
Do:
1. Manual checklist in the notes file: extension with the packaged backend (`backend/DfmStatics`) opens the shell collapsed, PersistState round trip for theme and route, `OrchestrationIdFromVsCode` deep link, `DfmViewMode=1` graph view with Save as JSON and GotoFunctionCode, custom backends (MSSQL and Netherite) hide the capabilities they lack, `Custom Path to Backend Binaries` still works.
2. `docs/ui.md`: screens, keyboard map, settings (`DFM_CLIENT_CONFIG` keys `theme`, `showTimeAs`, `dfmTheme`; `DFM_DANGEROUS_OPERATIONS_ENABLED`; `DFM_AUDIT_ENABLED`; `DFM_STATS_CAP`), capability matrix per provider (from B0), and the build contract for contributors (link to contracts §2).
3. CHANGELOG entry for the extension describing the new UI.
Accept:
- [ ] Checklist fully ticked in the notes file with the extension version tested.
Test: manual.

**Deviation, E12-S4-T1 (2026-09-05).** **The check found a defect and it is fixed here, and the
checklist is not fully ticked.** Point 1 was done by reading both sides against each other rather
than by pressing F5 - everything a machine can settle is settled and written up in
`notes/E12-release.md` with the file references; the eleven checks that genuinely need an extension
host are listed there as the remaining manual pass, together with the reason F5 on an unrefreshed
working tree still loads the React bundle (`backend/DfmStatics` is gitignored build output).

The defect: in the webview `AppState` built the memory-mode router without a hub, so `loadAbout()`
returned early and the whole UI ran with no capabilities and `readOnly` true. The extension now puts
`hubName` into `DfmClientConfig`, `ClientConfig.hubName` is declared in `host.svelte.ts`, and the
memory-mode router defaults its hub to it - the same way it already defaults the instance id.
Restoring a persisted route keeps the screen and takes the hub from the host. Three cases in
`router.test.ts` and the `DfmClientConfig` assertion in `MonitorView.test.ts` cover it. This is also
what E0-S5-T2 needs, so that task is worth re-running once someone has an extension host.

Points 2 and 3 are done, and beyond what the task asked for: `docs/ui.md` carries a screenshot per
screen, the root README a feature tour over the same set, and the extension a "The monitoring UI"
section. Every claim in both documents was read back against the code first; the drift that turned up
(no built-in "Everything" tab, six bulk actions rather than eight, update-input-and-rewind is not a
dangerous operation, `/children` is not cached, `DFM_STATS_CAP` defaults to 50000, `dfm.*` are the
local-storage keys and not the `DFM_CLIENT_CONFIG` names) is corrected in the same pass. The
React-era screenshots under `readme/screenshots` were deleted.
