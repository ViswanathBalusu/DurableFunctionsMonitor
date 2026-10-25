// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'vitest';

import * as SharedConstants from '../../src/constants';
import { getBackendUrl, parseBackendBaseUrl } from '../../src/backend/backendUrl';

// The extension and the backend are built in this repository, and have to agree on a few things nothing
// else would check: the routes, the header and the environment variables. These tests read the backend's own
// source, and fail when the extension is left behind. That is exactly what once kept the extension waiting
// for a backend that was running, for good.

const coreFolder = path.resolve(__dirname, '../../../durablefunctionsmonitor.dotnetisolated.core');
const mssqlFolder = path.resolve(__dirname, '../../../durablefunctionsmonitor.dotnetisolated.mssql');

function readBackendSource(relativePath: string): string {
    return fs.readFileSync(path.join(coreFolder, relativePath), 'utf8');
}

describe('The contract with the backend', () => {

    test('the route prefix is the one the backend serves its functions under', () => {

        const globals = readBackendSource('Common/Globals.cs');

        const prefix = /DfMonRoutePrefix\s*=\s*"([^"]+)"/.exec(globals)?.[1];
        expect(prefix).toBe(SharedConstants.BackendRoutePrefix);

        // Globals.ApiRoutePrefix = DfMonRoutePrefix + "/a/p/i/{connName}-{hubName}"
        const apiPath = /ApiRoutePrefix\s*=\s*DfMonRoutePrefix\s*\+\s*"([^"{]+)\/\{connName\}-\{hubName\}"/.exec(globals)?.[1];
        expect(`/${prefix}${apiPath}`).toBe(SharedConstants.BackendApiPath);
    });

    test('the Task Hub segment is {connName}-{hubName}, so a connection without a name is --{hubName}', () => {

        expect(readBackendSource('Common/Globals.cs')).toMatch(/ConnAndTaskHubNameSeparator\s*=\s*"-"/);
    });

    test('the nonce header and the environment variables are the ones the backend reads', () => {

        expect(readBackendSource('Common/Auth.cs')).toContain(`"${SharedConstants.NonceHeaderName}"`);

        const globals = readBackendSource('Common/Globals.cs');
        for (const variable of [SharedConstants.NonceEnvironmentVariableName, SharedConstants.HubNameEnvironmentVariableName]) {
            expect(globals, `Globals.cs does not know ${variable}`).toContain(`"${variable}"`);
        }
    });

    test('the MSSQL variables are the ones the MSSQL package reads', () => {

        const mssql = fs.readFileSync(path.join(mssqlFolder, 'ExtensionMethods.cs'), 'utf8');

        for (const variable of [SharedConstants.MsSqlConnStringEnvironmentVariableName, SharedConstants.MsSqlSchemaNameEnvironmentVariableName]) {
            expect(mssql, `ExtensionMethods.cs of the MSSQL package does not know ${variable}`).toContain(`"${variable}"`);
        }
    });

    test('the default backendBaseUrl of the manifest leads to the API path of the backend', () => {

        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
        const defaultUrl: string = manifest.contributes.configuration.properties['durableFunctionsMonitor.backendBaseUrl'].default;

        const endpoint = parseBackendBaseUrl(defaultUrl);
        expect(endpoint).toBeDefined();

        // The setting keeps the path for the readers of settings.json: it has to be the same one the code uses
        expect(getBackendUrl(endpoint!, 1234)).toBe(defaultUrl.replace('{portNr}', '1234'));
    });
});
