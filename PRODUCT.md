# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary (confirmed): the operator on a bad day.** Someone who owns a running Azure Durable Functions task hub and has to get from "something is wrong" to a safe fix, in the order the rewrite plan names the jobs (`docs/ui-plans-artifacts/uploads/files/dfm-rewrite-plan.md` §1):

1. **Know**: is the hub healthy right now, what is stuck, what is failing, is there a backlog.
2. **Find**: reach the one instance among thousands, or the group of instances that share a failure.
3. **Fix**: act on one instance or a group, with interlocks, and see afterwards what happened.

**Secondary (from the same confirmation, not separately interviewed): developers** inspecting instances, history and payloads while building, mostly through the VS Code extension. They use the same screens; they do not get screens of their own.

Operators reach the UI in a browser (behind Easy Auth or Microsoft Entra ID sign-in), and the layout folds down to a phone with a bottom navigation, so on-call use away from a desk is a supported situation.

## Product Purpose

Durable Functions Monitor ("DfMon") is a monitoring and debugging UI for Azure Durable Functions: it lists orchestrations and entities of a task hub, shows one instance's timeline, history, payloads and call graph, and lets an operator act on instances singly or in bulk. It exists because Durable Functions give you reliable stateful services but no UI for watching, managing and debugging their instances.

Success is an operator who, from an alert, reaches the right instance or failure group quickly, understands what happened from the real payloads and history, corrects it without making things worse, and can show afterwards who did what.

## Positioning

*Derived from public documentation at the user's request ("search online"); not yet confirmed by the user as the claim to make. Verify before it is used in marketing copy.*

- **It reads the task hub itself, not telemetry.** Application Insights samples by default and does not log orchestrator, activity or entity inputs and outputs unless opted in ([Durable Functions diagnostics](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-diagnostics)). DfMon reads instance state, history and payloads from the provider's storage.
- **It covers the bring-your-own providers.** Microsoft's Durable Task Scheduler ships with its own dashboard, one per task hub, with timeline, history and flow views and lifecycle actions ([dashboard](https://learn.microsoft.com/en-us/azure/durable-task/scheduler/durable-task-scheduler-dashboard), [overview](https://learn.microsoft.com/en-us/azure/durable-task/scheduler/durable-task-scheduler)). Azure Storage, MSSQL and Netherite are the bring-your-own providers ([task hubs](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-hubs)), and those are what DfMon reads. The documentation reviewed does not say outright that the scheduler dashboard is unavailable for them; that is inferred.
- **The operator workflow on top is what separates this fork from the original.** The original DfMon (`microsoft/DurableFunctionsMonitor`, MIT) already ran as a VS Code extension, standalone and injected, and already reached MSSQL and Netherite, so "three hosts" and "several providers" are lineage, not differentiators. What this version adds: failures grouped by a normalised error signature with bulk rewind and purge; recovery from an input event (update input and rewind, replay, restart in place) with a per-event reason when an operation is not allowed; an audit trail of who changed what; capability-driven screens that follow `/about` instead of provider names.
- **Not verified:** that the scheduler dashboard lacks failure grouping, bulk actions, event replay or an audit trail. The pages reviewed do not mention them; that is an absence in the documentation, not a finding.

## Operating Context

- **Three hosts, one UI build:** the VS Code extension's webview, a standalone Function App (or Docker image), and the backend injected into the user's own .NET isolated Function App. All serve the same bundle.
- **Everything is addressed by the hub:** screens live at `{routePrefix}/{connName}-{hubName}/{screen}`, and filters, time range and view state are in the URL so a view can be linked, bookmarked or saved. The VS Code webview has no address bar, so the same router runs in memory.
- **Shared time range** across Overview, Instances, Failures, Functions and Activity; times shown as UTC or local at the user's choice.
- **Auth and roles:** Easy Auth / Microsoft Entra ID (MSAL) or DfMon's own validation; `DFM_MODE=ReadOnly`, `DFM_ALLOWED_*` role lists; `DFM_NONCE` turns DfMon's own authentication off for deployments protected by Easy Auth or run locally. The signed-in account is shown in the UI and recorded in the audit log.
- **Operations come in three weights:** read, ordinary write (what `DFM_MODE=ReadOnly` disables, e.g. terminate, rewind, purge, update input and rewind) and `Dangerous` (replay, restart in place), which the backend refuses with 403 until `DFM_DANGEROUS_OPERATIONS_ENABLED=true`. `DFM_AUDIT_ENABLED=true` records every write.
- **Scale:** task hubs with thousands of instances. Table Storage has no server-side counts, so aggregates (`/stats`, `/failures`) scan at most 50,000 rows by default and answer `partial: true` when they stop early; results are cached 30 s per hub and query.
- **Delivery constraint:** one JS and one CSS bundle served by the backend under a strict content security policy (`default-src 'self'`), with no inline scripts and no external runtime assets.

