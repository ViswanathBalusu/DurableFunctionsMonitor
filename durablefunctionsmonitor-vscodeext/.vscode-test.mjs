// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { defineConfig } from '@vscode/test-cli';

// Integration tests, run inside a real VsCode by "npm run test:integration".
// They need the extension built first: "npm run build" (it also transpiles the tests into out/).
//
// Set DFM_VSCODE_PATH to the Code executable to use an installed VsCode instead of downloading one.
const useInstalled = process.env.DFM_VSCODE_PATH;

export default defineConfig({
    files: 'out/test/integration/**/*.test.js',
    // A workspace with a Functions project in it (host.json, local.settings.json)
    workspaceFolder: './test/fixtures/workspace',
    ...(useInstalled ? { useInstallation: { fromPath: useInstalled } } : { version: 'stable' }),
    launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
    mocha: {
        ui: 'tdd',
        timeout: 120000
    }
});
