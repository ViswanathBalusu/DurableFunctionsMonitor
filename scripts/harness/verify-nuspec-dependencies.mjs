#!/usr/bin/env node
// Verifies that every NuGet package this repo ships declares the packages its own assemblies need.
//
//   node scripts/harness/verify-nuspec-dependencies.mjs
//
// Why this exists
// ---------------
// The three shipping packages are built with `nuget pack <nuspec>` (.github/workflows/build.yml),
// not `dotnet pack`. Packing a hand-written .nuspec infers NOTHING: NuGet copies the files listed in
// <files> and writes the <dependencies> list verbatim. A consumer doing `dotnet add package
// DurableFunctionsMonitor.DotNetIsolated` gets lib/net10.0/durablefunctionsmonitor.dotnetisolated.core.dll
// plus exactly the packages named in <dependencies> - nothing else.
//
// So a <PackageReference> added to a library .csproj and not mirrored into the .nuspec produces a
// package that restores and builds cleanly and then throws at runtime, the first time a code path
// touching the missing assembly is JITted:
//
//   System.IO.FileNotFoundException: Could not load file or assembly 'Azure.Storage.Queues,
//   Version=12.27.1.0, Culture=neutral, PublicKeyToken=...'
//
// That is exactly what happened: B4-S1-T1 added Azure.Storage.Queues 12.27.1 to
// durablefunctionsmonitor.dotnetisolated.core.csproj for the /storage endpoint and no .nuspec was
// updated, so StorageHealth.GetAsync blew up in every app that installed the package.
//
// The rule enforced here
// ----------------------
// For each source .nuspec (one that lives next to a .csproj - the copies under
// durablefunctionsmonitor-vscodeext/ are build output, not source):
//
//   1. every .dll it packs into lib/ maps to a .csproj in this repo, and
//   2. every direct <PackageReference> of those .csproj files is declared as a <dependency>, at a
//      version no lower than the one the project builds against.
//
// (2) covers the missing-assembly failure. The version floor covers its sibling: a floor below what
// the assembly was compiled against lets NuGet resolve an older DLL, and the .NET assembly loader
// never binds down - same exception, different cause.
//
// Dependencies declared beyond that rule are fine and reported as notes: they are the packages the
// consumer's own Function App needs (Worker.Sdk, the DurableTask provider extensions).
//
// Exit code 0 when every rule holds, 1 otherwise (each violation is printed).
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', '..'));
const problems = [];
const notes = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => problems.push(msg);

