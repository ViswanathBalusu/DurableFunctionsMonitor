![Durable Functions Monitor](readme/screenshots/dfm-instances.png)
# Durable Functions Monitor

A monitoring/debugging UI tool for Azure Durable Functions

[Azure Durable Functions](https://docs.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-overview) provide an easy and elegant way of building cloud-native Reliable Stateful Services in the Serverless world. The only thing that's missing so far is a UI for monitoring, managing and debugging your orchestration instances. This project tries to bridge the gap.

[<img alt="Nuget" src="https://img.shields.io/nuget/v/DurableFunctionsMonitor.DotNetIsolated?label=current%20version">](https://www.nuget.org/profiles/durablefunctionsmonitor)  [![main-build](https://github.com/microsoft/DurableFunctionsMonitor/actions/workflows/main-build.yml/badge.svg)](https://github.com/microsoft/DurableFunctionsMonitor/actions/workflows/main-build.yml)


[<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/ViswanathBalusu/DurableFunctionsMonitor?label=GitHub%20stars">](https://github.com/ViswanathBalusu/DurableFunctionsMonitor/stargazers) [<img alt="Visual Studio Marketplace Rating" src="https://img.shields.io/visual-studio-marketplace/r/ChandraBalusu.durablefunctionsmonitor-reimagined?label=VsCode%20extension%20rating">
](https://marketplace.visualstudio.com/items?itemName=ChandraBalusu.durablefunctionsmonitor-reimagined)


[<img alt="Visual Studio Marketplace Installs" src="https://img.shields.io/visual-studio-marketplace/i/ChandraBalusu.durablefunctionsmonitor-reimagined?label=VsCode%20extension%20installs">](https://marketplace.visualstudio.com/items?itemName=ChandraBalusu.durablefunctionsmonitor-reimagined) [<img src="https://img.shields.io/docker/pulls/scaletone/durablefunctionsmonitor"/>](https://hub.docker.com/r/scaletone/durablefunctionsmonitor) [<img alt="Nuget" src="https://img.shields.io/nuget/dt/DurableFunctionsMonitor.DotNetIsolated?label=NuGet%20downloads">](https://www.nuget.org/profiles/durablefunctionsmonitor)

## What it does

One task hub in view at a time, switched from the top bar or the command palette. Every screen reads
the hub through the backend's REST API; the UI decides what to show from the capabilities `/about`
reports, never from which storage provider is behind it. Full tour, keyboard map and settings:
[docs/ui.md](docs/ui.md).

### The hub at a glance

![Overview](readme/screenshots/dfm-overview.png)

Six status tiles, each with the shape of the range behind it. Throughput as a stacked histogram whose
brush sets the time range every other screen then uses. "Needs attention" - failed in range, running
or pending longer than your thresholds, work items piling up, anything suspended - and the busiest
orchestrators with p50, p95 and failure rate. Where the provider serves them, the queue backlog and
the last writes anyone made are on the same page.

### The instances, three ways

![Instances](readme/screenshots/dfm-instances.png)

Filter by status, by orchestrator, by whether entities are included, and by any column with an
operator and a value - which becomes the OData the backend expects. The whole view lives in the URL,
so it can be linked, bookmarked or kept as a saved view; columns can be hidden and the density is
yours.

| | |
|---|---|
| ![Timeline view](readme/screenshots/dfm-instances-timeline.png) | ![Histogram view](readme/screenshots/dfm-instances-histogram.png) |

The same rows as one bar per instance, or as when they ran. Brushing the histogram narrows the time
filter for every view.

### Act on many at once

![Bulk actions](readme/screenshots/dfm-instances-bulk.png)

Select rows and terminate, suspend, resume, rewind, raise an event on, or purge them - 200 at a time
through `/orchestrations/batch`, however many you picked, with a per-instance result you can read
afterwards.

### One instance, all the way down

![Instance workspace](readme/screenshots/dfm-instance-graph.png)

The header carries the runtime status with a running clock, the instance's own numbers and its
actions - suspend, resume, raise event, set customStatus, restart, rewind, terminate, purge - and the
tabs carry the rest: where the time went, the history, the payloads, and the function map with the
path this instance actually took.

| | |
|---|---|
| ![Timeline tab](readme/screenshots/dfm-instance-timeline.png) | ![Sequence tab](readme/screenshots/dfm-instance-sequence.png) |

A swimlane of activities, sub-orchestrations, timers and external events; the call sequence as a
diagram; the raw history rows and the raw DTO; and any Liquid tab the hub publishes for itself.

### Re-run what went wrong

![Inputs tab](readme/screenshots/dfm-instance-inputs.png)

Beyond the usual rewind and restart: replace the input a failed instance was given and rewind it,
replay it from the last external event it received (with the payload as it was, or edited), or
restart it in place under the same instance id. The last two rewrite history, so they stay off until
an operator turns them on (`DFM_DANGEROUS_OPERATIONS_ENABLED`), and the backend says per event which
of the three applies, so the UI can disable a button with the reason on it instead of letting you
find out from a 403.

### Failures, grouped

![Failures](readme/screenshots/dfm-failures.png)

The failed instances of the range collected by orchestrator and by an error signature that normalises
numbers, GUIDs, quoted values and hashes - so twelve instances that hit the same bug are one row, and
one click rewinds or purges all of them.

### Entities, storage and the audit trail

| | |
|---|---|
| ![Entities](readme/screenshots/dfm-entities.png) | ![Storage](readme/screenshots/dfm-storage.png) |

The durable entities with their state parsed and searchable by name and key prefix; the task hub
itself - tables, the large-message container, the queues and which worker holds which control-queue
partition; and, with `DFM_AUDIT_ENABLED`, every write anyone made through the monitor: who, what,
which instance, how it went.

### Five themes, and one keyboard

![Command palette](readme/screenshots/dfm-command-palette.png)

`Ctrl`/`Cmd` `K` reaches every screen, every theme, the actions of the screen you are on, and any
instance id. Light, dark or whatever the system says. Every screen works without a mouse, CI runs axe
over the app in both modes, and every JSON value anywhere is pretty-printed and fully expanded.

| | |
|---|---|
| ![Riso theme](readme/screenshots/dfm-theme-riso.png) | ![Blueprint theme, dark](readme/screenshots/dfm-theme-blueprint.png) |

And it folds down to a phone, where the navigation moves to the bottom:

<img src="readme/screenshots/dfm-mobile.png" width="320" alt="Instances on a phone">

More screens, the keyboard map, the capability matrix and every setting: [docs/ui.md](docs/ui.md).

## How to use

You can run this tool: 
* [as a VsCode extension](https://marketplace.visualstudio.com/items?itemName=ChandraBalusu.durablefunctionsmonitor-reimagined).
* [as a Standalone service](https://github.com/microsoft/DurableFunctionsMonitor/wiki/How-to-run-DfMon-in-Standalone-mode).
* ["Injected" into your .NET Isolated Function](durablefunctionsmonitor.dotnetisolated.core#durablefunctionsmonitordotnetisolatedcore).

"Injected" DfMon can only be injected into a .NET Isolated Function project. All other DfMon incarnations work with any platforms/programming languages supported by Durable Task Framework.

See [detailed instructions in our Wiki](https://github.com/microsoft/DurableFunctionsMonitor/wiki).

## Contents of this repo

* [durablefunctionsmonitor.dotnetisolated.core](durablefunctionsmonitor.dotnetisolated.core) - a .NET Isolated version of the backend. Implements a thin layer of RESTful APIs on top of [Durable Task Framework](https://github.com/microsoft/durabletask-dotnet), also serves [client UI statics](durablefunctionsmonitor.svelte). This is what you will "inject" into *your* .NET Isolated Function projects.
* [durablefunctionsmonitor.dotnetisolated](durablefunctionsmonitor.dotnetisolated) - a .NET Isolated Function project, that references [durablefunctionsmonitor.dotnetisolated.core](durablefunctionsmonitor.dotnetisolated.core) and can be deployed as a standalone Function App instance.
* [durablefunctionsmonitor.svelte](durablefunctionsmonitor.svelte) - client UI implementation. A Svelte 5 app written in TypeScript, built with Vite. Compiled HTML/JS/CSS statics from this project are then served by the backends. See [docs/ui.md](docs/ui.md).
* [durablefunctionsmonitor-vscodeext](durablefunctionsmonitor-vscodeext) - VsCode extension implementation, written in TypeScript.
* [custom-backends](custom-backends) - a set of backend implementations for non-default storage providers (e.g. for [MSSQL](custom-backends/dotnetIsolated-mssql) and [Netherite](custom-backends/dotnetIsolated-netherite)).

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
