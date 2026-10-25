// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Bundles the extension into the single dist/extension.js that package.json points to, so that the
// VSIX needs no node_modules. Also transpiles the integration tests into out/test/integration, which
// is where .vscode-test.mjs looks for them (they are not bundled: they require() the built extension).
//
//   node esbuild.mjs                 development build, with source maps
//   node esbuild.mjs --production    minified, no source maps (what "vsce package" runs)
//   node esbuild.mjs --watch         rebuilds on change

import * as esbuild from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Prints errors in the format of the "$esbuild-watch" problem matcher (connor4312.esbuild-problem-matchers),
// and the progress it looks for, but only in watch mode, where something is waiting for it
const problemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            if (watch) {
                console.log('[watch] build started');
            }
        });
        build.onEnd(result => {
            for (const { text, location } of result.errors) {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            }
            if (watch) {
                console.log('[watch] build finished');
            }
        });
    }
};

// Lists *.ts files below a folder
function listTypeScriptFiles(folder) {

    const result = [];
    for (const name of readdirSync(folder)) {

        const path = join(folder, name);
        if (statSync(path).isDirectory()) {
            result.push(...listTypeScriptFiles(path));
        } else if (name.endsWith('.ts')) {
            result.push(path);
        }
    }
    return result;
}

const extensionOptions = {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    format: 'cjs',
    platform: 'node',
    // The oldest VsCode we support (see "engines" in package.json) runs extensions on Node 20
    target: 'node20',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    legalComments: 'none',
    logLevel: 'silent',
    plugins: [problemMatcherPlugin]
};

const testOptions = {
    entryPoints: listTypeScriptFiles('test/integration'),
    outdir: 'out/test/integration',
    bundle: false,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    logLevel: 'silent',
    plugins: [problemMatcherPlugin]
};

async function main() {

    const extensionContext = await esbuild.context(extensionOptions);
    const testContext = await esbuild.context(testOptions);

    if (watch) {

        await Promise.all([extensionContext.watch(), testContext.watch()]);
        return;
    }

    await extensionContext.rebuild();
    await testContext.rebuild();
    await extensionContext.dispose();
    await testContext.dispose();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
