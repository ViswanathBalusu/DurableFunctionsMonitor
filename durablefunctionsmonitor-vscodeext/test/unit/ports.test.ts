// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as net from 'net';
import { afterEach, describe, expect, test } from 'vitest';

import { findFreePort, isPortFree } from '../../src/backend/ports';

const servers: net.Server[] = [];

// Occupies a port, the way something else running on the machine would
function occupy(port: number = 0, host: string = '127.0.0.1'): Promise<number> {

    return new Promise<number>((resolve, reject) => {

        const server = net.createServer();
        servers.push(server);

        server.once('error', reject);
        server.listen(port, host, () => resolve((server.address() as net.AddressInfo).port));
    });
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))));
});

describe('ports', () => {

    test('a port nothing listens on is free', async () => {

        const port = await occupy();
        await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));

        expect(await isPortFree(port)).toBe(true);
    });

    test('a port something listens on is not free', async () => {

        const port = await occupy();

        expect(await isPortFree(port)).toBe(false);
    });

    test('finds a free port in the range, skipping the ones that are taken', async () => {

        const first = await occupy();
        const second = await occupy(first + 1).catch(() => undefined);

        // The range is those two (or the one, if the neighbour was not available)
        const to = second ? first + 2 : first + 1;
        const found = await findFreePort(first, to);

        expect(found).not.toBe(first);
        expect(found).not.toBe(second);
        expect(found).toBeGreaterThanOrEqual(first);
        expect(found).toBeLessThanOrEqual(to);
    });

    test('says so, when the whole range is taken', async () => {

        const port = await occupy();

        await expect(findFreePort(port, port)).rejects.toThrow(/No free port found in the range/);
    });

    test('accepts a range that is written backwards', async () => {

        const port = await occupy();
        await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));

        expect(await findFreePort(port, port)).toBe(port);

        // From > to is the same range
        const found = await findFreePort(port + 1, port);
        expect(found).toBeGreaterThanOrEqual(port);
        expect(found).toBeLessThanOrEqual(port + 1);
    });
});
