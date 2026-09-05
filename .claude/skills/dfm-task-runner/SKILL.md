---
name: dfm-task-runner
description: Execute one task of the Svelte rewrite plan (docs/plans/svelte-rewrite) end to end - read the task, implement it, run the definition-of-done checks, tick STATUS.md, commit. Use when asked to "do task E4-S2-T1", "pick the next task", "work the plan", or when a task id like E3-S1-T2 or B1-S2-T3 is mentioned.
---

# DFM task runner

You are executing exactly one task from `docs/plans/svelte-rewrite/`. The task id is `$ARGUMENTS` (for example `E4-S2-T1`). If no id was given, run `node scripts/harness/plan-status.mjs next` and take the first ready task.

## Steps

1. Locate the task: `grep -rn "#### $ARGUMENTS" docs/plans/svelte-rewrite/`. Read the whole task block (Files, Depends, Do, Accept, Test) and the story goal above it.
2. Check dependencies: `node scripts/harness/plan-status.mjs <epic id>` must show every dependency as done. If not, stop and report which are open. Do not start.
3. Read the context the task cites: the sections of `docs/plans/svelte-rewrite/00-shared-contracts.md` it names, the mockup lines it cites (`docs/ui-plans-artifacts/...`), and any existing files it changes. For UI tasks also load the `dfm-svelte-ui` skill; for backend tasks `dfm-backend-endpoint`; for charts `dfm-d3-charts`; for e2e work `dfm-e2e-harness`.
4. Implement only what the task says. Keep names, file paths, class names and copy exactly as written in the task and the mockup. If the task and the mockup disagree, the mockup wins for visuals and copy; note the disagreement in your final message.
5. Write the test the task names. A task without its test is not done.
6. Run the checks:
   - UI: `cd durablefunctionsmonitor.svelte && npm run check && npm run lint && npm test` (plus `npm run build && npm run verify` when the task touches the build, `index.html`, `vite.config.ts`, styles or `package.json`).
   - Backend: `dotnet build DurableFunctionsMonitor.slnx` and `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.tests`, plus `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests` when the task touches storage (start Azurite first: `npx azurite --silent --location .azurite` in the repo root).
   - E2E specs the task names: `npm run test:e2e -- <spec>` with Azurite running (see `dfm-e2e-harness`).
   Fix until green. Do not skip, disable or loosen a test to get green.
7. Tick every box in the task's Accept list only when it is true. If one cannot be met, do not tick it; write a `BLOCKED:` note under the task in the epic file and run `node scripts/harness/plan-status.mjs --blocked $ARGUMENTS "<why>"`, then stop.
8. Commit: `git add <only the files of this task>` then `git commit -m "$ARGUMENTS: <one line of what changed>"`. Then `node scripts/harness/plan-status.mjs --done $ARGUMENTS <short hash>` and commit `STATUS.md` in the same commit or a follow-up `docs: tick $ARGUMENTS`.
9. Final message: task id, what was built (files), what was verified (commands and results), anything left open.

## Rules

- Never edit frozen paths (`durablefunctionsmonitor.react/`, `docs/ui-plans-artifacts/`, any `DfmStatics/`, the verbatim stylesheet copies). A hook blocks it; do not work around the hook.
- Never widen the task. Ideas for other tasks go in the final message, not in the code.
- Never invent backend data the endpoint does not return; hide or degrade per the task's capability notes.
- JSON shown to the user is always pretty-printed and fully expanded (contracts §9).
- Pin package versions exactly as `README.md` lists them.
- One task, one commit, message prefixed with the task id.
