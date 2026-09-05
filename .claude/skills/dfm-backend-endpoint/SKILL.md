---
name: dfm-backend-endpoint
description: How to add or change an endpoint in durablefunctionsmonitor.dotnetisolated.core (Azure Functions isolated, .NET 10) the DfMon way - function class skeleton, OperationKind, routes, exceptions to status codes, ITableClient and Azure.Data.Tables queries, DfmExtensionPoints routines for MSSQL/Netherite, DTO serialisation, MSTest+Moq unit tests and Azurite integration tests. Use for every B0-B5 task and any backend change.
---

# DFM backend endpoint conventions

Core project: `durablefunctionsmonitor.dotnetisolated.core`. Tests: `tests/durablefunctionsmonitor.dotnetisolated.core.tests` (MSTest 4, Moq; `ImplicitUsings` off) and `tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests` (Azurite; `StorageEmulator.SkipIfUnavailable()` in every test). Contracts for the response shapes: `docs/plans/svelte-rewrite/00-shared-contracts.md` §6.

## Function skeleton

```csharp
// Functions/Stats.cs
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    public class Stats : DfmFunctionBase
    {
        public Stats(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Stats>();
        }

        // GET /a/p/i/{connName}-{hubName}/stats?from&to&bins
        [Function(nameof(DfmGetStatsFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetStatsFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/stats")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName)
        {
            if (this.ExtensionPoints.GetStatsRoutine == null)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, "Hub statistics are not supported for this storage provider");
            }

            var query = RangeQuery.Parse(req);   // throws DfmBadRequestException on bad input
            string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

            var result = await AggregationCache.GetOrAddAsync($"stats|{connEnvVariableName}|{hubName}|{query.CacheKey}", this.Settings.AggregationCacheTtl,
                () => this.ExtensionPoints.GetStatsRoutine(durableClient, connEnvVariableName, hubName, query, CancellationToken.None));

            return await req.ReturnJson(result);
        }

        private readonly ILogger _logger;
    }
}
```

- Every DfMon function: `[Function(nameof(...))]` + `[OperationKind(...)]` (`Read`, `Write`, `Dangerous`) + route under `Globals.ApiRoutePrefix`. The middleware in `Common/ExtensionMethods.cs` finds the attribute by reflection and applies auth, read-only mode, the dangerous flag and task hub validation. Functions without the attribute bypass DfMon auth: never omit it.
- `AuthTests.AllModifyingFunctionsAreMarkedAsOperationKindWrite` enumerates functions; add new Write/Dangerous functions to its expected lists.
- Return JSON with `req.ReturnJson(obj)` (camelCase, enums as strings, `yyyy-MM-ddTHH:mm:ssZ` dates); plain statuses with `req.ReturnStatus(code, text)`. History uses its own `HistorySerializerSettings` (PascalCase) - keep that.
- Typed failures: throw `DfmBadRequestException` (400), `DfmNotFoundException` (404), `DfmConflictException` (409), `DfmPayloadTooLargeException` (413), `DfmNotSupportedException` (400) and map them in an `ExecuteAsync` wrapper like `Functions/InputEvents.cs` does. Unhandled exceptions become 400 through the middleware, so map deliberately.
- Instance ids: `ExpandedOrchestrationStatus.TryGetEntityInstanceId(id, out _)` tells an entity from an orchestration. Reject entities with 400 where an operation is orchestration-only.

## Storage access

