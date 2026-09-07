# DurableFunctionsMonitor.DotNetIsolated.Netherite

An incarnation of DurableFunctionsMonitor that can be "injected" into your [.NET Isolated](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) Azure Function, that uses [Netherite Provider](https://microsoft.github.io/durabletask-netherite/#/).

## What you get

The same Svelte UI ships in every DurableFunctionsMonitor package. Once wired into your Function App, it gives you:

* **Overview** — status tiles, a throughput histogram whose brush sets the time range, "needs attention" (failures in range, instances running or pending longer than your thresholds, a queue backing up, anything suspended), the top orchestrators with p50/p95 duration and failure rate, a storage backlog panel and recent activity.
* **Instances** — table, timeline and histogram views over the same OData-backed filters, saved views, and bulk actions (terminate, suspend, resume, rewind, raise event, purge) over the selection, 200 instances per call.
* **Instance workspace** — Timeline (a swimlane of activities, sub-orchestrations, timers and events), History, Inputs, a Sequence diagram, the function Graph, Raw JSON, a Summary of where the time went, and any custom Liquid tabs the hub publishes.
* **Failures** — failed instances grouped by orchestrator and by a normalised error signature (numbers, GUIDs, quoted values and hashes collapsed to `*`).
* **Entities** — the durable entities of the hub, filterable by name and key prefix.
* **Storage** — the tables, queues and control-queue partitions behind the task hub.
* **Activity** — an audit trail of every write and dangerous operation made through the UI.
* **Settings** — seven visual themes, light/dark/system mode, density, whether times are shown as UTC or local, and the "needs attention" thresholds.

The UI asks `/about` once and turns each screen and button on or off from what the backend reports it can do — see Capabilities below. Every JSON payload it shows is pretty-printed and fully expanded, never a truncated preview.

## Capabilities

`/about` reports what this package's `DfmExtensionPoints` implement against a Netherite Task Hub. Netherite keeps its state in Event Hubs partitions and FASTER stores rather than the `XXXInstances`/`XXXHistory` tables or the control queues most of these features read, so:

* Stats, Failures, Children, Storage health, Update input & rewind and Replay (truncate history) are all unsupported; the corresponding endpoints answer `400`.
* The orchestrator lane of the Timeline (episode markers) is unsupported too, but `/spans` still answers `200`: the orchestrator lane is just empty and `totals.orchestratorMs` is `null`.
* The audit trail is supported: this package leaves the default Azure Table audit store wired up, so setting `DFM_AUDIT_ENABLED=true` turns it on, using the same Storage account Netherite already needs for its `DurableTaskPartitions` table.
* Spans, bulk instance operations, Entities, purge history and conditional GET (ETag, on instance details and history) are always on, independent of the storage provider.
* Purging entities (the entity branch of `/purge-history`), cleaning entity storage and deleting a task hub are not implemented by this backend yet, on any provider; those calls answer `400`.

## How to use

* Install from NuGet:
   ```
   dotnet add package DurableFunctionsMonitor.DotNetIsolated.Netherite
   ```
* Initialize by calling **.UseDurableFunctionsMonitorWithNetheriteDurability()** extension method during your Function's startup, like this:
   ```
  var host = new HostBuilder()
      .ConfigureFunctionsWorkerDefaults((hostBuilderContext, workerAppBuilder) => {

          workerAppBuilder.UseDurableFunctionsMonitorWithNetheriteDurability();

      })
      .Build();
   ```


   By default all settings are read from env variables ([all the same config settings](https://github.com/microsoft/DurableFunctionsMonitor/wiki/Config-Settings-Reference) are supported), but those can be programmatically (re)configured like this:
   ```
   var host = new HostBuilder()
       .ConfigureFunctionsWorkerDefaults((hostBuilderContext, workerAppBuilder) => {
   
           workerAppBuilder.UseDurableFunctionsMonitorWithNetheriteDurability((settings) => 
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
| `DFM_DANGEROUS_OPERATIONS_ENABLED` | `true` allows Restart in place, which rewrites Task Hub storage and re-executes work that already ran (Replay stays unsupported on this provider regardless) |
| `DFM_AUDIT_ENABLED` | `true` records every write and dangerous call into the `{hub}DfmAudit` table, which the Activity screen and the `/audit` endpoint read |
| `DFM_CUSTOM_TEMPLATES_FOLDER` | load custom tab templates, Function Maps and the custom meta tag from this folder instead of Azure Storage. A folder name (`dfm-templates`) is resolved next to your app; an absolute path is used as is. Same as `settings.CustomTemplatesFolderName` |

`DFM_STATS_CAP` and `DFM_AGGREGATION_CACHE_SECONDS` have no effect on this package: `/stats`, `/failures` and `/storage` are unsupported here, so there is nothing to cap or cache.

## Notes on Task Hub discovery

Netherite does not maintain the `XXXInstances`/`XXXHistory` tables that DfMon's default Task Hub discovery routine looks for. This package therefore replaces `DfmExtensionPoints.GetTaskHubNamesRoutine` with one that reads distinct partition keys from Netherite's own `DurableTaskPartitions` table. Both connection-string and identity-based (`AzureWebJobsStorage__accountName`) Storage connections are supported.
