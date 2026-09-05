#!/usr/bin/env node
// Verifies a Vite build output against the statics contract the backend (ServeStatics.cs) and the
// VS Code extension (MonitorView.fixLinksToStatics) impose. See docs/plans/svelte-rewrite/00-shared-contracts.md §2.
//
//   node scripts/harness/verify-build-contract.mjs durablefunctionsmonitor.svelte/build
//
// Exit code 0 when every rule holds, 1 otherwise (each violation is printed).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'durablefunctionsmonitor.svelte/build');
const problems = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => problems.push(msg);

if (!fs.existsSync(dir)) {
  console.error(`Build folder not found: ${dir}`);
  process.exit(1);
}

function walk(d, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(d, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = walk(dir);
const nonMap = files.filter((f) => !f.endsWith('.map'));

// 1. Allowed locations
const allowedTop = new Set(['index.html', 'favicon.png', 'logo.svg', 'manifest.json']);
for (const f of nonMap) {
  const segments = f.split('/');
  if (segments.length === 1) {
    if (!allowedTop.has(f)) bad(`unexpected top-level file: ${f} (only index.html, favicon.png, logo.svg, manifest.json are served)`);
    continue;
  }
  if (!(f.startsWith('static/js/') || f.startsWith('static/css/') || f.startsWith('static/media/'))) {
    bad(`file outside static/js, static/css, static/media: ${f}`);
  }
  if (segments.length > 3) bad(`path deeper than three segments: ${f}`);
}

// 2. Exactly one JS and one CSS bundle
const js = nonMap.filter((f) => f.startsWith('static/js/') && f.endsWith('.js'));
const css = nonMap.filter((f) => f.startsWith('static/css/') && f.endsWith('.css'));
if (js.length !== 1) bad(`expected exactly one JS bundle in static/js, found ${js.length}: ${js.join(', ')}`);
else ok(`single JS bundle ${js[0]}`);
if (css.length !== 1) bad(`expected exactly one CSS bundle in static/css, found ${css.length}: ${css.join(', ')}`);
else ok(`single CSS bundle ${css[0]}`);
for (const f of [...js, ...css]) {
  const name = path.basename(f);
  if (!/^main\.[0-9a-f]+\.(js|css)$/.test(name)) bad(`bundle name must be main.<hex>.<ext>, got ${name}`);
}

// 3. File names in static/* use only [0-9a-z.] (VS Code rewrite regex is / (href|src)="\/([0-9a-z.\/]+)"/ig)
for (const f of nonMap.filter((x) => x.startsWith('static/js/') || x.startsWith('static/css/'))) {
  if (!/^[0-9a-z./]+$/.test(f)) bad(`file name contains characters outside [0-9a-z./]: ${f}`);
}

// 4. index.html placeholders and asset links
const indexPath = path.join(dir, 'index.html');
if (!fs.existsSync(indexPath)) {
  bad('index.html missing');
} else {
  const html = fs.readFileSync(indexPath, 'utf8');
  const placeholders = [
    '<meta name="durable-functions-monitor-meta">',
    '<script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script>',
    '<script>var DfmRoutePrefix=""</script>',
    '<script>var DfmApiRoutePrefix=""</script>',
    '<script>var DfmClientConfig={}</script>',
    '<script>var DfmViewMode=0</script>',
    '<script>var IsFunctionGraphAvailable=0</script>',
  ];
  for (const p of placeholders) {
    if (!html.includes(p)) bad(`index.html lacks the exact placeholder ${p}`);
  }
  if (placeholders.every((p) => html.includes(p))) ok('seven placeholder tags present verbatim');

  const links = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const l of links) {
    if (/^https?:\/\//.test(l)) continue; // fonts, allowed by the default CSP
    if (!l.startsWith('/')) bad(`asset link is not root-absolute: ${l}`);
    if (l.startsWith('/static/') && !/^[0-9a-z./]+$/.test(l.slice(1))) bad(`asset link has characters the VS Code rewrite cannot handle: ${l}`);
    if (l.startsWith('/static/') && !fs.existsSync(path.join(dir, l.slice(1)))) bad(`asset link points to a missing file: ${l}`);
  }
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[0])
    .filter((s) => !placeholders.includes(s));
  if (inlineScripts.length) bad(`inline scripts beyond the placeholders are not allowed under the default CSP: ${inlineScripts.length} found`);
  else ok('no inline scripts beyond the placeholders');
  if (/rel="modulepreload"/.test(html)) bad('modulepreload links found: code splitting must be off (inlineDynamicImports)');
}

// 5. CSS url() references must be relative (VS Code only rewrites index.html)
for (const f of css) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const urls = [...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
  const absolute = urls.filter((u) => u.startsWith('/') && !u.startsWith('//'));
  if (absolute.length) bad(`CSS references root-absolute urls (VS Code cannot rewrite them): ${absolute.slice(0, 3).join(', ')}`);
  else ok(`CSS urls are relative or external (${urls.length} url() references)`);
}

if (problems.length) {
  console.error('\nBuild contract violations:');
  for (const p of problems) console.error(`  x  ${p}`);
  process.exit(1);
}
console.log('\nBuild contract: OK');
