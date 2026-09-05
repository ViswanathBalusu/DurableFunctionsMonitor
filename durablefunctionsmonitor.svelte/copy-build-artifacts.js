// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Places the production build into the host project, where ServeStatics.cs serves it from.
// `npm run build-and-copy` (vite build + this script) is what puts the statics into
// durablefunctionsmonitor.dotnetisolated/DfmStatics; durablefunctionsmonitor.svelte.esproj runs
// that script from `dotnet build`, so the Dockerfiles, CI and the VS Code extension all get the
// statics without anyone running npm by hand.
//
// Differences from the React script this is ported from: the whole DfmStatics folder is wiped
// first (not just static/), the whole build/ folder is copied in one go, there is no
// service-worker.js to copy, and the .map files are copied along with everything else.

import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ncp from 'ncp';
import { rimraf } from 'rimraf';

const buildFolder = fileURLToPath(new URL('./build', import.meta.url));
const outputFolder = fileURLToPath(new URL('../durablefunctionsmonitor.dotnetisolated/DfmStatics', import.meta.url));

const copy = promisify(ncp);

try {
  await rimraf(outputFolder);
  await copy(buildFolder, outputFolder);
} catch (err) {
  console.error(`Failed to copy ${buildFolder} to ${outputFolder}`);
  console.error(err);
  process.exit(1);
}

console.log(`Copied ${buildFolder} to ${outputFolder}`);
