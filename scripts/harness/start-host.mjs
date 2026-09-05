#!/usr/bin/env node
// Builds and starts the standalone isolated host (durablefunctionsmonitor.dotnetisolated) with the
// Azure Functions Core Tools, then waits until /about answers. Used by `npm run host` and by the
// Playwright webServer entry. Requires: dotnet 10 SDK, `func` (azure-functions-core-tools@4) on PATH,
// and a storage emulator listening on the endpoints named in local.settings.json (Azurite by default).
//
//   node scripts/harness/start-host.mjs [--port=7072] [--hub=DurableFunctionsHub] [--no-build] [--project=<folder>]
//
// Environment passed through: DFM_DANGEROUS_OPERATIONS_ENABLED, DFM_AUDIT_ENABLED, DFM_INGRESS_ROUTE_PREFIX,
// DFM_STATS_CAP. Verified on Windows 11 (2026-09-05): process env wins over local.settings.json, so a
// second host on another port needs no settings file of its own -
//
//   DFM_DANGEROUS_OPERATIONS_ENABLED=false node scripts/harness/start-host.mjs --port=7073 --no-build
//
// answers /about with dangerousOperations false while the host on 7072 still answers true. Pass
// --no-build for the second host: two builds of the same project at once fight over the output dll.
//
// Custom templates and function maps: the standalone host has no environment variable for
// DfmSettings.CustomTemplatesFolderName (it is set in code, and Program.cs sets only the user agent),
// so there is nothing for a --custom-templates flag to set. Seed a function map as a blob instead -
// that is the path GetFunctionMapsFromStorageAsync reads, and it needs no host restart:
//
//   container: durable-functions-monitor
//   blob:      function-maps/dfm-func-map.<TaskHubName>.json   (or dfm-func-map.json for every hub)
//   content:   { "functions": { "<name>": { ... } }, "proxies": { ... } }
//
// with, against Azurite:
//   az storage blob upload --connection-string "UseDevelopmentStorage=true" //     -c durable-functions-monitor -n function-maps/dfm-func-map.DurableFunctionsHub.json -f map.json
//
// /about then reports templates.functionMapAvailable true and templates.functionCount.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);
const port = Number(args.port ?? 7072);
const hub = args.hub ?? process.env.DFM_E2E_HUB ?? 'DurableFunctionsHub';
const project = path.resolve(root, args.project ?? 'durablefunctionsmonitor.dotnetisolated');
const binDir = path.join(project, 'bin', 'Debug', 'net10.0');
const isWin = process.platform === 'win32';

if (!fs.existsSync(path.join(project, 'local.settings.json'))) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'harness', 'write-local-settings.mjs'), `--project=${project}`], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (args['no-build'] !== 'true') {
  console.log(`building ${project} ...`);
  const b = spawnSync('dotnet', ['build', project, '-c', 'Debug', '--nologo', '-v', 'q'], { stdio: 'inherit', shell: isWin });
  if (b.status !== 0) {
    console.error('dotnet build failed');
    process.exit(b.status ?? 1);
  }
}

if (!fs.existsSync(path.join(binDir, 'DfmStatics', 'index.html'))) {
  console.warn(`warning: ${path.join(binDir, 'DfmStatics', 'index.html')} not found. Run "npm run build-and-copy" in durablefunctionsmonitor.svelte first, then rebuild.`);
}

const env = { ...process.env };
// Explicit env wins over local.settings.json (the Functions host reads both; env takes precedence).
const funcArgs = ['host', 'start', '--port', String(port)];
console.log(`starting func ${funcArgs.join(' ')} in ${binDir}`);
const child = spawn(isWin ? 'func.cmd' : 'func', funcArgs, { cwd: binDir, env, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('exit', (code) => {
  console.log(`func exited with ${code}`);
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
  });
}

const aboutUrl = `http://localhost:${port}/durable-functions-monitor/a/p/i/--${hub}/about`;
const deadline = Date.now() + 120_000;
(async () => {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(aboutUrl, { headers: { 'x-dfm-nonce': 'i_sure_know_what_i_am_doing' } });
      if (r.ok) {
        console.log(`host ready: ${aboutUrl}`);
        console.log(`open http://localhost:${port}/durable-functions-monitor/${hub}`);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  console.error(`host did not answer ${aboutUrl} within 120 s`);
  child.kill('SIGTERM');
  process.exit(1);
})();
