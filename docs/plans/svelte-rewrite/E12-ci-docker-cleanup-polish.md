# E12 · CI, Docker, cleanup and polish

Goal: the Svelte app is the only UI: Docker images and the VS Code extension ship it, the React project is deleted, fonts are self-hosted, and the accessibility, reduced-motion and theme passes are done.

Prerequisites: E0–E11 and B0–B5 merged. Read contracts §2, §15.

Exit criteria: `main-build`, `push-to-docker-hub` and `push-to-vscode-marketplace` workflows succeed on the Svelte build; `durablefunctionsmonitor.react/` no longer exists; the release checklist in E12-S4 is green.

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

#### E12-S3-T3 Theme QA matrix
Files: `tests/e2e/themes.spec.ts`, `docs/plans/svelte-rewrite/notes/E12-theme-qa.md`
Depends: E11
Do:
1. Playwright screenshots of Overview, Instances (two rows selected, bulk bar), Instance Timeline tab, Instance Inputs tab with the replay dialog open, Failures (one group open), Settings, Login, for 5 themes × 2 modes at 1440 px, plus Instances and the workspace at 1024 px and 390 px. Store under `test-results/themes/` (artifact, not committed).
2. Review the matrix against `dfm-design-system.md` §7 and §13 (paper, ink, shadow colours, radius, line width, patterns) and fix deviations. Record the checklist in the notes file.
Accept:
- [ ] Every theme/mode pair matches its token table; no alpha tints or soft shadows anywhere (grep the built CSS for `rgba(` and `blur(` outside the overlay rule).
Test: the spec + manual review.

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
