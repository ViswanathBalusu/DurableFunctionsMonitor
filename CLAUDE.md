# Durable Functions Monitor

Monitoring UI for Azure Durable Functions. Backend: .NET 10 isolated Azure Functions (`durablefunctionsmonitor.dotnetisolated.core` + standalone host + MSSQL/Netherite packages). UI: Svelte 5 (`durablefunctionsmonitor.svelte`), rewritten from the React app that was deleted in E12-S2-T1, following the plan in `docs/plans/svelte-rewrite/`.

## Working the rewrite

- The plan is the spec: `docs/plans/svelte-rewrite/README.md` (index, decisions, versions), `00-shared-contracts.md` (build contract, host globals, routing, API and DTOs, state, storage keys, JSON rule, class map, commands), one file per epic (`E0`–`E12` UI, `B0`–`B5` backend), `STATUS.md` (the board).
- Mockups in `docs/ui-plans-artifacts/` are the visual source of truth; tasks cite their line numbers. Match them exactly.
- Pick work with `node scripts/harness/plan-status.mjs next`; execute with the `dfm-task-runner` skill (`/dfm-task-runner E4-S2-T1`); tick with `node scripts/harness/plan-status.mjs --done <id> <hash>`.
- Subagents: `dfm-ui-developer`, `dfm-backend-developer`, `dfm-qa-engineer`, `dfm-design-reviewer` (read-only). Skills: `dfm-task-runner`, `dfm-svelte-ui`, `dfm-backend-endpoint`, `dfm-d3-charts`, `dfm-e2e-harness`, `dfm-design-review`.
- One task per commit, message `E4-S2-T1: …`. Do not widen tasks. Definition of done is in the plan README.

## Frozen paths (a hook refuses edits)

`docs/ui-plans-artifacts/**` (design source), any `DfmStatics/**` (build output; produce it with `npm run build-and-copy`), `durablefunctionsmonitor.svelte/src/styles/dfm-ui.css` and `dfm-tokens.css` (verbatim copies; additions go to `dfm-ext.css`).

## Commands

- UI (`durablefunctionsmonitor.svelte/`): `npm ci`, `npm run dev` (:3000, proxies to :7072), `npm run build`, `npm run build-and-copy`, `npm run check`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run verify` (build contract), `npm run preview:styles` (the design-system preview page with the family sheets, photographed per theme and mode into `test-results/style-preview/`).
- Harness (repo root): `node scripts/harness/plan-status.mjs [next|E4|--sync|--done id hash|--blocked id why]`, `node scripts/harness/verify-build-contract.mjs durablefunctionsmonitor.svelte/build`, `node scripts/harness/verify-nuspec-dependencies.mjs`, `node scripts/harness/write-local-settings.mjs`, `node scripts/harness/start-host.mjs`, `node scripts/harness/style-preview.mjs [--shoot]` (builds `durablefunctionsmonitor.svelte/build/style-preview/index.html`).
- Backend: `dotnet build DurableFunctionsMonitor.slnx`, `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.tests`, `npx azurite --silent --location .azurite` then `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests`.
- Host: `func host start --port 7072` in `durablefunctionsmonitor.dotnetisolated/bin/Debug/net10.0` (needs `local.settings.json`; the harness writes it with auth disabled through `DFM_NONCE`).

## Hard rules

- Every JSON value shown in the UI is pretty-printed (2 spaces) and fully expanded; table cells show a one-line preview that opens the full viewer.
- UI behaviour is capability-driven from `/about`; never branch on provider names in the UI; never fake data the backend does not return.
- Build output contract (`00-shared-contracts.md` §2) must hold: one JS and one CSS bundle under `static/`, hex-hash names, root-absolute links in `index.html`, the seven placeholder tags verbatim, no inline scripts.
- Pin package versions exactly as the plan README lists; TypeScript stays on 5.x.
- Backend: every DfMon function has `[OperationKind]`; provider-specific storage goes through `DfmExtensionPoints`; MSSQL and Netherite packages must keep compiling.
- Adding a `PackageReference` to a backend library means adding a matching `<dependency>` to every `nuspec.nuspec` that packs that assembly into `lib/`. `nuget pack` infers nothing from a hand-written nuspec, so a forgotten entry ships a package that restores cleanly and throws `FileNotFoundException` in the consumer app. `node scripts/harness/verify-nuspec-dependencies.mjs` enforces it and runs in CI.
- Tests are part of every task; never skip, disable or loosen a test to get green.
