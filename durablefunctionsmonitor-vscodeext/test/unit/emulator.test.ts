// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { SettingsDefaults } from '../../src/settingsDefaults';
import {
    DefaultEmulatorPorts, buildEmulatorConnectionString, formatEndpoints, getAzuriteCommand,
    isDefaultEmulatorConnectionString, parseEmulatorEndpoints, portsFromBlobPort, validateBlobPort
} from '../../src/setup/emulator';

describe('buildEmulatorConnectionString', () => {

    test('builds the connection string the extension ships with, for the ports Azurite has by default', () => {

        expect(buildEmulatorConnectionString(DefaultEmulatorPorts)).toBe(SettingsDefaults.storageEmulatorConnectionString);
    });

    test('puts the ports where the services are', () => {

        const connString = buildEmulatorConnectionString({ blob: 11000, queue: 11001, table: 11002 });

        expect(connString).toContain('BlobEndpoint=http://127.0.0.1:11000/devstoreaccount1;');
        expect(connString).toContain('QueueEndpoint=http://127.0.0.1:11001/devstoreaccount1;');
        expect(connString).toContain('TableEndpoint=http://127.0.0.1:11002/devstoreaccount1;');
        expect(connString).toContain('AccountName=devstoreaccount1;');
    });

    test('can be read back', () => {

        const ports = { blob: 12345, queue: 20000, table: 30000 };

        expect(parseEmulatorEndpoints(buildEmulatorConnectionString(ports, 'localhost'))).toEqual({
            blob: { host: 'localhost', port: 12345 },
            queue: { host: 'localhost', port: 20000 },
            table: { host: 'localhost', port: 30000 }
        });
    });
});

describe('portsFromBlobPort', () => {

    test('numbers the queue and the table after the blob, the way Azurite does', () => {

        expect(portsFromBlobPort(11000)).toEqual({ blob: 11000, queue: 11001, table: 11002 });
        expect(portsFromBlobPort(10000)).toEqual(DefaultEmulatorPorts);
    });
});

describe('getAzuriteCommand', () => {

    test('is plain azurite for its default ports', () => {

        expect(getAzuriteCommand(DefaultEmulatorPorts)).toBe('azurite');
    });

    test('names the ports otherwise', () => {

        expect(getAzuriteCommand({ blob: 11000, queue: 11001, table: 11002 })).toBe('azurite --blobPort 11000 --queuePort 11001 --tablePort 11002');
    });
});

describe('validateBlobPort', () => {

    test.each(['10000', '1', '65533', ' 11000 '])('accepts %s', text => {

        expect(validateBlobPort(text)).toBeUndefined();
    });

    test.each(['', 'abc', '1e4', '-5', '10.5', '0', '65534', '65535', '70000'])('rejects %s, and says why', text => {

        expect(validateBlobPort(text)).toMatch(/port/i);
    });
});

describe('parseEmulatorEndpoints', () => {

    test('finds nothing in a connection string of an Azure account', () => {

        expect(parseEmulatorEndpoints('DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=abc;EndpointSuffix=core.windows.net')).toEqual({
            blob: undefined, queue: undefined, table: undefined
        });
    });

    test('takes the default port of a scheme that names none', () => {

        expect(parseEmulatorEndpoints('TableEndpoint=https://acme.table.core.windows.net/;BlobEndpoint=http://acme.example/').table).toEqual({ host: 'acme.table.core.windows.net', port: 443 });
        expect(parseEmulatorEndpoints('BlobEndpoint=http://acme.example/').blob).toEqual({ host: 'acme.example', port: 80 });
    });

    test('ignores an endpoint that is not an address', () => {

        expect(parseEmulatorEndpoints('TableEndpoint=not an address;').table).toBeUndefined();
    });
});

describe('isDefaultEmulatorConnectionString', () => {

    test('knows the default from any other', () => {

        expect(isDefaultEmulatorConnectionString(SettingsDefaults.storageEmulatorConnectionString)).toBe(true);
        expect(isDefaultEmulatorConnectionString(buildEmulatorConnectionString(portsFromBlobPort(11000)))).toBe(false);
    });
});

describe('formatEndpoints', () => {

    test('shows ports that follow one another as a range', () => {

        expect(formatEndpoints(parseEmulatorEndpoints(buildEmulatorConnectionString(DefaultEmulatorPorts)))).toBe('127.0.0.1:10000-10002');
    });

    test('lists ports that do not', () => {

        expect(formatEndpoints(parseEmulatorEndpoints(buildEmulatorConnectionString({ blob: 10000, queue: 10005, table: 10002 })))).toBe('127.0.0.1:10000, 10005, 10002');
    });

    test('shows one port once, when every service is behind it', () => {

        expect(formatEndpoints(parseEmulatorEndpoints(buildEmulatorConnectionString({ blob: 5000, queue: 5000, table: 5000 })))).toBe('127.0.0.1:5000');
    });

    test('shows each endpoint when they are on different hosts', () => {

        expect(formatEndpoints({ blob: { host: 'a', port: 1 }, table: { host: 'b', port: 3 } })).toBe('a:1, b:3');
    });

    test('says nothing when there is nothing to say', () => {

        expect(formatEndpoints({})).toBe('');
    });
});
