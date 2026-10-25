// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { BackendRequestError, getRequestUrl, isAllowedMethod, isSafeRequestPath, sendToBackend } from '../../src/backend/BackendHttp';
import { TestServer } from './helpers/testServer';

describe('isSafeRequestPath', () => {

    test.each([
        '/orchestrations',
        '/orchestrations?$top=50&$filter=runtimeStatus eq \'Failed\'',
        "/orchestrations('abc')/history",
        '/stats',
        '/function-map',
    ])('accepts %s', url => {
        expect(isSafeRequestPath(url)).toBe(true);
    });

    test.each([
        ['no leading slash', 'orchestrations'],
        ['a host', '//evil.example.com/x'],
        ['a backslash', '/a\\b'],
        ['a line end', '/a\r\nHost: evil'],
        ['climbing out of the Task Hub', '/../../other/route'],
        ['a dot segment', '/./x'],
        ['an empty string', ''],
        ['not a string', 42],
        ['nothing', undefined],
    ])('refuses %s', (_name, url) => {
        expect(isSafeRequestPath(url)).toBe(false);
    });

    test('a query that contains two dots is no climbing', () => {
        expect(isSafeRequestPath('/orchestrations?$filter=name eq \'..\'')).toBe(true);
    });
});

describe('isAllowedMethod', () => {

    test('accepts HTTP methods in any case, and nothing else', () => {

        expect(isAllowedMethod('GET')).toBe(true);
        expect(isAllowedMethod('post')).toBe(true);
        expect(isAllowedMethod('DELETE')).toBe(true);
        expect(isAllowedMethod('SaveAs')).toBe(false);
        expect(isAllowedMethod('CONNECT')).toBe(false);
        expect(isAllowedMethod(undefined)).toBe(false);
    });
});

describe('getRequestUrl', () => {

    test('puts the Task Hub of an unnamed connection between the API path and the request', () => {

        expect(getRequestUrl({ backendUrl: 'http://localhost:37072/durable-functions-monitor/a/p/i', hubName: 'my-hub', url: '/orchestrations?$top=5' }))
            .toBe('http://localhost:37072/durable-functions-monitor/a/p/i/--my-hub/orchestrations?$top=5');
    });
});

describe('sendToBackend', () => {

    let server: TestServer;

    beforeEach(async () => { server = new TestServer(); await server.start(); });
    afterEach(async () => { await server.stop(); });

    const request = (overrides: object = {}) => ({ backendUrl: server.url('/api'), hubName: 'hub', method: 'GET', url: '/thing', nonce: 'the-nonce', ...overrides });

    test('sends the nonce, and returns parsed JSON', async () => {

        let nonce: string | string[] | undefined;
        server.on('/api/--hub/thing', (req, res) => {
            nonce = req.headers['x-dfm-nonce'];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"a":[1,2]}');
        });

        const response = await sendToBackend(request());

        expect(nonce).toBe('the-nonce');
        expect(response.data).toEqual({ a: [1, 2] });
        expect(response.contentType).toBe('application/json');
    });

    test('sends the body of a POST as JSON', async () => {

        let received = '';
        let contentType: string | undefined;
        server.on('/api/--hub/thing', (req, res) => {
            contentType = req.headers['content-type'];
            req.on('data', chunk => received += chunk);
            req.on('end', () => { res.writeHead(200); res.end('{}'); });
        });

        await sendToBackend(request({ method: 'post', data: { name: 'x', n: 1 } }));

        expect(contentType).toBe('application/json');
        expect(JSON.parse(received)).toEqual({ name: 'x', n: 1 });
    });

    test('hands out text that is not JSON as text, and an empty body as an empty string', async () => {

        server.on('/api/--hub/text', (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('just text'); });
        server.on('/api/--hub/empty', (_req, res) => { res.writeHead(200); res.end(); });

        expect((await sendToBackend(request({ url: '/text' }))).data).toBe('just text');
        expect((await sendToBackend(request({ url: '/empty' }))).data).toBe('');
    });

    test('keeps the bytes of a download as they are', async () => {

        const bytes = Buffer.from([0, 255, 128, 10, 13, 0]);
        server.on('/api/--hub/file', (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(bytes); });

        const response = await sendToBackend(request({ url: '/file' }));

        expect(response.bytes.equals(bytes)).toBe(true);
    });

    test('fails with the message the UI parses the status code from, and keeps what the backend said', async () => {

        server.on('/api/--hub/thing', (_req, res) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"no such thing"}'); });

        const error = await sendToBackend(request()).catch(e => e);

        expect(error).toBeInstanceOf(BackendRequestError);
        expect(error.message).toBe('Request failed with status code 404');
        expect(error.responseData).toEqual({ error: 'no such thing' });
    });

    test('fails, when nothing listens', async () => {

        const backendUrl = server.url('/api');
        await server.stop();

        await expect(sendToBackend({ backendUrl, hubName: 'hub', method: 'GET', url: '/thing', nonce: 'n' })).rejects.toThrow();

        // for afterEach, which stops it once more
        server = new TestServer();
        await server.start();
    });
});
