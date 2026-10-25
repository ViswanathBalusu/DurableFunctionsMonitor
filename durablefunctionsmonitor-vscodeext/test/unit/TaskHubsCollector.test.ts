// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { TaskHubsCollector } from '../../src/azure/TaskHubsCollector';
import { createBearerHeaders, createSharedKeyLiteHeaders } from '../../src/azure/tableAuth';
import { ConnStringUtils } from '../../src/connections/ConnStringUtils';
import { TestServer } from './helpers/testServer';

const accountKey = Buffer.from('not a real key, only bytes to sign with').toString('base64');

describe('createSharedKeyLiteHeaders', () => {

    const now = new Date('2026-10-24T12:00:00Z');

    test('signs the date and the resource with the key', () => {

        const headers = createSharedKeyLiteHeaders('myaccount', accountKey, 'https://myaccount.table.core.windows.net/', 'Tables', now);

        const expected = crypto.createHmac('sha256', Buffer.from(accountKey, 'base64')).update('Sat, 24 Oct 2026 12:00:00 GMT\n/myaccount/Tables').digest('base64');

        expect(headers['Authorization']).toBe(`SharedKeyLite myaccount:${expected}`);
        expect(headers['x-ms-date']).toBe('Sat, 24 Oct 2026 12:00:00 GMT');
        expect(headers['Accept']).toBe('application/json;odata=nometadata');
    });

    test('an emulator URL has the account name after the host, and that is part of what is signed', () => {

        const headers = createSharedKeyLiteHeaders('devstoreaccount1', accountKey, 'http://127.0.0.1:10002/devstoreaccount1/', 'Tables', now);

        const expected = crypto.createHmac('sha256', Buffer.from(accountKey, 'base64')).update('Sat, 24 Oct 2026 12:00:00 GMT\n/devstoreaccount1/devstoreaccount1/Tables').digest('base64');

        expect(headers['Authorization']).toBe(`SharedKeyLite devstoreaccount1:${expected}`);
    });

    test('signs another resource, when asked to', () => {

        const a = createSharedKeyLiteHeaders('acc', accountKey, 'https://acc.table.core.windows.net/', 'Tables', now);
        const b = createSharedKeyLiteHeaders('acc', accountKey, 'https://acc.table.core.windows.net/', 'DurableTaskPartitions()', now);

        expect(a['Authorization']).not.toBe(b['Authorization']);
    });
});

describe('createBearerHeaders', () => {

    test('carries the token', () => {

        expect(createBearerHeaders('the-token', new Date('2026-10-24T12:00:00Z'))['Authorization']).toBe('Bearer the-token');
    });
});

