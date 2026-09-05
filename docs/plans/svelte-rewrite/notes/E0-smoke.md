# E0-S5 smoke: the placeholder app in both hosts

What was run, what was seen, and the two things that surprised us. Dates are the run of E0-S5-T1
(2026-09-05, Windows 11, .NET SDK 10.0.400, func 4.126.0, Node 22.23.2, Azurite 3.x).

## E0-S5-T1 Standalone host

Steps, exactly as run:

```
npx azurite --silent --location .azurite            # repo root, left running
cd durablefunctionsmonitor.svelte && npm run build-and-copy
node scripts/harness/write-local-settings.mjs --force
node scripts/harness/start-host.mjs --port=7072      # builds, then `func host start`
```

`start-host.mjs` writes `local.settings.json` when it is missing, so the second step above is only
needed to change what is in it. The file it wrote:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "DFM_NONCE": "i_sure_know_what_i_am_doing",
    "DFM_DANGEROUS_OPERATIONS_ENABLED": "true",
    "DFM_AUDIT_ENABLED": "true"
  }
}
```

### What was seen

- `GET /durable-functions-monitor/DurableFunctionsHub` → 200, the built `index.html`, with the asset
  links rewritten to `/durable-functions-monitor/static/js/main.<hex>.js` and
  `/durable-functions-monitor/static/css/main.<hex>.css`, the manifest and favicon likewise, and all
  seven placeholder tags replaced (`DfmRoutePrefix="durable-functions-monitor"`,
  `DfmApiRoutePrefix="durable-functions-monitor/a/p/i"`, `DfmClientConfig={}`, `DfmViewMode=0`,
  `IsFunctionGraphAvailable=1`, `OrchestrationIdFromVsCode=""`, `StateFromVsCode={}`).
- `GET /durable-functions-monitor/DurableFunctionsHub/instances/some-id` → 200, the same document:
  the backend serves `index.html` for every path under the hub, which is what the hand-rolled router
  (D1) relies on.
- `GET .../a/p/i/--DurableFunctionsHub/about` → 200 with `provider: "AzureStorage"`,
  `readOnly: false`, `dangerousOperations: true` and every B1-B5 capability true
  (`stats`, `failures`, `spans`, `children`, `batch`, `storageHealth`, `audit`, `entities`).
- Every new endpoint answers on an empty hub: `/stats` (48 bins, all zero), `/failures`
  (`groups: []`, `cap: 50000`), `/storage` (task hub, five queues, four unknown partitions),
  `/entities` (`entities: []`), `/audit` (`rows: []`, `enabled: true`).

### Surprise 1: an unknown Task Hub answers 401, not 404

Before anything was seeded, `/about` came back **401 Unauthorized**, with and without the nonce header.
That is `Auth.ThrowIfUriTaskHubNameIsInvalid`: it lists the tables of the storage account and rejects a
hub whose `XXXInstances`/`XXXHistory` pair does not exist. On a brand-new Azurite there are none, so
every hub name is "not allowed".

Creating the two tables is enough (the e2e seed of E3-S2-T1 does this as a side effect):

```js
const { TableServiceClient } = require('@azure/data-tables');
const svc = TableServiceClient.fromConnectionString('UseDevelopmentStorage=true');
await svc.createTable('DurableFunctionsHubInstances');
await svc.createTable('DurableFunctionsHubHistory');
```

Worth remembering when a fresh machine reports 401 from a host that is otherwise healthy: it is the
Task Hub check, not authentication.

### Surprise 2: `accountName` is empty against Azurite

`/about` reports `accountName: ""` because `UseDevelopmentStorage=true` carries no `AccountName=` for
`About`'s regex to find. Nothing is broken - the document title just reads
`Durable Functions Monitor (/DurableFunctionsHub) v6.9.0.0 (isolated)` locally. Spelling the emulator
connection string out in full (`AccountName=devstoreaccount1;...`) makes it appear.

### With an ingress prefix

```
DFM_INGRESS_ROUTE_PREFIX=proxy node scripts/harness/start-host.mjs --port=7073 --no-build
```

`GET /durable-functions-monitor/DurableFunctionsHub` on that host returns the same document with every
root-absolute link moved under the prefix - `/proxy/durable-functions-monitor/static/js/main.<hex>.js`,
`/proxy/durable-functions-monitor/manifest.json` - and both globals rewritten
(`DfmRoutePrefix="proxy/durable-functions-monitor"`,
`DfmApiRoutePrefix="proxy/durable-functions-monitor/a/p/i"`). This is what the build contract's
root-absolute asset rule buys: no relative URL to break when a reverse proxy adds a path segment.

## E0-S5-T2 VS Code webview

Not run in this session: it needs the interactive extension host (F5) and a human at the keyboard.
The three things it has to establish, for whoever runs it:

1. `durableFunctionsMonitor.customPathToBackendBinaries` pointing at
   `durablefunctionsmonitor.dotnetisolated/bin/Debug/net10.0` (it must contain `DfmStatics`, which
   `npm run build-and-copy` puts there).
2. The placeholder renders inside the webview and prints `host vscode`, and a theme chosen there
   survives closing and reopening the panel (the PersistState round trip of `PrefsStorage`).
3. "Go to instanceId…" opens the instance route (`OrchestrationIdFromVsCode` is read once by the
   router in memory mode).

E12 repeats it as a release check.
