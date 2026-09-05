#!/usr/bin/env node
// Writes durablefunctionsmonitor.dotnetisolated/local.settings.json for local development and e2e runs.
// The file is gitignored (it may hold connection strings). Existing files are kept unless --force is given.
//
//   node scripts/harness/write-local-settings.mjs [--force] [--dangerous=false] [--audit=false] [--ingress-prefix=proxy]
//                                                [--storage="<connection string>"] [--project=<folder>]
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

const project = path.resolve(root, args.project ?? 'durablefunctionsmonitor.dotnetisolated');
const file = path.join(project, 'local.settings.json');

if (fs.existsSync(file) && args.force !== 'true') {
  console.log(`kept existing ${file} (use --force to overwrite)`);
  process.exit(0);
}

const values = {
  AzureWebJobsStorage: args.storage ?? process.env.DFM_TEST_STORAGE_CONNECTION_STRING ?? 'UseDevelopmentStorage=true',
  FUNCTIONS_WORKER_RUNTIME: 'dotnet-isolated',
  // The magic nonce disables authentication (Auth.ISureKnowWhatIAmDoingNonce). Local use only.
  DFM_NONCE: 'i_sure_know_what_i_am_doing',
  DFM_DANGEROUS_OPERATIONS_ENABLED: args.dangerous === 'false' ? 'false' : 'true',
  DFM_AUDIT_ENABLED: args.audit === 'false' ? 'false' : 'true',
};
if (args['ingress-prefix']) values.DFM_INGRESS_ROUTE_PREFIX = args['ingress-prefix'];
if (args['stats-cap']) values.DFM_STATS_CAP = String(args['stats-cap']);

fs.writeFileSync(file, JSON.stringify({ IsEncrypted: false, Values: values }, null, 2) + '\n');
console.log(`wrote ${file}`);