- Tables: `TableClient.GetTableClient(connEnvVariableName)` returns `ITableClient` (mockable through `TableClient.MockedTableClient`). Build filters with `Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey eq {id} and ExecutionId eq {exec}")` so values are escaped. Table names: `{hub}Instances`, `{hub}History`, `{hub}Partitions`, `{hub}DfmAudit`. History row keys are `sequenceNumber.ToString("X16")`; the `sentinel` row sorts last.
- Blobs: `Globals.GetBlobServiceClient(connEnvVariableName)`; large payloads via `LargeMessageBlobs` (`IsUrl`, `DownloadByUrlAsync`, `DownloadByNameAsync`, `TryDeleteByNameAsync`); container `{hub lower}-largemessages`.
- Queues (B4): `Globals.GetQueueServiceClient` (same connection-string / identity pattern as blobs).
- Bounded scans: use the projected, capped `ITableClient.QueryAsync(table, filter, select, maxRows, ct)` (B1-S1-T2) and report `scanned`/`partial`. Never load a whole table unbounded.
- Cache per hub and query with `AggregationCache` (B1-S1-T1); key includes the connection env var name and the hub.

## Provider routines

Anything that touches provider storage directly goes through a `Func<...>` on `DfmExtensionPoints` with the Azure Storage implementation as the default in its constructor. The MSSQL package (`durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs`) and the Netherite package set their own implementation or `null`. A `null` routine means "unsupported": the function answers 400 and `Capabilities.Compute` reports `false`, so the UI hides the feature. Both packages must compile after every change to `DfmExtensionPoints`.

## Settings and environment

New switches: a property on `DfmSettings` initialised in its constructor from `EnvVariableNames.<NAME>` (add the constant in `Common/Globals.cs`), parsed with the "literal `true`, any casing" rule used by `DangerousOperationsEnabled`, documented in the README. Empty string equals unset (.NET 10 keeps empty env vars).

## Tests

Unit (no storage):

```csharp
[TestClass]
public class StatsFunctionTests
{
    [TestInitialize] public void Init() { TableClient.MockedTableClient = null; }

    [TestMethod]
    public async Task ReturnsBadRequestWhenRoutineIsNull()
    {
        var settings = new DfmSettings();
        var ext = new DfmExtensionPoints { GetStatsRoutine = null };
        var func = new Stats(settings, ext, new LoggerFactory());
        var req = new FakeHttpRequestData(new Uri("http://localhost/a/p/i/--hub/stats?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z"));

        var resp = await func.DfmGetStatsFunction(req, new FakeDurableTaskClient(), "-", "hub");

        Assert.AreEqual(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
```

`Shared.cs` has `FakeHttpRequestData`, `FakeHttpResponseData`, `FakeFunctionContext`, `FakeDurableTaskClient`; extend the fake client with overrides you need. Read a response body with `resp.Body.Position = 0; new StreamReader(resp.Body).ReadToEnd()`.

Pure aggregation logic (span builder, stats aggregator, signatures, operation naming) lives in `Common/*.cs` static classes with no storage access and gets table-driven tests.

Integration (Azurite): copy the pattern of `OrchestrationHistoryEditorTests` - a fresh hub name per test class (`"DfmTest" + Guid`), `StorageEmulator.SkipIfUnavailable()` first, seed rows with `TableEntity` exactly as the engine writes them (see that file's `Row`, `SeedInstanceAsync`, sentinel), point `Globals.StorageConnStringEnvVarName`-style env vars at `StorageEmulator.ConnectionString`, clean up tables in `[TestCleanup]`. CI runs these with `DFM_TEST_REQUIRE_STORAGE=true` so an unreachable emulator fails the build.

Run: `dotnet build DurableFunctionsMonitor.slnx`, `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.tests`, `npx azurite --silent --location .azurite` then `dotnet test tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests`.

## Checklist before marking a backend task done

- [ ] Route, verb and `OperationKind` match the plan; `AuthTests` lists updated.
- [ ] Response shape equals contracts §6 exactly (property names, nullability, camelCase).
- [ ] `Capabilities.Compute` reports the feature; `/about` test updated.
- [ ] MSSQL and Netherite packages compile and set their routine (or `null`).
- [ ] Bounded scan with `scanned`/`partial`; cache where the plan says.
- [ ] Unit tests for every validation branch; Azurite test for every storage path.
- [ ] README documents any new environment variable.
