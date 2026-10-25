// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, test } from 'vitest';

import { ConnStringRepository, type ConnStringStorage } from '../../src/connections/ConnStringRepository';
import { StorageConnectionSettings } from '../../src/connections/StorageConnectionSettings';

const conn = 'DefaultEndpointsProtocol=https;AccountName=my-account;AccountKey=my-key;EndpointSuffix=core.windows.net';
const otherConn = 'DefaultEndpointsProtocol=https;AccountName=other;AccountKey=k2;EndpointSuffix=core.windows.net';
const sqlConn = 'Server=tcp:my-server.database.windows.net;Initial Catalog=my-db;Authentication=Active Directory Default';

// VsCode's SecretStorage and Memento, as far as the repository uses them
function fakeStorage(): ConnStringStorage & { secretKeys: () => string[], state: { [key: string]: unknown } } {

    const secrets = new Map<string, string>();
    const state: { [key: string]: unknown } = {};

    return {
        secrets: {
            get: async (key: string) => secrets.get(key),
            store: async (key: string, value: string) => { secrets.set(key, value); },
            delete: async (key: string) => { secrets.delete(key); },
            onDidChange: (() => ({ dispose() { } })) as any
        } as any,
        globalState: {
            get: (key: string, defaultValue?: unknown) => state[key] ?? defaultValue,
            update: async (key: string, value: unknown) => { state[key] = value; },
            keys: () => Object.keys(state),
            setKeysForSync: () => { }
        } as any,
        secretKeys: () => [...secrets.keys()],
        state
    };
}

describe('ConnStringRepository', () => {

    let storage: ReturnType<typeof fakeStorage>;
    let repo: ConnStringRepository;

    beforeEach(() => {
        storage = fakeStorage();
        repo = new ConnStringRepository(storage);
    });

    test('has nothing to begin with', async () => {

        expect(await repo.getPersistedConnStrings()).toEqual([]);
        expect(repo.getPersistedConnStringData(conn)).toBeUndefined();
    });

    test('keeps a connection string in the secret storage, and only the hash of it in the state', async () => {

        await repo.saveConnectionString(new StorageConnectionSettings(conn, 'hub'));

        expect(await repo.getPersistedConnStrings()).toEqual([conn]);

        // The state is not a place for secrets: what it has is the key of the secret
        expect(JSON.stringify(storage.state)).not.toContain('my-key');
        expect(storage.secretKeys()).toEqual(['https://my-account.table.core.windows.net/']);
    });

    test('saves the same connection once', async () => {

        await repo.saveConnectionString(new StorageConnectionSettings(conn, 'hub-a'));
        await repo.saveConnectionString(new StorageConnectionSettings(conn, 'hub-b'));

        expect(await repo.getPersistedConnStrings()).toEqual([conn]);
    });

    test('keeps the Event Hubs connection string of a Netherite connection, and drops it when it is not there any more', async () => {

        await repo.saveConnectionString(new StorageConnectionSettings(conn, 'hub', 'Endpoint=sb://hubs/'));
        expect(await repo.getEventHubsConnString(conn)).toBe('Endpoint=sb://hubs/');

        await repo.saveConnectionString(new StorageConnectionSettings(conn, 'hub'));
        expect(await repo.getEventHubsConnString(conn)).toBeUndefined();
    });

    test('forgets a connection string, with its Event Hubs one, and leaves the others', async () => {

        await repo.saveConnectionString(new StorageConnectionSettings(conn, 'hub', 'Endpoint=sb://hubs/'));
        await repo.saveConnectionString(new StorageConnectionSettings(otherConn, 'hub'));

        await repo.forgetConnectionString(conn);

        expect(await repo.getPersistedConnStrings()).toEqual([otherConn]);
        expect(await repo.getEventHubsConnString(conn)).toBeUndefined();
        expect(storage.secretKeys()).toEqual(['https://other.table.core.windows.net/']);
    });

    test('remembers the Task Hubs of an MSSQL connection, with their schemas, once each', async () => {

        await repo.saveConnectionString(new StorageConnectionSettings(sqlConn, 'dt/dbo'));

        await repo.saveTaskHubs(sqlConn, 'my_schema', ['hub1', 'hub2']);
        await repo.saveTaskHubs(sqlConn, 'my_schema', ['hub2', 'hub3']);
        await repo.saveTaskHubs(sqlConn, undefined, ['hub1']);

        expect(repo.getPersistedConnStringData(sqlConn)?.taskHubs).toEqual(['my_schema/hub1', 'my_schema/hub2', 'my_schema/hub3', 'dt/hub1']);
    });

    test('does not remember Task Hubs of a connection that was not saved', async () => {

        await repo.saveTaskHubs(sqlConn, 'dt', ['hub1']);

        expect(repo.getPersistedConnStringData(sqlConn)).toBeUndefined();
    });

    test('reads what earlier versions wrote, a plain array of hashes included', async () => {

        // The oldest format: an array of keys. Their secrets are in the secret storage.
        await storage.secrets.store('https://my-account.table.core.windows.net/', conn);
        storage.state['ConnectionStringHashes'] = ['https://my-account.table.core.windows.net/'];

        expect(await repo.getPersistedConnStrings()).toEqual([conn]);
    });
});
