# DurableFunctionsMonitor.DotNetIsolated.Core

An incarnation of DurableFunctionsMonitor that can be "injected" into your [.NET 10 Isolated](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) Azure Function.

## What you get

The same Svelte UI ships in every DurableFunctionsMonitor package. Once wired into your Function App, it gives you:

* **Overview** — status tiles, a throughput histogram whose brush sets the time range, "needs attention" (failures in range, instances running or pending longer than your thresholds, a queue backing up, anything suspended), the top orchestrators with p50/p95 duration and failure rate, a storage backlog panel and recent activity.
* **Instances** — table, timeline and histogram views over the same OData-backed filters, saved views, and bulk actions (terminate, suspend, resume, rewind, raise event, purge) over the selection, 200 instances per call.
* **Instance workspace** — Timeline (a swimlane of activities, sub-orchestrations, timers and events), History, Inputs, a Sequence diagram, the function Graph, Raw JSON, a Summary of where the time went, and any custom Liquid tabs the hub publishes.
* **Failures** — failed instances grouped by orchestrator and by a normalised error signature (numbers, GUIDs, quoted values and hashes collapsed to `*`).
* **Entities** — the durable entities of the hub, filterable by name and key prefix.
* **Storage** — the tables, queues and control-queue partitions behind the task hub.
* **Activity** — an audit trail of every write and dangerous operation made through the UI.
* **Settings** — five visual themes, light/dark/system mode, density, whether times are shown as UTC or local, and the "needs attention" thresholds.

The UI asks `/about` once and turns each screen and button on or off from what the backend reports it can do — see Capabilities below. Every JSON payload it shows is pretty-printed and fully expanded, never a truncated preview.

## Capabilities

This package is the reference implementation, backing a plain Azure Storage Task Hub: every capability `/about` can report is implemented.

* Stats, Failures, Children, Storage health, Update input & rewind, Replay (truncate history), and the orchestrator lane of the Timeline (episode markers) are all supported.
* The audit trail is supported once you set `DFM_AUDIT_ENABLED=true`.
* Spans, bulk instance operations, Entities, purge history and conditional GET (ETag, on instance details and history) are always on, independent of the storage provider.
* Purging entities (the entity branch of `/purge-history`), cleaning entity storage and deleting a task hub are not implemented by this backend yet, on any provider; those calls answer `400`.

## How to use

* Install from NuGet:
   ```
   dotnet add package DurableFunctionsMonitor.DotNetIsolated
   ```