## Capabilities and Constraints

- **Screens today:** Overview, Instances (table, timeline, histogram; bulk bar; peek panel; start new instance), Instance workspace (Summary, Timeline, History, Inputs, Sequence, Graph, Raw, custom Liquid tabs), Failures, Entities, Functions, Storage, Activity, Settings, plus a command palette and keyboard map. `docs/ui.md` is the reference.
- **Capability-driven (hard rule):** the UI asks `/about` and shows screens and actions from the capabilities it reports. It never branches on a provider name and never fakes data the backend does not return. A screen the backend cannot serve leaves the navigation; a control it cannot perform stays, disabled, with the reason on it.
- **JSON rule (user requirement):** every JSON value shown anywhere is pretty-printed (2 spaces) and fully expanded. The only exception is a one-line preview in a table cell, which opens the full viewer.
- **Providers:** Azure Storage, MSSQL and Netherite. They differ a lot in what they can do (`docs/ui.md`, capability table): for example `failures`, `storageHealth` and `updateInput` are Azure Storage only. The Durable Task Scheduler is not a supported provider; whether it should be is undecided.
- **Netherite is on a sunset path:** Microsoft's documentation says Durable Functions support for Netherite ends 31 March 2028 and recommends evaluating the Durable Task Scheduler ([retirement notice](https://mc.merill.net/message/AZ489009), [storage providers](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-storage-providers)). The backend packages must keep compiling meanwhile.
- **Edited payloads** must fit inline (60 KB); the editor meters them.
- **Terminology the UI uses:** task hub, orchestration, entity, instance, history; actions *terminate, suspend, resume, rewind, restart, purge, raise event, set customStatus, signal*; `DfMon` as the short name in code and docs.

## Brand Commitments

- **Binding (confirmed):** this is a fork of `microsoft/DurableFunctionsMonitor`. The UI, docs and extension must not imply Microsoft sponsorship or endorsement, and must not use Microsoft trademarks or logos in a way that causes confusion (README trademark notice).
- **Explicitly open (confirmed):** the user declined to bind the product name ("Durable Functions Monitor" / "DfMon"), the 6.16 logo and favicon, and the current copy voice. They may be changed; future work should not treat them as fixed.
- **Visual direction (confirmed 2026-11-06):** the contemporary developer-console standard, held to the craft level of Linear, Vercel, Trigger.dev and Inngest. The user rejected the earlier looks (neo-brutalist papers, glass, neumorphism) and a hand of world-metaphor directions (orchestral score, metro signage, reference manual) as dated, and asked for something modern researched online. The `studio` theme family carries it, four themes with Iris as the default (Jade, Ember, Mono beside it); DESIGN.md records the system. The older seven themes stay selectable.

## Evidence on Hand

- `readme/screenshots/dfm-*.png`: real captures of every screen, themes and the mobile layout.
- `docs/ui.md` and `README.md`: the screen-by-screen reference and capability matrix.
- A seeded Azurite hub used by the Playwright suite (`durablefunctionsmonitor.svelte/tests/e2e`).
- Live marketplace, NuGet and Docker badges in the README link to current install and rating counts; no numbers are copied here.
- **Absent, do not fabricate:** testimonials, named customers, user interviews or research, usage analytics, benchmarks of the scan or cache behaviour, and any pricing or support commitments.

## Product Principles

1. **Triage in the order of a bad day.** Each screen serves one of know, find, fix, and the path from the first to the last should be short.
2. **Show what the backend knows, and say what it does not.** Degrade visibly (screen gone, control disabled with its reason, `partial` stated), never fake or guess.
3. **A write's friction matches its risk.** Ordinary writes ask first; operations that rewrite history stay off until an operator turns them on; every write is attributable to a person.
4. **A view is a link.** Filters, range and screen state live in the URL so one operator can hand another exactly what they are looking at.
5. **The raw truth is one click away.** Payloads and history are shown whole and readable, never summarised to the point of hiding the evidence.

## Accessibility & Inclusion

Held today and expected to stay: WCAG 2.1 AA, enforced by axe (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) over every screen and the overlays in light and dark, zero serious or critical violations (`durablefunctionsmonitor.svelte/tests/e2e/a11y.spec.ts`). Every screen is operable without a mouse, `prefers-reduced-motion` is honoured, and text contrast is checked at 4.5:1 with a 3:1 focus ring (`docs/plans/svelte-rewrite/notes/E14-glass-review.md`).
