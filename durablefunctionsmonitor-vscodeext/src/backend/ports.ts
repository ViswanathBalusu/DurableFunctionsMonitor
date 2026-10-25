// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as net from 'net';

// Tries to listen on a port. Only an attempt to listen tells the truth: asking whether something answers
// on a port (which is what the portscanner package did) cannot see ports that Windows reserves for itself
// (Hyper-V and WSL do that, see 'netsh int ipv4 show excludedportrange protocol=tcp'). Nothing answers on
// those, but listening on them fails with EACCES, and so does the backend that is started there.
function canListen(port: number, host: string): Promise<boolean> {

    return new Promise<boolean>(resolve => {

        const server = net.createServer();

        server.once('error', (err: NodeJS.ErrnoException) => {

            // The host has no such address (typically ::1, when IPv6 is switched off), so nothing can conflict there
            resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
        });

        server.once('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen({ port, host, exclusive: true });
    });
}

// Tells whether a port can be listened on, both on IPv4 and on IPv6 loopback
export async function isPortFree(port: number, hosts: string[] = ['127.0.0.1', '::1']): Promise<boolean> {

    for (const host of hosts) {

        if (!(await canListen(port, host))) {
            return false;
        }
    }

    return true;
}

// Finds a port in the range (inclusive), that can be listened on.
// Starts at a random place of the range, so that two VsCode windows starting backends at the same moment
// are unlikely to fight for the same port.
export async function findFreePort(from: number, to: number, hosts?: string[]): Promise<number> {

    if (from > to) {
        [from, to] = [to, from];
    }

    const count = to - from + 1;
    const start = Math.floor(Math.random() * count);

    for (let i = 0; i < count; i++) {

        const port = from + (start + i) % count;

        if (await isPortFree(port, hosts)) {
            return port;
        }
    }

    throw new Error(`No free port found in the range ${from}-${to}.`);
}
