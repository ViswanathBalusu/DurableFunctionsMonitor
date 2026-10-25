// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { LocalProject, findFunctionsProjects } from '../../src/connections/LocalProject';

const emulator = 'AccountName=devstoreaccount1;AccountKey=key;DefaultEndpointsProtocol=http;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;';

let folder: string;

beforeEach(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-project-')); });
afterEach(() => { fs.rmSync(folder, { recursive: true, force: true }); });

const writeHostJson = (durableTask?: object) => fs.writeFileSync(path.join(folder, 'host.json'), JSON.stringify({ version: '2.0', extensions: { durableTask } }));
const writeLocalSettings = (values: object) => fs.writeFileSync(path.join(folder, 'local.settings.json'), JSON.stringify({ IsEncrypted: false, Values: values }));
const project = (log: string[] = []) => new LocalProject(folder, () => emulator, l => log.push(l));

describe('LocalProject', () => {

    test('a folder with host.json is a Functions project', () => {

        const other = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-other-'));
        writeHostJson();

        expect(findFunctionsProjects([folder, other, path.join(folder, 'missing')])).toEqual([folder]);

        fs.rmSync(other, { recursive: true, force: true });
    });

    test('reads the hub name of host.json, in either case of the property', () => {

        writeHostJson({ hubName: 'my-hub' });
        expect(project().readHostJson().hubName).toBe('my-hub');

        writeHostJson({ HubName: 'My-Other-Hub' });
        expect(project().readHostJson().hubName).toBe('My-Other-Hub');
    });

    test('takes the hub name from an app setting, when host.json says so', () => {

        writeHostJson({ hubName: '%TaskHubName%' });
        writeLocalSettings({ TaskHubName: 'hub-from-settings', AzureWebJobsStorage: 'UseDevelopmentStorage=true' });

        expect(project().readHostJson().hubName).toBe('hub-from-settings');
        expect(project().getStorageConnectionSettings()?.hubName).toBe('hub-from-settings');
    });

    test('has no hub name when the app setting it points to is not there', () => {

        writeHostJson({ hubName: '%Missing%' });
        writeLocalSettings({});

        expect(project().readHostJson().hubName).toBe('');
    });

    test('knows nothing about a host.json that is not there, or is not JSON, and says so in the log', () => {

        expect(project().readHostJson().storageProviderType).toBe('default');

        fs.writeFileSync(path.join(folder, 'host.json'), '{ this is not json');
        const log: string[] = [];
        expect(project(log).readHostJson().hubName).toBe('');
        expect(log.join('\n')).toContain('Failed to parse host.json');
    });

    test('reads a file with a byte order mark, which is what some editors on Windows write', () => {

        fs.writeFileSync(path.join(folder, 'host.json'), String.fromCharCode(0xFEFF) + JSON.stringify({ extensions: { durableTask: { hubName: 'bom-hub' } } }));

        expect(project().readHostJson().hubName).toBe('bom-hub');
    });

    test('infers the connection of a default Storage project from AzureWebJobsStorage, and expands the emulator shortcut', () => {

        writeHostJson({ hubName: 'my-hub' });
        writeLocalSettings({ AzureWebJobsStorage: 'UseDevelopmentStorage=true' });

        const settings = project().getStorageConnectionSettings();

        expect(settings?.storageConnString).toBe(emulator);
        expect(settings?.hubName).toBe('my-hub');
        expect(settings?.isMsSql).toBe(false);
        expect(settings?.isNetherite).toBe(false);
    });

    test('uses the connection string the storage provider names', () => {

        writeHostJson({ hubName: 'my-hub', storageProvider: { connectionStringName: 'MyStorage' } });
        writeLocalSettings({ AzureWebJobsStorage: 'wrong', MyStorage: 'AccountName=mine;AccountKey=k' });

        expect(project().getStorageConnectionSettings()?.storageConnString).toBe('AccountName=mine;AccountKey=k');
    });

    test('has no connection without a hub name, unless there is a default one to use', () => {

        writeHostJson({});
        writeLocalSettings({ AzureWebJobsStorage: 'AccountName=mine;AccountKey=k' });

        expect(project().getStorageConnectionSettings()).toBeNull();
        expect(project().getStorageConnectionSettings('TestHubName')?.hubName).toBe('TestHubName');
    });

    test('has no connection without a connection string', () => {

        writeHostJson({ hubName: 'my-hub' });
        writeLocalSettings({});

        expect(project().getStorageConnectionSettings()).toBeNull();
    });

    test('infers an MSSQL connection, with the schema in the hub name', () => {

        writeHostJson({ hubName: 'my-hub', storageProvider: { type: 'mssql', connectionStringName: 'SQLDB_Connection', schemaName: 'my_schema' } });
        writeLocalSettings({ SQLDB_Connection: 'Server=my-server;Initial Catalog=my-db' });

        const settings = project().getStorageConnectionSettings();

        expect(settings?.isMsSql).toBe(true);
        expect(settings?.hubName).toBe('my_schema/my-hub');
    });

    test('an MSSQL connection without a schema and a hub is in dt/dbo', () => {

        writeHostJson({ storageProvider: { type: 'mssql', connectionStringName: 'SQLDB_Connection' } });
        writeLocalSettings({ SQLDB_Connection: 'Server=my-server;Initial Catalog=my-db' });

        expect(project().getStorageConnectionSettings()?.hubName).toBe('dt/dbo');
    });

    test('infers a Netherite connection: storage and Event Hubs', () => {

        writeHostJson({ hubName: 'my-hub', storageProvider: { type: 'netherite' } });
        writeLocalSettings({ AzureWebJobsStorage: 'AccountName=mine;AccountKey=k', EventHubsConnection: 'Endpoint=sb://x/' });

        const settings = project().getStorageConnectionSettings();

        expect(settings?.isNetherite).toBe(true);
        expect(settings?.eventHubsConnString).toBe('Endpoint=sb://x/');
    });

    test('has no Netherite connection without Event Hubs', () => {

        writeHostJson({ hubName: 'my-hub', storageProvider: { type: 'netherite' } });
        writeLocalSettings({ AzureWebJobsStorage: 'AccountName=mine;AccountKey=k' });

        expect(project().getStorageConnectionSettings()).toBeNull();
    });
});
