// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { buildBackendEnvironment, getHubNameWithoutSchema, getSchemaName } from '../../src/backend/backendEnvironment';
import { StorageConnectionSettings } from '../../src/connections/StorageConnectionSettings';

const keyConnString = 'DefaultEndpointsProtocol=https;AccountName=my-account;AccountKey=my-key;EndpointSuffix=core.windows.net';
const identityConnString = 'DefaultEndpointsProtocol=https;AccountName=my-account;EndpointSuffix=core.windows.net';
const sqlConnString = 'Server=tcp:my-server.database.windows.net;Initial Catalog=my-db;Authentication=Active Directory Default';

describe('buildBackendEnvironment', () => {

    test('prepares the environment for a Storage account with a key', () => {

        const env = buildBackendEnvironment({}, new StorageConnectionSettings(keyConnString, 'my-hub'), 'my-nonce');

        expect(env['AzureWebJobsStorage']).toBe(keyConnString);
        expect(env['AzureWebJobsStorage__accountName']).toBeUndefined();
        expect(env['DFM_NONCE']).toBe('my-nonce');
        expect(env['FUNCTIONS_WORKER_RUNTIME']).toBe('dotnet-isolated');
        expect(env['AzureWebJobsSecretStorageType']).toBe('files');
        expect(env['DFM_SQL_CONNECTION_STRING']).toBeUndefined();
    });

    test('prepares the environment for an identity-based connection: only the account name goes', () => {

        const env = buildBackendEnvironment({}, new StorageConnectionSettings(identityConnString, 'my-hub'), 'my-nonce');

        expect(env['AzureWebJobsStorage']).toBeUndefined();
        expect(env['AzureWebJobsStorage__accountName']).toBe('my-account');
    });

    test('prepares the environment for MSSQL, with the schema and the hub name told apart', () => {

        const env = buildBackendEnvironment({}, new StorageConnectionSettings(sqlConnString, 'my-schema/my-hub'), 'my-nonce');

        expect(env['DFM_SQL_CONNECTION_STRING']).toBe(sqlConnString);
        expect(env['DFM_HUB_NAME']).toBe('my-hub');
        expect(env['AzureFunctionsJobHost__extensions__durableTask__storageProvider__schemaName']).toBe('my-schema');
        expect(env['AzureWebJobsStorage']).toBeUndefined();
    });

    test('MSSQL hub without a schema is in the dt schema', () => {

        const env = buildBackendEnvironment({}, new StorageConnectionSettings(sqlConnString, 'my-hub'), 'my-nonce');

        expect(env['AzureFunctionsJobHost__extensions__durableTask__storageProvider__schemaName']).toBe('dt');
        expect(env['DFM_HUB_NAME']).toBe('my-hub');
    });

    test('prepares the environment for Netherite: storage and Event Hubs', () => {

        const env = buildBackendEnvironment({}, new StorageConnectionSettings(keyConnString, 'my-hub', 'Endpoint=sb://my-hubs.servicebus.windows.net/;SharedAccessKey=x'), 'my-nonce');

        expect(env['AzureWebJobsStorage']).toBe(keyConnString);
        expect(env['EventHubsConnection']).toBe('Endpoint=sb://my-hubs.servicebus.windows.net/;SharedAccessKey=x');
    });

    test('inherits the environment of VsCode, so that globally installed tools are found', () => {

        const env = buildBackendEnvironment({ PATH: '/my/path', HOME: '/home/me' }, new StorageConnectionSettings(keyConnString, 'my-hub'), 'my-nonce');

        expect(env['PATH']).toBe('/my/path');
        expect(env['HOME']).toBe('/home/me');
    });

    test('does not let the storage of the developer\'s own app leak in', () => {

        const env = buildBackendEnvironment({
            AzureWebJobsStorage: 'the-developers-own-storage',
            AzureWebJobsStorage__accountName: 'the-developers-own-account',
            DFM_SQL_CONNECTION_STRING: 'the-developers-own-sql',
            DFM_HUB_NAME: 'the-developers-own-hub',
            AzureFunctionsJobHost__extensions__durableTask__storageProvider__schemaName: 'the-developers-own-schema',
            FUNCTIONS_WORKER_RUNTIME: 'node'
        }, new StorageConnectionSettings(identityConnString, 'my-hub'), 'my-nonce');

        expect(env['AzureWebJobsStorage']).toBeUndefined();
        expect(env['AzureWebJobsStorage__accountName']).toBe('my-account');
        expect(env['DFM_SQL_CONNECTION_STRING']).toBeUndefined();
        expect(env['DFM_HUB_NAME']).toBeUndefined();
        expect(env['AzureFunctionsJobHost__extensions__durableTask__storageProvider__schemaName']).toBeUndefined();
        expect(env['FUNCTIONS_WORKER_RUNTIME']).toBe('dotnet-isolated');
    });

    test('does not change the environment it was given', () => {

        const base = { AzureWebJobsStorage: 'mine' };

        buildBackendEnvironment(base, new StorageConnectionSettings(keyConnString, 'my-hub'), 'my-nonce');

        expect(base).toEqual({ AzureWebJobsStorage: 'mine' });
    });

    test('keeps Core Tools from reporting usage on behalf of the user, unless the user has said otherwise', () => {

        const settings = new StorageConnectionSettings(keyConnString, 'my-hub');

        expect(buildBackendEnvironment({}, settings, 'n')['FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT']).toBe('1');
        expect(buildBackendEnvironment({ FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT: '0' }, settings, 'n')['FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT']).toBe('0');
    });
});

describe('hub names', () => {

    test('split into the schema and the hub', () => {

        expect(getSchemaName('schema/hub')).toBe('schema');
        expect(getHubNameWithoutSchema('schema/hub')).toBe('hub');
        expect(getSchemaName('a/b/hub')).toBe('a/b');
        expect(getHubNameWithoutSchema('a/b/hub')).toBe('hub');
        expect(getSchemaName('hub')).toBe('dt');
        expect(getHubNameWithoutSchema('hub')).toBe('hub');
    });
});