* Initialize by calling **.UseDurableFunctionMonitor()** extension method during your Function's startup, like this:
   ```
  var host = new HostBuilder()
      .ConfigureFunctionsWorkerDefaults((hostBuilderContext, workerAppBuilder) => {

          workerAppBuilder.UseDurableFunctionsMonitor();

      })
      .Build();
   ```


   By default all settings are read from env variables ([all the same config settings](https://github.com/microsoft/DurableFunctionsMonitor/wiki/Config-Settings-Reference) are supported), but those can be programmatically (re)configured like this:
   ```
   var host = new HostBuilder()
       .ConfigureFunctionsWorkerDefaults((hostBuilderContext, workerAppBuilder) => {
   
           workerAppBuilder.UseDurableFunctionsMonitor((settings, extensionPoints) => 
           {
               // Override DfMon's settings here, e.g.
               settings.Mode = DfmMode.ReadOnly;
               // ....
           });
   
       })
       .Build();
   ```
   
   By default DfMon's endpoint will appear at `http://localhost:7071/my-api-route-prefix/durable-functions-monitor`. To override that behavior (e.g. to have it served from the root) add a custom statics-serving function like this:
   ```
   namespace DurableFunctionsMonitor.DotNetIsolated
   {
       public class MyCustomDfMonEndpoint: ServeStatics
       {
           public MyCustomDfMonEndpoint(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : 
               base(dfmSettings, extensionPoints, loggerFactory)
           {
           }
   
           [Function(nameof(MyCustomDfMonEndpoint))]
           public Task<HttpResponseData> ServeDfMonStatics(
               [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "/{p1?}/{p2?}/{p3?}")] HttpRequestData req,
               string p1,
               string p2,
               string p3
           )
           {
               return this.DfmServeStaticsFunction(req, p1, p2, p3);
           }
       }
   }
   ```

## Environment variables

| Variable | Effect |
|---|---|
| `DFM_NONCE` | set to `i_sure_know_what_i_am_doing` to disable authentication entirely (local development only) |
| `DFM_MODE` | `ReadOnly` hides every write action; anything else (or unset) is normal read/write mode |
| `DFM_DANGEROUS_OPERATIONS_ENABLED` | `true` allows Replay and Restart in place, which rewrite Task Hub storage and re-execute work that already ran |
| `DFM_AUDIT_ENABLED` | `true` records every write and dangerous call into the `{hub}DfmAudit` table, which the Activity screen and the `/audit` endpoint read |
| `DFM_STATS_CAP` | how many instance rows `/stats` and `/failures` scan before answering `partial: true` instead of scanning further (default 50000) |
| `DFM_AGGREGATION_CACHE_SECONDS` | how long `/stats`, `/failures` and `/storage` may serve a previously computed answer for the same query instead of scanning storage again (default 30; 0 disables caching) |
| `DFM_CUSTOM_TEMPLATES_FOLDER` | load custom tab templates, Function Maps and the custom meta tag from this folder instead of Azure Storage. A folder name (`dfm-templates`) is resolved next to your app; an absolute path is used as is. Same as `settings.CustomTemplatesFolderName` |

This package implements every capability, so all seven apply.

## Editing an instance's inputs

Besides what the UI offers, the backend can edit the inputs an orchestration instance received and re-run it from there. These endpoints live under `/a/p/i/{connName}-{hubName}/orchestrations('{instanceId}')/`, take and return JSON, and are not exposed by the UI yet.

* `GET input-events` lists the instance's input-bearing events (`ExecutionStarted` and every `EventRaised`) with their payloads, and says for each one which of the operations below applies, and why not otherwise. Send the returned `sequenceNumber` back to address an event.
* `POST input-events/update-input-and-rewind` with `{ "sequenceNumber": 27, "input": { ... }, "reason": "optional" }` replaces the input of the last input-bearing event of a **failed** instance and rewinds it. Only the failed steps run again, now seeing the edited input.
* `POST input-events/replay` with `{ "sequenceNumber": 27, "input": { ... }, "terminateIfRunning": false }` deletes the history from the last `EventRaised` event onward, reopens the instance and raises that event again with the same or an edited payload (`input` is optional), so that everything after the event runs again, activities and sub-orchestrations included. The instance must be in a terminal state, or `terminateIfRunning` must be set. It answers `409` when an activity or sub-orchestration scheduled before the event has no completion recorded before it (say, the event arrived while a `Task.WhenAll` activity was still running): after a replay the orchestrator would wait for that completion forever.
* `POST input-events/restart-in-place` with `{ "input": { ... } }` purges a **failed** instance that has not received any external events and starts it again under the same instance ID, with the same or an edited input (`input` is optional).

`replay` and `restart-in-place` rewrite Task Hub storage and re-execute work that already ran, so they are off by default and answer `403` until you enable them with `DFM_DANGEROUS_OPERATIONS_ENABLED=true` or `settings.DangerousOperationsEnabled = true`. They are never available in read-only mode or to read-only roles. When enabled, `/about` lists the `DurableFunctionsMonitor.DangerousOperations` permission.

Editing history is implemented for the default Azure Storage provider. Other providers get `400` from `update-input-and-rewind` and `replay` unless they supply `extensionPoints.GetHistoryEventInputRoutine`, `UpdateHistoryEventInputRoutine` and `TruncateHistoryRoutine`; `restart-in-place` works with any provider. Edited payloads must fit inline (60 KB). The design, the storage-engine behaviour it relies on and the risks (for one, a replayed instance can still receive late messages from its previous run) are written up in [docs/plans/input-events-restart-rewind-replay.md](https://github.com/ViswanathBalusu/DurableFunctionsMonitor/blob/main/docs/plans/input-events-restart-rewind-replay.md).

## Limitations

* Multiple Storage connection strings are not supported, only the default one (`AzureWebJobsStorage`).
* For non-default durability providers you'll need to provide custom routines for retrieving instance history etc. This should be done via **extensionPoints** parameter of **.UseDurableFunctionsMonitor()** configuration method. Code for MSSQL storage provider can be directly copied [from here](https://github.com/ViswanathBalusu/DurableFunctionsMonitor/blob/main/durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs), and for Netherite [from here](https://github.com/ViswanathBalusu/DurableFunctionsMonitor/blob/main/durablefunctionsmonitor.dotnetisolated.netherite/ExtensionMethods.cs).

