# E3 · Test harness

Goal: the three test levels every later task relies on: Vitest unit and component tests, Playwright end-to-end tests against the real isolated host and Azurite with a seeded hub, and the CI job that runs all of it on every PR. Also replaces the React build steps in CI with the Svelte ones.

Prerequisites: E0, E2 (for the smoke specs). Read contracts §15 and `.claude/skills/dfm-e2e-harness/SKILL.md`.

Exit criteria: `npm test`, `npm run test:e2e` (locally with Azurite) and the `build` workflow are green; the e2e run seeds a hub, starts the host, and passes the smoke specs.

### E3-S1 Unit and component tests

#### E3-S1-T1 Vitest setup
Files: `tests/unit/setup.ts`, `vite.config.ts` (test block), `package.json` scripts, `tests/unit/README.md`
Depends: E0-S1-T2
Do:
1. `setup.ts`: `@testing-library/jest-dom/vitest` matchers; polyfills for `matchMedia`, `ResizeObserver`, `IntersectionObserver`, `scrollTo`, `navigator.clipboard`; `process.env.TZ = 'Etc/GMT-2'` documented; a `resetGlobals()` helper that deletes the seven host globals between tests.
2. Vitest config: `environment: 'jsdom'`, `include` per contracts §2, `css: true` so Svelte component styles load, `coverage` with `v8` and thresholds `lines 70` for `src/lib/format`, `src/lib/filters`, `src/lib/api`, `src/lib/router.svelte.ts` (the pure logic), no threshold elsewhere.
3. `README.md`: how to write a component test with `render` from `@testing-library/svelte`, how to fake the app context (`tests/unit/fake-app.ts` exporting `createFakeApp(overrides)` with a recording endpoints object and an in-memory router in memory mode).
Accept:
- [ ] `npm test` runs the existing tests from E0/E1 and reports coverage.
Test: itself.

#### E3-S1-T2 Fixtures for DTOs
Files: `tests/unit/fixtures/{about,instances,details,history,input-events,stats,failures,spans,children,storage,entities,audit}.ts`
Depends: E0-S2-T4
Do:
1. One typed fixture per DTO, built from the mockup content (`dfm-design-system.md` §11 and the `ROWS`/`HISTORY`/`LANES` arrays in the screens): orchestrator names, instance ids, the failed `order-2026-09-04-000911` with `InventoryUnavailable`, the running `order-2026-09-04-000913` with 31 history rows including `EventRaised #27 PaymentApproved`, the entity `@counter@warehouse-07` with state `{ "value": 1284, "lastSku": "SKU-4471" }`.
2. Export factories with overrides (`instance({ runtimeStatus: 'Failed' })`).
Accept:
- [ ] Fixtures type-check against `types.ts`.
Test: compile.

### E3-S2 Playwright end-to-end

#### E3-S2-T1 Seed script for a synthetic hub
Files: `tests/e2e/seed/seed-hub.mjs`, `tests/e2e/seed/fixtures.mjs`, `package.json` (dev deps `@azure/data-tables`, `@azure/storage-blob`, `@azure/storage-queue`; script `seed`)
Depends: E0-S1-T1
Do:
1. Connection string from `DFM_TEST_STORAGE_CONNECTION_STRING` or the Azurite default (`tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests/StorageEmulator.cs` has it). Hub name `DurableFunctionsHub` (override with `DFM_E2E_HUB`).
2. Create tables `{hub}Instances`, `{hub}History`, container `{hub}-leases` with a `taskhub.json` blob `{ "TaskHubName": hub, "CreatedAt": "<iso>", "PartitionCount": 4 }`, container `{hub}-largemessages`, queues `{hub}-workitems`, `{hub}-control-00..03` (empty).
3. Instances rows mirror `OrchestrationHistoryEditorTests.SeedInstanceAsync`: `PartitionKey=instanceId`, `RowKey=""`, `ExecutionId`, `Name`, `Version ""`, `Input`, `Output` (failed ones: a JSON failure `{"ErrorType":"...","ErrorMessage":"InventoryUnavailable: SKU-4471 has 0 units in warehouse-07"}`), `CustomStatus`, `RuntimeStatus`, `CreatedTime`, `LastUpdatedTime`, `CompletedTime` (terminal only), `TaskHubName`, `Generation 0`. History rows mirror `Row()` and `SeedFailedHistoryAsync` in that test: X16 row keys, `ExecutionId`, `EventType`, `_Timestamp`, `IsPlayed`, `EventId`, `Name`, `Input`, `Result`, `TaskScheduledId`, plus the `sentinel` row. Entities: Instances rows with `PartitionKey=@counter@warehouse-07`, `Name=@counter@warehouse-07`, `Input` = the entity envelope `{"exists":true,"state":"{\"value\":1284}"}`.
4. Data set (`fixtures.mjs`): the nine instances of `ScreenInstances.dc.html` L190–L198 (relative timestamps: created "n minutes ago" so time-range filters work on any day), the two entities L201–L202, and for `order-2026-09-04-000913` the history of `ScreenInstance.dc.html` L311–L325 with episode markers around each row group, ending with `SubOrchestrationInstanceCreated` (running). For `order-2026-09-04-000911`: a failed history with `TaskFailed` and `ExecutionCompleted`. Six failed `ProcessOrderOrchestrator` instances with `InventoryUnavailable: SKU-* has 0 units in warehouse-*` outputs, two with `Timeout: ChargePayment did not complete within 20 s`, one `ReconcileLedgerOrchestrator` with `Ledger checksum mismatch for account "4471-EU"`.
5. Idempotent: upserts everything; `--reset` deletes the tables first.
Accept:
- [ ] Running twice leaves the same row counts.
- [ ] After seeding, `GET /a/p/i/--DurableFunctionsHub/orchestrations?$top=50&$filter=createdTime ge '2000-01-01T00:00:00Z' and createdTime le '2100-01-01T00:00:00Z'` on the running host returns the seeded instances.
Test: `tests/e2e/seed/seed.spec.ts` (runs in the e2e project) asserts the API count.

