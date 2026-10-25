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

// Gives back every port this test took
function releaseAll(): Promise<unknown> {
    return Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))));
}

afterEach(releaseAll);

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

        // Two ports in a row that this test takes, and a third after them that nothing uses. It is looked for, not assumed: other test
        // files bind ports at the same moment, and Windows hands out ephemeral ports one after another, so a neighbour is often theirs.
        let first = 0;

        for (let attempt = 0; attempt < 20 && !first; attempt++) {

            const candidate = await occupy();
            const second = await occupy(candidate + 1).catch(() => undefined);

            if (second && await isPortFree(candidate + 2)) {
                first = candidate;
            } else {
                await releaseAll();
            }
        }

        expect(first, 'three ports in a row, the first two free to take').toBeGreaterThan(0);

        expect(await findFreePort(first, first + 2)).toBe(first + 2);
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
