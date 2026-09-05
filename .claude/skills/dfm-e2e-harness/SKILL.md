---
name: dfm-e2e-harness
description: Run and debug the DFM test harness locally and in CI - Azurite, the seeded task hub, the standalone isolated host (func), Playwright end-to-end specs, Vitest unit tests, dotnet tests, and the build-contract check. Use when a task's Test line names an e2e spec, when tests fail with connection or port errors, or when setting up a machine for this repo.
---

# DFM test harness

## One-time setup

- Node 22+, npm 11 (`node --version`), .NET SDK 10 (`dotnet --version`), Azure Functions Core Tools 4 (`npm i -g azure-functions-core-tools@4`, gives `func`), Azurite (`npm i -g azurite` or use `npx azurite`).
- `cd durablefunctionsmonitor.svelte && npm ci && npx playwright install --with-deps chromium`.
- `node scripts/harness/write-local-settings.mjs` (repo root) writes `durablefunctionsmonitor.dotnetisolated/local.settings.json` with the emulator connection string, `DFM_NONCE=i_sure_know_what_i_am_doing` (auth off), dangerous operations on, audit on. Flags: `--dangerous=false`, `--audit=false`, `--ingress-prefix=proxy`, `--stats-cap=5`, `--force`.

## Daily loop

```bash
# terminal 1: storage emulator (repo root)
npx azurite --silent --location .azurite

# terminal 2: UI statics into the host, then the host
cd durablefunctionsmonitor.svelte && npm run build-and-copy
node ../scripts/harness/start-host.mjs          # builds the host, starts func on :7072, waits for /about

# terminal 3: dev server (hot reload) proxied to the host, or e2e
cd durablefunctionsmonitor.svelte && npm run dev # http://localhost:3000/DurableFunctionsHub
npm run seed                                     # seeds DurableFunctionsHub into Azurite (idempotent; --reset to wipe)
npm run test:e2e                                 # playwright; its webServer starts the host if none answers
```

Unit and static checks: `npm run check` (svelte-check), `npm run lint`, `npm test` (vitest). Build contract: `npm run build && npm run verify` (runs `scripts/harness/verify-build-contract.mjs`).

Backend: `dotnet build DurableFunctionsMonitor.slnx`; `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.tests`; with Azurite up, `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests` (without Azurite they report Inconclusive; CI sets `DFM_TEST_REQUIRE_STORAGE=true` to make that a failure).

## URLs and ids

- Host: `http://localhost:7072/durable-functions-monitor/DurableFunctionsHub` (UI), `http://localhost:7072/durable-functions-monitor/a/p/i/--DurableFunctionsHub/about` (API; the `--` means default connection). API calls need the header `x-dfm-nonce: i_sure_know_what_i_am_doing` when auth is disabled through the nonce.
- Seeded data lives in `tests/e2e/seed/fixtures.mjs`: instances `order-2026-09-04-000913` (running, external event, history of the mockup), `order-2026-09-04-000911` (failed, InventoryUnavailable), entities `@counter@warehouse-07`, `@counter@warehouse-12`, and the failure groups of the Failures mockup.

## Playwright conventions

- `tests/e2e/*.spec.ts`; fixtures in `tests/e2e/fixtures.ts` (`gotoHub`, `gotoInstance`, `expectToast`, `theme`). Projects: `chromium` (1440×900) and `mobile` (390×844).
- Two host flavours: default (dangerous on) and `dangerous-off` (port 7073, started by the runner with `--port=7073 --dangerous=false`). Specs that need the off flavour use `test.describe.configure({ project: 'dangerous-off' })`.
- Use role-based selectors (`getByRole('button', { name: 'Terminate' })`), assert toasts by text, and wait on network idle only through explicit expectations.
- Run one spec: `npx playwright test tests/e2e/instances.spec.ts --project=chromium`; debug: `--ui` or `--debug`; report: `npx playwright show-report`.

## CI

`.github/workflows/build.yml` starts Azurite as a service container, builds the UI, runs lint/check/unit, verifies the build contract, copies statics, runs dotnet tests, installs core tools and Chromium, seeds, runs Playwright (its `webServer` starts the host), and uploads `playwright-report`. `push-to-ghcr.yml` publishes the three images (each builds its own UI) and runs the .NET tests.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `func` not found | `npm i -g azure-functions-core-tools@4`; on Windows the runner spawns `func.cmd`. |
| Host never answers `/about` | Check Azurite is listening on 10000/10001/10002; check `local.settings.json` exists; look at the func output for binding errors; `DfmStatics/index.html` missing only breaks the UI, not `/about`. |
| 401 from the API | Missing `x-dfm-nonce` header or `DFM_NONCE` not set in `local.settings.json`. |
| Port 7072 in use | `node scripts/harness/start-host.mjs --port=7075` and set `DFM_E2E_BASE_URL` for Playwright. |
| Integration tests Inconclusive | Azurite not running; start it, or set `DFM_TEST_STORAGE_CONNECTION_STRING` to another account. |
| Seed rows not listed | The list filters on `createdTime`; fixtures use relative timestamps, so re-seed after long idle periods; check the hub name matches `DFM_E2E_HUB`. |
| VS Code webview shows unstyled page | Asset links not root-absolute or names with `-`/`_`; run `npm run verify`. |