// Directories that only ever hold build output or third-party code. durablefunctionsmonitor-vscodeext
// is deliberately not listed: its stale nuspec copies are skipped by the "next to a .csproj" rule
// below instead, which keeps this list about cost rather than about correctness.
const skipDirs = new Set(['.git', 'node_modules', 'bin', 'obj', 'output', 'drop', 'dist', 'build', 'DfmStatics', '.azurite']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(repoRoot);
const rel = (p) => path.relative(repoRoot, p).split(path.sep).join('/');

// The .csproj files indexed by the assembly name each produces. No project in this repo sets
// <AssemblyName>, so that is the project file name - which is what the <file> entries name.
const projectsByAssembly = new Map();
for (const f of files.filter((f) => f.endsWith('.csproj'))) {
  projectsByAssembly.set(path.basename(f, '.csproj').toLowerCase(), f);
}

/** Direct <PackageReference> entries of one project, as a Map of id -> version. */
function readPackageReferences(csproj) {
  const xml = fs.readFileSync(csproj, 'utf8');
  const result = new Map();
  for (const m of xml.matchAll(/<PackageReference\b([^>]*?)(\/>|>)/g)) {
    const attrs = m[1];
    const id = /\bInclude\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
    const version = /\bVersion\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
    if (!id) continue;
    if (!version) {
      // Central package management, or a nested <Version> element, would make the version invisible
      // to this scan - and a check that cannot see a version must not silently pass it.
      bad(`${rel(csproj)} references ${id} without a Version attribute: this check cannot verify the nuspec floor for it`);
      continue;
    }
    result.set(id, version);
  }
  return result;
}

/** Compares two NuGet versions numerically. Prerelease suffixes are ignored (none are used here). */
function compareVersions(a, b) {
  const parts = (v) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// A source nuspec is one that sits next to a .csproj. The nuspecs under
// durablefunctionsmonitor-vscodeext/backend and /custom-backends are copies of a publish output -
// no .csproj beside them - and nothing ever packs those.
const nuspecs = files
  .filter((f) => f.toLowerCase().endsWith('.nuspec'))
  .filter((f) => fs.readdirSync(path.dirname(f)).some((n) => n.endsWith('.csproj')));

if (!nuspecs.length) {
  console.error(`No source .nuspec found under ${repoRoot}`);
  process.exit(1);
}

for (const nuspec of nuspecs) {
  const xml = fs.readFileSync(nuspec, 'utf8');
  const name = rel(nuspec);

  // What the package puts on a consumer's compile and runtime path
  const libAssemblies = [...xml.matchAll(/<file\b([^>]*?)\/>/g)]
    .map((m) => ({
      src: /\bsrc\s*=\s*"([^"]+)"/.exec(m[1])?.[1] ?? '',
      target: /\btarget\s*=\s*"([^"]+)"/.exec(m[1])?.[1] ?? ''
    }))
    .filter((f) => /^lib[\\/]/i.test(f.target) && f.src.toLowerCase().endsWith('.dll'))
    .map((f) => path.basename(f.src.replace(/\\/g, '/'), '.dll'));

  if (!libAssemblies.length) {
    bad(`${name} packs no assembly into lib/: either the <files> entries changed shape or this check is reading the wrong element`);
    continue;
  }

  const declared = new Map(
    [...xml.matchAll(/<dependency\b([^>]*?)\/>/g)]
      .map((m) => [
        /\bid\s*=\s*"([^"]+)"/.exec(m[1])?.[1],
        /\bversion\s*=\s*"([^"]+)"/.exec(m[1])?.[1]
      ])
      .filter(([id]) => id)
  );

  // Every package reference of every project whose assembly lands in lib/, and who needs it
  const required = new Map();
  for (const assembly of libAssemblies) {
    const csproj = projectsByAssembly.get(assembly.toLowerCase());
    if (!csproj) {
      bad(`${name} packs ${assembly}.dll into lib/ but no .csproj in the repo builds it: this check cannot tell what that assembly needs`);
      continue;
    }
    for (const [id, version] of readPackageReferences(csproj)) {
      const seen = required.get(id);
      if (!seen || compareVersions(version, seen.version) > 0) {
        required.set(id, { version, csproj: rel(csproj), assembly });
      }
    }
  }

  let clean = true;
  for (const [id, { version, csproj, assembly }] of [...required.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const declaredVersion = declared.get(id);
    if (declaredVersion === undefined) {
      clean = false;
      bad(
        `${name} ships ${assembly}.dll in lib/ but never declares ${id}, which ${csproj} references at ${version}.\n` +
        `       A consumer installing this package never gets ${id} restored, and the first call into that code path\n` +
        `       throws FileNotFoundException. Add: <dependency id="${id}" version="${version}" />`
      );
    } else if (compareVersions(declaredVersion, version) < 0) {
      clean = false;
      bad(
        `${name} declares ${id} ${declaredVersion} but ${csproj} builds ${assembly}.dll against ${version}.\n` +
        `       NuGet treats the nuspec version as a floor, so a consumer can resolve ${declaredVersion}, and the loader,\n` +
        `       which never binds down, throws. Raise it to version="${version}".`
      );
    }
  }

  for (const id of declared.keys()) {
    if (!required.has(id)) {
      notes.push(`${name} declares ${id} ${declared.get(id)}, which nothing in lib/ needs directly (the consuming Function App does)`);
    }
  }

  if (clean) ok(`${name}: all ${required.size} dependencies of ${libAssemblies.join(', ')} declared`);
}

if (notes.length) {
  console.log('\nDeclared beyond what lib/ needs (expected - these are for the consuming app):');
  for (const n of notes) console.log(`  -   ${n}`);
}

if (problems.length) {
  console.error('\nNuGet package dependency violations:');
  for (const p of problems) console.error(`  x  ${p}`);
  process.exit(1);
}
console.log('\nNuGet package dependencies: OK');
