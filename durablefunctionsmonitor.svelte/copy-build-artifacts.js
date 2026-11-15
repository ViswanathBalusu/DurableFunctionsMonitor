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
//
// Node does both steps itself (fs.rm and fs.cp, stable since Node 22, which is what "engines" asks
// for), so this needs no package: it used to take rimraf and ncp to do the same.

import { cp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const buildFolder = fileURLToPath(new URL('./build', import.meta.url));
const outputFolder = fileURLToPath(new URL('../durablefunctionsmonitor.dotnetisolated/DfmStatics', import.meta.url));

try {
  // Fails here, with the old statics still in place, when there is no build to copy
  if (!(await stat(buildFolder)).isDirectory()) {
    throw new Error(`${buildFolder} is not a folder`);
  }

  await rm(outputFolder, { recursive: true, force: true });
  await cp(buildFolder, outputFolder, { recursive: true });
} catch (err) {
  console.error(`Failed to copy ${buildFolder} to ${outputFolder}`);
  console.error(err);
  process.exit(1);
}

console.log(`Copied ${buildFolder} to ${outputFolder}`);
