// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { FuncHost, findKnownProblem } from '../../src/backend/FuncHost';
import { findFreePort } from '../../src/backend/ports';

// The host is started as 'node fakeBackend.cjs <mode> <port>' instead of 'func start --port <port>'
const fakeBackend = path.resolve(__dirname, 'helpers', 'fakeBackend.cjs');

let work: string;
const hosts: FuncHost[] = [];

beforeEach(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-funchost-')); });

afterEach(async () => {
    await Promise.all(hosts.splice(0).map(h => h.stop()));
    fs.rmSync(work, { recursive: true, force: true });
});

// Starts a host of the given kind, and returns it with the lines it logged and what to probe
async function start(mode: string, extraArgs: string[] = []) {

    const port = await findFreePort(40000, 41000);
    const log: string[] = [];

    const host = new FuncHost({
        funcPath: process.execPath,
        args: [fakeBackend, mode, port.toString(), ...extraArgs],
        workingFolder: work,
        port,
        env: { ...process.env },
        log: line => log.push(line)
    });
    hosts.push(host);
    host.start();

    return { host, log, probe: { url: `http://127.0.0.1:${port}/probe`, headers: { 'x-dfm-nonce': 'n' } } };
}

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('FuncHost', () => {

    test('waits until the backend stops answering 404, and then is ready', async () => {

        const { host, probe } = await start('ready');

        const started = Date.now();
        await host.waitUntilReady(probe, 20000);

        expect(Date.now() - started).toBeGreaterThanOrEqual(500);
        expect(host.isRunning).toBe(true);
    });

    test('logs every line of the output', async () => {

        const { host, log, probe } = await start('ready');

        await host.waitUntilReady(probe, 20000);

        expect(log).toContain('Azure Functions Core Tools (fake)');
    });

    test('is not put off by what func writes to stderr: that is not a failure', async () => {

        // The old code rejected the start on the first byte of stderr
        const { host, log, probe } = await start('ready-noisy');

        await host.waitUntilReady(probe, 20000);

        expect(log.some(l => l.startsWith('stderr: warn: something'))).toBe(true);
    });

    test('fails when the process exits before it is ready, and says what it wrote last', async () => {

        const { host, probe } = await start('exits');

        const error = await host.waitUntilReady(probe, 20000).catch(e => e);

        expect(error.message).toContain('exited before it was ready (code: 3');
        expect(error.message).toContain('about to fail');
        expect(error.message).toContain('stderr: it went wrong');
        expect(host.isRunning).toBe(false);
    });

    test('fails at once on a bad connection string, instead of waiting for the timeout', async () => {

        const { host, probe } = await start('bad-account');

        const started = Date.now();
        const error = await host.waitUntilReady(probe, 20000).catch(e => e);

        expect(error.message).toBe('The provided Storage Connection String and/or Hub Name seem to be invalid.');
        expect(Date.now() - started).toBeLessThan(10000);
    });

    test('fails at once, with the version to install, when the .NET runtime is missing', async () => {

        // func does not exit in that case: it keeps starting a worker that cannot start
        const { host, probe } = await start('no-dotnet');

        const error = await host.waitUntilReady(probe, 20000).catch(e => e);

        expect(error.message).toContain('needs .NET runtime 10.0.0 (Microsoft.NETCore.App)');
        expect(error.message).toContain('https://dotnet.microsoft.com/download');
    });

    test('fails at once, with the way out, when the port cannot be listened on', async () => {

        const { host, probe } = await start('port-taken');

        const error = await host.waitUntilReady(probe, 20000).catch(e => e);

        expect(error.message).toContain('could not listen on its port');
        expect(error.message).toContain('backendBaseUrl');
    });

    test('fails on 401, which is what an unknown Task Hub gets', async () => {

        const { host, probe } = await start('401');

        const error = await host.waitUntilReady(probe, 20000).catch(e => e);

        expect(error.message).toContain('401 Unauthorized');
    });

    test('fails when the time is over, and says what the backend wrote last', async () => {

        const { host, probe } = await start('never-ready');

        const error = await host.waitUntilReady(probe, 1500).catch(e => e);

        expect(error.message).toContain('No response within 2 seconds');
        expect(error.message).toContain('Host started, no functions');
    });

    test('stops waiting when it is cancelled', async () => {

        const { host, probe } = await start('never-ready');

        const cancel = new AbortController();
        setTimeout(() => cancel.abort(), 300);

        const error = await host.waitUntilReady(probe, 20000, cancel.signal).catch(e => e);

        expect(error.message).toBe('Cancelled by the user');
    });

    test('fails with a message, not an unhandled error, when the executable cannot be run', async () => {

        const host = new FuncHost({
            funcPath: path.join(work, 'there-is-no-func-here'),
            workingFolder: work,
            port: 40001,
            env: {},
            log: () => { }
        });
        hosts.push(host);

        host.start();

        const error = await host.waitUntilReady({ url: 'http://127.0.0.1:40001/probe', headers: {} }, 20000).catch(e => e);

        expect(error.message).toContain('Failed to run');
        expect(error.message).toContain('there-is-no-func-here');
    });

    test('stops the process, along with what it started', async () => {

        const pidFile = path.join(work, 'worker.pid');
        const { host } = await start('family', [pidFile]);

        // Waiting for the worker to be there
        for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const workerPid = parseInt(fs.readFileSync(pidFile, 'utf8'));
        expect(isAlive(workerPid)).toBe(true);

        await host.stop();

        expect(host.isRunning).toBe(false);

        // The process is gone a moment after it is told to
        for (let i = 0; i < 50 && isAlive(workerPid); i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(isAlive(workerPid)).toBe(false);
    });

    test('stopping twice is fine, and so is stopping what never started', async () => {

        const { host } = await start('never-ready');

        await host.stop();
        await host.stop();

        const never = new FuncHost({ funcPath: process.execPath, workingFolder: work, port: 1, env: {}, log: () => { } });
        await never.stop();
    });

    test('listens where it is told to: the port it was given is the port the process is started with', async () => {

        const { host, probe } = await start('ready');
        await host.waitUntilReady(probe, 20000);

        const port = new URL(probe.url).port;
        const listening = await new Promise<boolean>(resolve => {
            const socket = net.connect(parseInt(port), '127.0.0.1', () => { socket.destroy(); resolve(true); });
            socket.once('error', () => resolve(false));
        });

        expect(listening).toBe(true);
    });
});

describe('findKnownProblem', () => {

    test('knows the .NET runtime that is missing, with its version', () => {

        const output = "You must install or update .NET to run this application.\nApp: x\nThe framework 'Microsoft.NETCore.App', version '10.0.0' (x64) was not found.\n  - The following frameworks were found:\n      8.0.32";

        expect(findKnownProblem(output)?.message).toContain('.NET runtime 10.0.0');
        expect(findKnownProblem(output)?.kind).toBe('dotnet');
    });

    test('knows the .NET runtime that is missing, without a version', () => {

        expect(findKnownProblem('You must install or update .NET to run this application.')?.message).toContain('needs a .NET runtime');
    });

    test('knows a port that is in use, and one that is reserved by Windows', () => {

        expect(findKnownProblem('System.IO.IOException: Failed to bind to address http://0.0.0.0:37072: address already in use.')?.kind).toBe('port');
        expect(findKnownProblem('Only one usage of each socket address (protocol/network address/port) is normally permitted')?.kind).toBe('port');
        expect(findKnownProblem('SocketException (10013): WSAEACCES')?.kind).toBe('port');
    });

    test('knows a connection string that is not one', () => {

        expect(findKnownProblem('Microsoft.WindowsAzure.Storage: No valid combination of account information found.')?.kind).toBe('storage');
    });

    test('knows nothing about a log that is fine', () => {

        expect(findKnownProblem('Azure Functions Core Tools\nCore Tools Version: 4.16.0\nWorker process started and initialized.\nFunctions:\n\tDfmAboutFunction: [GET] http://localhost:37072/x')).toBeUndefined();
    });
});
