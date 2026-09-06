# DurableFunctionsMonitor.DotNetIsolated.MsSql

An incarnation of DurableFunctionsMonitor that can be "injected" into your [.NET Isolated](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) Azure Function, that uses [Durable Task SQL Provider](https://microsoft.github.io/durabletask-mssql/#/).

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

`/about` reports what this package's `DfmExtensionPoints` implement against a SQL Task Hub (`[schema].Instances` / `[schema].History`, `dt` by default):

* Stats, Children, and the orchestrator lane of the Timeline (episode markers) are supported.
* Failures and Storage health are not supported: `/failures` and `/storage` answer `400`, so those screens do not appear.
* The audit trail is not supported: this package does not wire up an audit store, so `/audit` always answers with auditing reported as off, regardless of `DFM_AUDIT_ENABLED`.
* Update input & rewind and Replay (truncate history) are not supported; editing an instance's history is only implemented for the default Azure Storage provider, so `update-input-and-rewind` and `replay` answer `400` here.
* Spans, bulk instance operations, Entities, purge history and conditional GET (ETag, on instance details and history) are always on, independent of the storage provider.
* Purging entities (the entity branch of `/purge-history`), cleaning entity storage and deleting a task hub are not implemented by this backend yet, on any provider; those calls answer `400`.

## How to use

* Install from NuGet:
   ```
   dotnet add package DurableFunctionsMonitor.DotNetIsolated.MsSql
   ```
* Initialize by calling **.UseDurableFunctionsMonitorWithMsSqlDurability()** extension method during your Function's startup, like this:
   ```
  var host = new HostBuilder()
      .ConfigureFunctionsWorkerDefaults((hostBuilderContext, workerAppBuilder) => {

          workerAppBuilder.UseDurableFunctionsMonitorWithMsSqlDurability();

      })
      .Build();
   ```


   By default all settings are read from env variables ([all the same config settings](https://github.com/microsoft/DurableFunctionsMonitor/wiki/Config-Settings-Reference) are supported), but those can be programmatically (re)configured like this:
   ```
   var host = new HostBuilder()
       .ConfigureFunctionsWorkerDefaults((hostBuilderContext, workerAppBuilder) => {
   
           workerAppBuilder.UseDurableFunctionsMonitorWithMsSqlDurability((settings) => 
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
| `DFM_STATS_CAP` | how many instance rows `/stats` and `/failures` scan before answering `partial: true` instead of scanning further (default 50000) |
| `DFM_AGGREGATION_CACHE_SECONDS` | how long `/stats` may serve a previously computed answer for the same query instead of scanning storage again (default 30; 0 disables caching) |

`DFM_AUDIT_ENABLED` has no effect on this package: there is no SQL-backed audit store, so `/audit` reports auditing as off either way.
