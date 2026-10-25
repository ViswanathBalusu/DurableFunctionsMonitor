// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ChecksumMismatchError, downloadFile } from '../../src/coreTools/download';
import { TestServer } from './helpers/testServer';

const content = Buffer.alloc(300 * 1024, 'durable functions monitor ');
const sha256 = crypto.createHash('sha256').update(content).digest('hex');

let work: string;
let server: TestServer;

beforeEach(async () => {

    work = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-download-'));
    server = new TestServer();
    await server.start();
});

afterEach(async () => {

    await server.stop();
    fs.rmSync(work, { recursive: true, force: true });
});

// Whatever is left in a folder, partial files included
const listFiles = (folder: string) => fs.existsSync(folder) ? fs.readdirSync(folder) : [];

describe('downloadFile', () => {

    test('downloads a file and reports progress', async () => {

        server.serve('/func.zip', content);
        const destination = path.join(work, 'func.zip');

        const progress: [number, number | undefined][] = [];
        await downloadFile({ url: server.url('/func.zip'), destination, sha256, onProgress: (r, t) => progress.push([r, t]) });

        expect(fs.readFileSync(destination).equals(content)).toBe(true);
        expect(progress.length).toBeGreaterThan(0);
        expect(progress[progress.length - 1]).toEqual([content.length, content.length]);
        expect(listFiles(work)).toEqual(['func.zip']);
    });

    test('follows redirects, which is how GitHub serves its release assets', async () => {

        server.serve('/cdn/func.zip', content);
        server.on('/releases/func.zip', (_req, res) => { res.writeHead(302, { Location: '/cdn/func.zip' }); res.end(); });

        const destination = path.join(work, 'func.zip');
        await downloadFile({ url: server.url('/releases/func.zip'), destination, sha256 });

        expect(fs.readFileSync(destination).equals(content)).toBe(true);
    });

    test('creates the folder of the destination', async () => {

        server.serve('/func.zip', content);
        const destination = path.join(work, 'a', 'b', 'func.zip');

        await downloadFile({ url: server.url('/func.zip'), destination, sha256 });

        expect(fs.existsSync(destination)).toBe(true);
    });

    test('does not keep a file that is not the one that was pinned', async () => {

        // Same size, other bytes: a replaced release asset
        server.serve('/func.zip', Buffer.alloc(content.length, 'tampered'));
        const destination = path.join(work, 'func.zip');

        const error = await downloadFile({ url: server.url('/func.zip'), destination, sha256 }).catch(e => e);

        expect(error).toBeInstanceOf(ChecksumMismatchError);
        expect(error.expected).toBe(sha256);
        expect(error.actual).not.toBe(sha256);
        // Neither the file nor the temporary one
        expect(listFiles(work)).toEqual([]);
    });

    test('accepts an upper-case checksum', async () => {

        server.serve('/func.zip', content);
        await downloadFile({ url: server.url('/func.zip'), destination: path.join(work, 'func.zip'), sha256: sha256.toUpperCase() });
    });

    test('fails on an HTTP error, leaving nothing', async () => {

        const destination = path.join(work, 'func.zip');

        await expect(downloadFile({ url: server.url('/missing.zip'), destination, sha256 })).rejects.toThrow(/HTTP 404/);

        expect(listFiles(work)).toEqual([]);
    });

    test('gives up on a server that stops sending, instead of waiting forever', async () => {

        // Sends a part and then nothing
        server.on('/func.zip', (_req, res) => {
            res.writeHead(200, { 'Content-Length': content.length });
            res.write(content.subarray(0, 1000));
        });

        const started = Date.now();
        const error = await downloadFile({ url: server.url('/func.zip'), destination: path.join(work, 'func.zip'), sha256, stallTimeoutInMs: 500 }).catch(e => e);

        expect(error.message).toMatch(/No data received/);
        expect(Date.now() - started).toBeLessThan(10000);
        expect(listFiles(work)).toEqual([]);
    });

    test('stops when it is cancelled', async () => {

        server.on('/func.zip', (_req, res) => {
            res.writeHead(200, { 'Content-Length': content.length });
            res.write(content.subarray(0, 1000));
        });

        const cancel = new AbortController();
        const download = downloadFile({ url: server.url('/func.zip'), destination: path.join(work, 'func.zip'), sha256, signal: cancel.signal, stallTimeoutInMs: 60000 });

        setTimeout(() => cancel.abort(new Error('Cancelled by the user')), 200);

        await expect(download).rejects.toThrow('Cancelled by the user');
        expect(listFiles(work)).toEqual([]);
    });

    test('does not even start, when it is cancelled already', async () => {

        const cancel = new AbortController();
        cancel.abort(new Error('Cancelled by the user'));

        await expect(downloadFile({ url: server.url('/func.zip'), destination: path.join(work, 'func.zip'), sha256, signal: cancel.signal })).rejects.toThrow('Cancelled by the user');
        expect(server.requests).toEqual([]);
    });
});
