// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
    globalIgnores(['dist/**', 'out/**', 'backend/**', 'custom-backends/**', '.vscode-test/**', 'coverage/**']),

    js.configs.recommended,
    tseslint.configs.recommended,

    {
        languageOptions: {
            globals: globals.node
        },
        rules: {
            // Underscore-prefixed names are deliberately unused (e.g. event handler arguments)
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            // The code base uses err.message ?? err on values caught as any
            '@typescript-eslint/no-explicit-any': 'off',
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error'
        }
    },

    {
        // CommonJS by nature: scripts that are run by node as they are
        files: ['**/*.cjs'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off'
        }
    }
);
