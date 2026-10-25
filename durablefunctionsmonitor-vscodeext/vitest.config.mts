// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { defineConfig } from 'vitest/config';

// Unit tests for everything that does not need VsCode. The modules under test are written so that
// they never import 'vscode'; what does need it is covered by test/integration (see .vscode-test.mjs).
export default defineConfig({
    test: {
        include: ['test/unit/**/*.test.ts'],
        environment: 'node',
        // Some tests start real child processes and local servers
        testTimeout: 30000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/extension.ts']
        }
    }
});
