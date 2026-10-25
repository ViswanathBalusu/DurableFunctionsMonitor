// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ConnStringUtils } from '../connections/ConnStringUtils';
import { SettingsDefaults } from '../settingsDefaults';

// The connection string of the local Storage emulator (Azurite), and where it listens. Has no dependency on VsCode.

export type EmulatorPorts = { blob: number, queue: number, table: number };

// Where Azurite listens, unless it is told otherwise
export const DefaultEmulatorPorts: EmulatorPorts = { blob: 10000, queue: 10001, table: 10002 };

// The account name and the key that every Storage emulator has
const EmulatorAccountName = ConnStringUtils.GetAccountName(SettingsDefaults.storageEmulatorConnectionString);
const EmulatorAccountKey = ConnStringUtils.GetAccountKey(SettingsDefaults.storageEmulatorConnectionString);

// The connection string of an emulator that listens on these ports of this machine
export function buildEmulatorConnectionString(ports: EmulatorPorts, host: string = '127.0.0.1'): string {

    const endpoint = (port: number) => `http://${host}:${port}/${EmulatorAccountName}`;

    return `AccountName=${EmulatorAccountName};AccountKey=${EmulatorAccountKey};DefaultEndpointsProtocol=http;` +
        `BlobEndpoint=${endpoint(ports.blob)};QueueEndpoint=${endpoint(ports.queue)};TableEndpoint=${endpoint(ports.table)};`;
}

// Azurite's ports follow one another, which is how it numbers them unless it is told otherwise: the queue's is the blob's plus one,
// and the table's is the blob's plus two. That is what a person gives only the first port for.
export function portsFromBlobPort(blob: number): EmulatorPorts {
    return { blob, queue: blob + 1, table: blob + 2 };
}

// The command line that starts Azurite there
export function getAzuriteCommand(ports: EmulatorPorts): string {

    const isDefault = ports.blob === DefaultEmulatorPorts.blob && ports.queue === DefaultEmulatorPorts.queue && ports.table === DefaultEmulatorPorts.table;

    return isDefault ? 'azurite' : `azurite --blobPort ${ports.blob} --queuePort ${ports.queue} --tablePort ${ports.table}`;
}

// What an input box asks of the first port. Returns the complaint, or undefined when the port is fine.
export function validateBlobPort(text: string): string | undefined {

    const trimmed = text.trim();

    if (!/^\d+$/.test(trimmed)) {
        return 'A port is a number, like 10000.';
    }

    const port = Number(trimmed);

    // Two more ports follow it
    if (port < 1 || port > 65533) {
        return 'The first port is between 1 and 65533, because the queue and the table take the two after it.';
    }

    return undefined;
}

export type Endpoint = { host: string, port: number };

// Where a connection string says the blob, queue and table services are. Empty for a connection string that
// names no endpoints (an Azure account is found by its name instead).
export type EmulatorEndpoints = { blob?: Endpoint, queue?: Endpoint, table?: Endpoint };

function parseEndpoint(connString: string, name: string): Endpoint | undefined {

    const match = new RegExp(`${name}=([^;]+)`, 'i').exec(connString);
    if (!match) {
        return undefined;
    }

    try {

        const url = new URL(match[1]);
        const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);

        return { host: url.hostname, port };

    } catch {
        return undefined;
    }
}

export function parseEmulatorEndpoints(connString: string): EmulatorEndpoints {

    return {
        blob: parseEndpoint(connString, 'BlobEndpoint'),
        queue: parseEndpoint(connString, 'QueueEndpoint'),
        table: parseEndpoint(connString, 'TableEndpoint')
    };
}

// Tells whether this is the connection string the extension ships with
export function isDefaultEmulatorConnectionString(connString: string): boolean {
    return connString === SettingsDefaults.storageEmulatorConnectionString;
}

// "127.0.0.1:10000-10002", or "127.0.0.1:10000, 10003, 10002" when they do not follow one another. Empty, if the connection string says nowhere.
export function formatEndpoints(endpoints: EmulatorEndpoints): string {

    const all = [endpoints.blob, endpoints.queue, endpoints.table].filter((e): e is Endpoint => !!e);
    if (!all.length) {
        return '';
    }

    const hosts = [...new Set(all.map(e => e.host))];
    // Services behind one port (a proxy, a container) are one port, not three
    const ports = [...new Set(all.map(e => e.port))];

    const consecutive = ports.length > 1 && ports.every((p, i) => i === 0 || p === ports[i - 1] + 1);
    const list = consecutive ? `${ports[0]}-${ports[ports.length - 1]}` : ports.join(', ');

    // Several hosts are not an emulator that is listening somewhere in particular: show each endpoint
    return hosts.length === 1 ? `${hosts[0]}:${list}` : all.map(e => `${e.host}:${e.port}`).join(', ');
}
