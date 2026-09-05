# DurableFunctionsMonitor.DotNetIsolated.Core

An incarnation of DurableFunctionsMonitor that can be "injected" into your [.NET 10 Isolated](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide) Azure Function.

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

## Editing an instance's inputs

Besides what the UI offers, the backend can edit the inputs an orchestration instance received and re-run it from there. These endpoints live under `/a/p/i/{connName}-{hubName}/orchestrations('{instanceId}')/`, take and return JSON, and are not exposed by the UI yet.

* `GET input-events` lists the instance's input-bearing events (`ExecutionStarted` and every `EventRaised`) with their payloads, and says for each one which of the operations below applies, and why not otherwise. Send the returned `sequenceNumber` back to address an event.
* `POST update-input-and-rewind` with `{ "sequenceNumber": 27, "input": { ... }, "reason": "optional" }` replaces the input of the last input-bearing event of a **failed** instance and rewinds it. Only the failed steps run again, now seeing the edited input.
* `POST replay` with `{ "sequenceNumber": 27, "input": { ... }, "terminateIfRunning": false }` deletes the history from the last `EventRaised` event onward, reopens the instance and raises that event again with the same or an edited payload (`input` is optional), so that everything after the event runs again, activities and sub-orchestrations included. The instance must be in a terminal state, or `terminateIfRunning` must be set.
* `POST restart-in-place` with `{ "input": { ... } }` purges a **failed** instance that has not received any external events and starts it again under the same instance ID, with the same or an edited input (`input` is optional).

`replay` and `restart-in-place` rewrite Task Hub storage and re-execute work that already ran, so they are off by default and answer `403` until you enable them with `DFM_DANGEROUS_OPERATIONS_ENABLED=true` or `settings.DangerousOperationsEnabled = true`. They are never available in read-only mode or to read-only roles. When enabled, `/about` lists the `DurableFunctionsMonitor.DangerousOperations` permission.

Editing history is implemented for the default Azure Storage provider. Other providers get `400` from `update-input-and-rewind` and `replay` unless they supply `extensionPoints.GetHistoryEventInputRoutine`, `UpdateHistoryEventInputRoutine` and `TruncateHistoryRoutine`; `restart-in-place` works with any provider. Edited payloads must fit inline (60 KB). The design, the storage-engine behaviour it relies on and the risks (for one, a replayed instance can still receive late messages from its previous run) are written up in [docs/plans/input-events-restart-rewind-replay.md](../docs/plans/input-events-restart-rewind-replay.md).

## Limitations

* Multiple Storage connection strings are not supported, only the default one (`AzureWebJobsStorage`).
* For non-default durability providers you'll need to provide custom routines for retrieving instance history etc. This should be done via **extensionPoints** parameter of **.UseDurableFunctionsMonitor()** configuration method. Code for MSSQL storage provider can be directly copied [from here](https://github.com/microsoft/DurableFunctionsMonitor/blob/main/durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs), and for Netherite [from here](https://github.com/microsoft/DurableFunctionsMonitor/blob/main/durablefunctionsmonitor.dotnetisolated.netherite/ExtensionMethods.cs).

