// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { getBackendUrl, parseBackendBaseUrl } from '../../src/backend/backendUrl';
import { BackendApiPath, DefaultPortRange } from '../../src/constants';

describe('backendBaseUrl', () => {

    test('{portNr} means a free port of the default range', () => {

        expect(parseBackendBaseUrl('http://localhost:{portNr}/durable-functions-monitor/a/p/i'))
            .toEqual({ scheme: 'http', host: 'localhost', portRange: DefaultPortRange });
    });

    test('a range in brackets is picked from', () => {

        expect(parseBackendBaseUrl('http://127.0.0.1:[8080-9080]'))
            .toEqual({ scheme: 'http', host: '127.0.0.1', portRange: { from: 8080, to: 9080 } });
    });

    test('a number is a fixed port', () => {

        expect(parseBackendBaseUrl('http://localhost:8080/')).toEqual({ scheme: 'http', host: 'localhost', port: 8080 });
    });

    test('no port at all means the default range', () => {

        expect(parseBackendBaseUrl('http://localhost')).toEqual({ scheme: 'http', host: 'localhost', portRange: DefaultPortRange });
    });

    test('understands an IPv6 host', () => {

        expect(parseBackendBaseUrl('http://[::1]:{portNr}')).toEqual({ scheme: 'http', host: '[::1]', portRange: DefaultPortRange });
        expect(parseBackendBaseUrl('http://[::1]:[8080-8090]')).toEqual({ scheme: 'http', host: '[::1]', portRange: { from: 8080, to: 8090 } });
    });

    test('rejects what is not a URL', () => {

        expect(parseBackendBaseUrl('')).toBeUndefined();
        expect(parseBackendBaseUrl(undefined)).toBeUndefined();
        expect(parseBackendBaseUrl('localhost:8080')).toBeUndefined();
        expect(parseBackendBaseUrl('ftp://localhost:8080')).toBeUndefined();
    });

    test('whatever path a setting has, the API path is the one of the backend', () => {

        // This one is what the extension used to document, and what many settings.json files still have
        const legacy = parseBackendBaseUrl('http://localhost:{portNr}/a/p/i')!;

        expect(getBackendUrl(legacy, 37080)).toBe(`http://localhost:37080${BackendApiPath}`);
        expect(getBackendUrl(legacy, 37080)).toContain('/durable-functions-monitor/a/p/i');
    });
});
