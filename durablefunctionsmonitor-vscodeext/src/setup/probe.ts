// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as net from 'net';

import type { Endpoint, EmulatorEndpoints } from './emulator';

// Tells whether something accepts connections there. (The opposite question, whether a port can be listened on,
// is src/backend/ports.ts. A port that Windows reserves answers neither.)
export function isListening(endpoint: Endpoint, timeoutInMs: number = 1000): Promise<boolean> {

    return new Promise<boolean>(resolve => {

        const socket = net.connect({ host: endpoint.host, port: endpoint.port });
        let settled = false;

        const settle = (listening: boolean) => {

            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(listening);
            }
        };

        socket.setTimeout(timeoutInMs);
        socket.once('connect', () => settle(true));
        socket.once('timeout', () => settle(false));
        socket.once('error', () => settle(false));
    });
}

// What is listening of the services of an emulator
export type EmulatorState = 'listening' | 'partly' | 'not listening' | 'unknown';

// Asks every endpoint the connection string names. 'unknown' is a connection string that names none.
export async function probeEmulator(endpoints: EmulatorEndpoints, probe: (endpoint: Endpoint) => Promise<boolean> = isListening): Promise<EmulatorState> {

    const named = [endpoints.blob, endpoints.queue, endpoints.table].filter((e): e is Endpoint => !!e);
    if (!named.length) {
        return 'unknown';
    }

    const answers = await Promise.all(named.map(e => probe(e)));

    if (answers.every(a => a)) {
        return 'listening';
    }

    return answers.some(a => a) ? 'partly' : 'not listening';
}
