# B4 · /storage and /entities

Goal: storage health for the Azure Storage provider (queue depths, partition ownership, task hub info, large-message container) and an entities listing with parsed state.

Prerequisites: B0, B1 (cache). Read contracts §6 (`StorageResponse`, `EntitiesResponse`); `Common/Globals.cs` (`GetBlobServiceClient`), `Common/TableClient.cs`, `Functions/Orchestrations.cs` (`ListDurableEntities`), `Functions/Orchestration.cs` (entity details).

Exit criteria: `GET /storage` works against Azurite with the e2e seed (queues and `taskhub.json` present), `GET /entities` returns parsed state, capabilities flip to true for Azure Storage and `entities` for every provider.

### B4-S1 Queue client and storage health

#### B4-S1-T1 Azure.Storage.Queues client
Files: `durablefunctionsmonitor.dotnetisolated.core/durablefunctionsmonitor.dotnetisolated.core.csproj`, `Common/Globals.cs`
Depends: none
Do:
1. Add `<PackageReference Include="Azure.Storage.Queues" Version="12.27.1" />`.
2. `Globals.GetQueueServiceClient(connStringName)`: connection string or identity-based (`{conn}__queueServiceUri` / `{conn}__accountName` → `https://{account}.queue.core.windows.net`), same pattern and `ApplyCustomUserAgent` as `GetBlobServiceClient`.
Accept:
- [ ] Build; unit test that the identity path builds the expected URI.
Test: `GlobalsTests` extension.

#### B4-S1-T2 Storage health routine (Azure Storage)
Files: `Common/StorageHealth.cs` (new), `Common/DfmExtensionPoints.cs` (default), `tests/…integrationtests/StorageHealthTests.cs`, `tests/…core.tests/StorageHealthParsingTests.cs`
Depends: B4-S1-T1, B1-S1-T2
Do:
1. `StorageHealth.GetAsync(connEnvVar, hub, counts, instanceId, ct)` → `StorageHealthResult` matching contracts §6:
   - `taskHub`: blob `{hub.ToLowerInvariant()}-leases/taskhub.json` parsed for `PartitionCount` and `CreatedAt` (`source: taskhub.json`); missing → `partitionCount null`, `source unknown`.
   - `queues`: `{hub lower}-workitems` and `{hub lower}-control-{NN:00}` for `NN < partitionCount ?? 4`; `GetPropertiesAsync().ApproximateMessagesCount`; a missing queue → `null` count.
   - `partitions`: table `{hub}Partitions` when it exists: one row per partition; map columns by name with tolerant lookup: owner ← `CurrentOwner`, next owner ← `NextOwner`, owned since ← `OwnedSince`, draining ← `IsDraining`; `source table`. Otherwise lease blobs `{hub lower}-leases/{hub lower}-control-NN`: owner from blob metadata `owner`, since from `LastModified`, `source lease-blob`. Neither → `source none`. Put a comment that the column names are those of `DurableTask.AzureStorage` table partition manager and a unit test parses a captured row shape (`StorageHealthParsingTests`), so a schema change fails visibly.
   - `tables`: names; `partitions`/`audit` null when the table does not exist (`ListTableNamesAsync`).
   - `largeMessages`: container `{hub lower}-largemessages` exists; with `instanceId` list blobs with prefix `{instanceId}/` → `blobCount`, `totalBytes`; without, both null.
   - `counts`: only when `counts == true`: projected scans (`select PartitionKey`) of Instances and History with `maxRows = 200000`, `partial` when truncated; else nulls.
2. Default routine on `DfmExtensionPoints`; MSSQL and Netherite set `null`.
Accept:
- [ ] Azurite: after the e2e seed, queues return five entries with counts, `taskHub.partitionCount == 4`, partitions from a seeded `{hub}Partitions` table with the tolerant columns.
Test: as above.

#### B4-S1-T3 GET /storage
Files: `Functions/Storage.cs`, `tests/…core.tests/StorageFunctionTests.cs`
Depends: B4-S1-T2, B1-S1-T1
Do:
1. Read function; query `counts` (bool) and `instanceId` (optional); cache key excludes `counts=false` vs `true` (two entries) with the standard TTL; null routine → 400. `accountName` from the connection string like `About` does; `provider = ext.ProviderName`.
Accept:
- [ ] Unit tests: null routine → 400; `counts=true` reaches the routine with `counts` true.
Test: as above.

### B4-S2 Entities

#### B4-S2-T1 GET /entities
Files: `Functions/Entities.cs`, `Common/EntityState.cs` (parsing), `tests/…core.tests/EntitiesFunctionTests.cs`, `tests/…core.tests/EntityStateTests.cs`
Depends: B0-S2-T1
Do:
1. Read function, route `Globals.ApiRoutePrefix + "/entities"`. Query: `name` (entity name, optional), `keyPrefix` (optional), `updatedFrom`/`updatedTo` (optional ISO), `$top` (default 50, max 200), `$skip`.
2. List with `client.Entities.GetAllEntitiesAsync(new EntityQuery { InstanceIdStartsWith = name != null ? $"@{name.ToLowerInvariant()}@{keyPrefix}" : null, LastModifiedFrom, LastModifiedTo, IncludeState = false, IncludeTransient = true, PageSize = 200 })`; when only `keyPrefix` is given filter client-side on `Id.Key`. Apply skip/top, read one extra for `hasMore`.
3. For the page, fetch state per entity with `client.Entities.GetEntityAsync(id, includeState: true)` under `SemaphoreSlim(8)`; failures → `state null`, `stateError = ex.Message` (large states fail this call today, `Orchestrations.cs` comment). `EntityState.Parse(string serialized)` → JToken (unwrap the `{"exists":..,"state":"..."}` envelope when present, same as `DetailedOrchestrationStatus.ConvertInput`), `stateSummary` = single-line JSON truncated to 120 characters.
4. Rows: `instanceId = id.ToString()`, `entityName = id.Name`, `key = id.Key`, `lastUpdatedTime = LastModifiedTime`, `runtimeStatus = Running` (what the list endpoint reports today).
5. `Capabilities.entities = true` (B0-S2-T1 placeholder flips here).
Accept:
- [ ] Unit tests with a fake entities client: name filter builds the prefix; `hasMore` on a full page; a state fetch failure yields `stateError` and a null state.
Test: as above.
