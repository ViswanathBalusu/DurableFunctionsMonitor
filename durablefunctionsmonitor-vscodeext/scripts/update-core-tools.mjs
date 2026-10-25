#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Pins the Azure Functions Core Tools release the extension downloads: writes src/coreTools/manifest.json
// with the archive names, sizes and SHA-256 checksums of that release. The checksums end up in the VSIX,
// which is what makes a download verifiable: a release asset that someone replaced later does not match.
//
//   node scripts/update-core-tools.mjs            pins the latest release
//   node scripts/update-core-tools.mjs 4.16.0     pins this one
//
// Review the diff, run "npm run test:unit", and try the new version against the backend before committing.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../src/coreTools/manifest.json', import.meta.url));
const repo = 'Azure/azure-functions-core-tools';

// Core Tools 4.1.2 added support for the .NET 10 isolated model (Azure/azure-functions-core-tools#4589).
// Installed copies older than that are not used. A release pinned here is always newer.
const minimumVersion = '4.1.2';

// The platforms the extension knows (see platform.ts) and the archives that serve them. Windows gets the
// 'min' packages: about 75 MB instead of about 560 MB, and without the in-process runtimes that the
// .NET isolated backend of this extension does not use.
const archiveNames = {
    'win-x64': v => `Azure.Functions.Cli.min.win-x64.${v}.zip`,
    'win-arm64': v => `Azure.Functions.Cli.min.win-arm64.${v}.zip`,
    'win-x86': v => `Azure.Functions.Cli.min.win-x86.${v}.zip`,
    'linux-x64': v => `Azure.Functions.Cli.linux-x64.${v}.zip`,
    'linux-arm64': v => `Azure.Functions.Cli.linux-arm64.${v}.zip`,
    'osx-x64': v => `Azure.Functions.Cli.osx-x64.${v}.zip`,
    'osx-arm64': v => `Azure.Functions.Cli.osx-arm64.${v}.zip`
};

async function getJson(url) {

    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dfm-update-core-tools' } });
    if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

async function getText(url) {

    const response = await fetch(url, { headers: { 'User-Agent': 'dfm-update-core-tools' } });
    if (!response.ok) {
        throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.text()).trim();
}

async function main() {

    const requested = process.argv[2];
    const release = await getJson(`https://api.github.com/repos/${repo}/releases/${requested ? 'tags/' + requested : 'latest'}`);

    const version = release.tag_name;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`'${version}' is not a release version. Pass one, e.g. 4.16.0.`);
    }

    console.log(`Pinning Azure Functions Core Tools ${version} (published ${release.published_at})`);

    const assets = {};

    for (const [rid, getName] of Object.entries(archiveNames)) {

        const name = getName(version);
        const asset = release.assets.find(a => a.name === name);
        if (!asset) {
            throw new Error(`Release ${version} has no asset ${name}`);
        }

        // The release publishes the SHA-256 of every archive next to it, as '<archive>.sha2'
        const checksumAsset = release.assets.find(a => a.name === `${name}.sha2`);
        if (!checksumAsset) {
            throw new Error(`Release ${version} has no ${name}.sha2`);
        }

        const sha256 = (await getText(checksumAsset.browser_download_url)).split(/\s+/)[0].toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha256)) {
            throw new Error(`${name}.sha2 does not contain a SHA-256: '${sha256}'`);
        }

        assets[rid] = { file: name, size: asset.size, sha256 };
        console.log(`  ${rid.padEnd(10)} ${(asset.size / 1048576).toFixed(1).padStart(6)} MB  ${sha256}`);
    }

    const manifest = {
        version,
        minimumVersion,
        releaseUrl: `https://github.com/${repo}/releases/download/${version}`,
        assets
    };

    // Not touching the file, if nothing changed
    let previous = '';
    try { previous = readFileSync(manifestPath, 'utf8'); } catch { /* there was none */ }

    const text = JSON.stringify(manifest, null, 4) + '\n';
    if (text === previous) {
        console.log('manifest.json is up to date.');
        return;
    }

    writeFileSync(manifestPath, text);
    console.log(`Wrote ${manifestPath}`);
}

main().catch(err => {
    console.error(err.message ?? err);
    process.exit(1);
});