#### E3-S2-T2 Host runner and local settings
Files: `scripts/harness/write-local-settings.mjs` (repo root), `scripts/harness/start-host.mjs`, `durablefunctionsmonitor.svelte/package.json` (scripts `host`, `test:e2e:local`)
Depends: E3-S2-T1
Do:
1. Both scripts already exist in `scripts/harness/` (written with the harness on 2026-09-04): `write-local-settings.mjs` writes `local.settings.json` from contracts §15 unless it exists (flags `--dangerous=false`, `--audit=false`, `--ingress-prefix=x`, `--stats-cap=n`, `--force`, `--project=<folder>`); `start-host.mjs` builds the host, spawns `func host start --port <port>` in `bin/Debug/net10.0`, and waits until `/about` answers with the nonce header (120 s timeout; flags `--port`, `--hub`, `--no-build`, `--project`). Run both once on your machine, fix anything that does not work on your OS, and add `--custom-templates=<folder>` support (sets `DFM_CUSTOM_TEMPLATES_FOLDER`-style env for the function map in E7) if the host supports it through `DfmSettings.CustomTemplatesFolderName`; otherwise document how to seed a function map blob instead.
2. Verify `start-host.mjs` handles `DFM_E2E_BASE_URL`-style port overrides for the second (dangerous-off) host on 7073.
3. `npm run host` = `node ../scripts/harness/start-host.mjs`; `npm run test:e2e:local` = seed, then playwright.
Accept:
- [ ] `node scripts/harness/start-host.mjs` on a machine with Azurite prints "host ready" within the timeout.
Test: manual; CI covers it.

#### E3-S2-T3 Playwright config and fixtures
Files: `playwright.config.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/fixtures.ts`
Depends: E3-S2-T2
Do:
1. `playwright.config.ts`: `testDir: tests/e2e`, `baseURL: http://localhost:7072/durable-functions-monitor`, projects `chromium` only (add `Mobile Chrome` with a 390 px viewport for the responsive specs), `webServer: { command: 'node ../scripts/harness/start-host.mjs', url: 'http://localhost:7072/durable-functions-monitor/a/p/i/--DurableFunctionsHub/about', reuseExistingServer: !CI, timeout: 180000, env }`, `globalSetup` runs the seed, `retries: CI ? 2 : 0`, `trace: 'on-first-retry'`, reporter `html` + `github` in CI.
2. Because auth is disabled through `DFM_NONCE`, no login helper is needed; `fixtures.ts` provides `gotoHub(page, path = '')`, `gotoInstance(page, id)`, `expectToast(page, text)`, `theme(page, name, dark)`.
3. Remove the React Playwright suite from consideration (it stays in the React folder until E12).
Accept:
- [ ] `npx playwright test --list` lists the smoke specs.
Test: itself.

#### E3-S2-T4 Smoke specs
Files: `tests/e2e/shell.spec.ts`, `tests/e2e/login.spec.ts`, `tests/e2e/responsive.spec.ts`
Depends: E3-S2-T3, E2
Do:
1. `shell.spec.ts`: hub page shows the side nav with Overview active, the top bar hub switcher shows `DurableFunctionsHub`, `/about` version appears in the user menu, theme menu switches `data-theme`, palette opens with Ctrl+K and navigates to Instances on Enter, `g s` opens Settings, instance jump navigates to a seeded id, an unknown hub shows the error toast.
2. `login.spec.ts`: root URL (`/durable-functions-monitor/`) with one hub redirects straight to it (seed only one hub); with `DFM_E2E_HUB2` seeded, the picker lists two hubs.
3. `responsive.spec.ts` (mobile project): bottom nav visible, side nav hidden, More sheet opens.
Accept:
- [ ] All three pass locally and in CI.
Test: themselves.

### E3-S3 CI

#### E3-S3-T1 build.yml and push-to-docker-hub.yml on the Svelte build
Files: `.github/workflows/build.yml`, `.github/workflows/push-to-docker-hub.yml`
Depends: E3-S2-T4
Do:
1. Replace the React steps with: `actions/setup-node@v4` (node 22, cache npm, `cache-dependency-path: durablefunctionsmonitor.svelte/package-lock.json`), `npm ci`, `npm run lint`, `npm run check`, `npm test`, `npm run build`, `node scripts/harness/verify-build-contract.mjs durablefunctionsmonitor.svelte/build`, copy `build/` to `durablefunctionsmonitor.dotnetisolated/DfmStatics` (replace the `cp -r durablefunctionsmonitor.react/build` line).
2. After the .NET tests and before publish: `npm install -g azure-functions-core-tools@4 --unsafe-perm true`, `npx playwright install --with-deps chromium`, `npm run seed`, `npx playwright test` (the `webServer` starts the host against the Azurite service container already declared), upload `playwright-report` as an artifact `if: always()`.
3. Keep the VS Code packaging steps; `backend/DfmStatics` now comes from the Svelte build through the publish output.
Accept:
- [ ] A PR run is green end to end; the Playwright report artifact is attached.
Test: the workflow run.