describe('TaskHubsCollector, against a Table service that is faked', () => {

    let server: TestServer;
    let collector: TaskHubsCollector;

    beforeEach(async () => {

        server = new TestServer();
        await server.start();
        collector = new TaskHubsCollector(server.url(), 'myaccount');
    });

    afterEach(async () => { await server.stop(); });

    const tables = (...names: string[]) => JSON.stringify({ value: names.map(TableName => ({ TableName })) });

    test('a Task Hub is what has both its Instances and its History table', async () => {

        server.on('/Tables', (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(tables('MyHubInstances', 'MyHubHistory', 'OrphanInstances', 'OtherHistory', 'Unrelated', 'SecondHubInstances', 'SecondHubHistory'));
        });

        const result = await collector.getTaskHubNamesWithKey(accountKey);

        expect(result).toEqual({ hubNames: ['MyHub', 'SecondHub'], storageType: 'default' });
    });

    test('signs its requests', async () => {

        let authorization = '';
        server.on('/Tables', (req, res) => { authorization = req.headers['authorization'] as string; res.end(tables()); });

        await collector.getTaskHubNamesFromTableStorageWithKey(accountKey);

        expect(authorization).toMatch(/^SharedKeyLite myaccount:[A-Za-z0-9+/=]+$/);
    });

    test('follows the continuation, when the tables do not fit in a page', async () => {

        server.on('/Tables', (req, res) => {

            res.writeHead(200, req.url!.includes('NextTableName=Page2')
                ? { 'Content-Type': 'application/json' }
                : { 'Content-Type': 'application/json', 'x-ms-continuation-NextTableName': 'Page2' });

            res.end(req.url!.includes('NextTableName=Page2') ? tables('SecondHubInstances', 'SecondHubHistory') : tables('FirstHubInstances', 'FirstHubHistory'));
        });

        const hubs = await collector.getTaskHubNamesFromTableStorageWithKey(accountKey);

        expect(hubs).toEqual(['FirstHub', 'SecondHub']);
        expect(server.requests).toHaveLength(2);
    });

    test('an account with no tables has no hubs', async () => {

        server.on('/Tables', (_req, res) => { res.end(tables()); });

        expect(await collector.getTaskHubNamesFromTableStorageWithKey(accountKey)).toEqual([]);
    });

    test('recognizes Netherite by its partitions table, and lists its hubs from there', async () => {

        server.on('/DurableTaskPartitions()', (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ value: [{ PartitionKey: 'hubA' }, { PartitionKey: 'hubA' }, { PartitionKey: 'hubB' }] }));
        });
        server.on('/Tables', (_req, res) => { res.end(tables('hubAInstances', 'hubAHistory')); });

        const result = await collector.getTaskHubNamesWithKey(accountKey);

        expect(result).toEqual({ hubNames: ['hubA', 'hubB'], storageType: 'netherite' });
    });

    test('is not Netherite when there is no partitions table', async () => {

        // The fallback answers 404 for it
        server.on('/Tables', (_req, res) => { res.end(tables('hubAInstances', 'hubAHistory')); });

        expect((await collector.getTaskHubNamesWithKey(accountKey)).storageType).toBe('default');
    });

    test('fails, when the account does not let us in', async () => {

        server.on('/Tables', (_req, res) => { res.writeHead(403); res.end('AuthenticationFailed'); });

        await expect(collector.getTaskHubNamesWithKey(accountKey)).rejects.toThrow(/status code 403/);
    });

    test('with the identity of the user, uses the headers it is given, for every request', async () => {

        const seen: string[] = [];
        server.on('/Tables', (req, res) => {
            seen.push(req.headers['authorization'] as string);
            res.writeHead(200, req.url!.includes('NextTableName') ? {} : { 'x-ms-continuation-NextTableName': 'Page2' });
            res.end(tables());
        });

        let counter = 0;
        await collector.getTaskHubNamesFromTableStorageWithUserToken(async () => ({ Authorization: `Bearer token-${++counter}` }));

        expect(seen).toEqual(['Bearer token-1', 'Bearer token-2']);
    });
});

// Against the real thing: set DFM_TEST_STORAGE_CONNECTION_STRING to the connection string of a running Azurite,
// that has the seeded task hub in it (npm run seed in durablefunctionsmonitor.svelte). The point is the signature:
// only a real storage service can say that it is right.
const emulatorConnString = process.env['DFM_TEST_STORAGE_CONNECTION_STRING'];

describe.skipIf(!emulatorConnString)('TaskHubsCollector, against Azurite', () => {

    test('lists the seeded Task Hub, which only works with a correct signature', async () => {

        const connString = emulatorConnString!;
        const collector = new TaskHubsCollector(ConnStringUtils.GetTableEndpoint(connString), ConnStringUtils.GetAccountName(connString));

        const result = await collector.getTaskHubNamesWithKey(ConnStringUtils.GetAccountKey(connString));

        expect(result.storageType).toBe('default');
        expect(result.hubNames).toContain('DurableFunctionsHub');
    });

    test('is turned away with a wrong key', async () => {

        const connString = emulatorConnString!;
        const collector = new TaskHubsCollector(ConnStringUtils.GetTableEndpoint(connString), ConnStringUtils.GetAccountName(connString));

        await expect(collector.getTaskHubNamesFromTableStorageWithKey(accountKey)).rejects.toThrow(/status code 403/);
    });
});
