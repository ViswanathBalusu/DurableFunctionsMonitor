// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as net from 'net';
import { afterEach, describe, expect, test } from 'vitest';

import { isListening, probeEmulator } from '../../src/setup/probe';

const servers: net.Server[] = [];

afterEach(async () => {

    await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))));
});

function listen(): Promise<number> {

    return new Promise(resolve => {

        const server = net.createServer(socket => socket.destroy());
        servers.push(server);
        server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
    });
}

// A port that was free a moment ago
async function closedPort(): Promise<number> {

    const port = await listen();
    const server = servers.pop()!;
    await new Promise<void>(resolve => server.close(() => resolve()));

    return port;
}

describe('isListening', () => {

    test('is true for a port something listens on', async () => {

        const port = await listen();

        expect(await isListening({ host: '127.0.0.1', port })).toBe(true);
    });

    test('is false for a port nothing listens on', async () => {

        expect(await isListening({ host: '127.0.0.1', port: await closedPort() })).toBe(false);
    });
});

describe('probeEmulator', () => {

    const endpoints = { blob: { host: 'h', port: 1 }, queue: { host: 'h', port: 2 }, table: { host: 'h', port: 3 } };

    test('is listening when every service answers', async () => {

        expect(await probeEmulator(endpoints, async () => true)).toBe('listening');
    });

    test('is partly listening when some do', async () => {

        expect(await probeEmulator(endpoints, async e => e.port === 3)).toBe('partly');
    });

    test('is not listening when none does', async () => {

        expect(await probeEmulator(endpoints, async () => false)).toBe('not listening');
    });

    test('asks only what the connection string names', async () => {

        const asked: number[] = [];

        expect(await probeEmulator({ table: { host: 'h', port: 3 } }, async e => { asked.push(e.port); return true; })).toBe('listening');
        expect(asked).toEqual([3]);
    });

    test('is unknown for a connection string that names no address', async () => {

        expect(await probeEmulator({}, async () => { throw new Error('nothing to ask'); })).toBe('unknown');
    });
});
