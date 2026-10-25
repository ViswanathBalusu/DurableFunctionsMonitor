// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as cp from 'child_process';

import { StartsProcessGroup, killProcessTree } from './processTree';

// How many of the last output lines are kept, to tell what went wrong when the process dies
const RecentOutputLineCount = 40;

// Something in the output of func that says that it is not going to work, however long it is waited for
// (func does not exit when its worker cannot start: it keeps trying, and keeps logging)
const KnownProblems: { kind: BackendProblemKind, pattern: RegExp, message: (match: RegExpExecArray) => string }[] = [
    {
        kind: 'storage',
        pattern: /No valid combination of account information found/i,
        message: () => 'The provided Storage Connection String and/or Hub Name seem to be invalid.'
    },
    {
        kind: 'dotnet',
        // The line that says which one. The one below says it needs one, and comes first in the output, so this one has to be tried first
        pattern: /framework '([^']+)', version '([^']+)'[^\r\n]*was not found/i,
        message: m => `The backend needs .NET runtime ${m[2]} (${m[1]}), which is not installed. Install it from https://dotnet.microsoft.com/download/dotnet and start the monitor again.`
    },
    {
        kind: 'dotnet',
        pattern: /You must install or update \.NET to run this application/i,
        message: () => 'The backend needs a .NET runtime that is not installed. Install it from https://dotnet.microsoft.com/download/dotnet and start the monitor again.'
    },
    {
        kind: 'port',
        pattern: /Address already in use|Failed to bind to address|port \d+ is unavailable|EADDRINUSE|WSAEACCES|Only one usage of each socket address/i,
        message: () => 'The backend could not listen on its port, because something else is using it, or the system has reserved it. Set a different port range with the backendBaseUrl setting.'
    }
];

export type KnownProblem = { kind: BackendProblemKind, message: string };

// Looks for a known problem in the output of func
export function findKnownProblem(output: string): KnownProblem | undefined {

    for (const problem of KnownProblems) {

        const match = problem.pattern.exec(output);
        if (match) {
            return { kind: problem.kind, message: problem.message(match) };
        }
    }

    return undefined;
}

// What a known problem is about
export type BackendProblemKind = 'storage' | 'dotnet' | 'port';

// Thrown, when a backend cannot be started. 'kind' says why, when that is known.
export class BackendStartError extends Error {

    constructor(message: string, public readonly kind?: BackendProblemKind) {
        super(message);
        this.name = 'BackendStartError';
    }
}

// Quotes a part of a command line for cmd.exe. What needs no quotes gets none.
export function quoteForCmd(part: string): string {

    if (/^[\w.:=\\/-]+$/.test(part)) {
        return part;
    }

    // A quote inside of the part cannot be written in a quoted string of cmd.exe, and a % would be taken for a variable
    if (/["%]/.test(part)) {
        throw new Error(`Cannot pass ${part} to a command that is run by cmd.exe.`);
    }

    return `"${part}"`;
}

// Tells why a process could not be started. 'spawn ... ENOENT' says that something was not found, and on Windows that is
// also what a path of 260 characters or more looks like: CreateProcess does not take one, though the file is there.
export function explainSpawnError(err: NodeJS.ErrnoException, executablePath: string, platform: NodeJS.Platform = process.platform): string {

    if (platform === 'win32' && executablePath.length >= 260) {
        return `Windows cannot start a program from a path of ${executablePath.length} characters (the limit is 259), and this is the path: ${executablePath}. ` +
            `Install Azure Functions Core Tools in a folder with a shorter path, and set 'durableFunctionsMonitor.customPathToAzureFunctionsHost' to it.`;
    }

    switch (err.code) {
        case 'ENOENT':
            return `There is no program at ${executablePath}, or it cannot be started.`;
        case 'EACCES':
        case 'EPERM':
            return `It is not allowed to run ${executablePath}. Is it executable, and not blocked by an antivirus program?`;
    }

    return err.message;
}

export type FuncHostOptions = {

    // Path to func (or func.exe)
    funcPath: string;

    // The folder with the backend binaries
    workingFolder: string;

    port: number;
    env: NodeJS.ProcessEnv;

    // Arguments to run funcPath with. The default is what func needs; tests run a stand-in with their own.
    args?: string[];

    // Receives every line func writes
    log: (line: string) => void;
};

// Runs a backend: 'func start' in the folder with its binaries
export class FuncHost {

    constructor(private readonly _options: FuncHostOptions) { }

    // Whether the process was started, and is not gone yet
    get isRunning(): boolean {
        return !!this._process && !this._exit;
    }

    // The last lines func wrote
    get recentOutput(): string {
        return this._recentLines.join('\n');
    }

    // Starts the process. Does not wait for the backend to be ready, see waitUntilReady().
    start(): void {

        const { funcPath, workingFolder, port, env } = this._options;
        const args = this._options.args ?? ['start', '--port', port.toString()];

        // Node refuses to run a .cmd or a .bat without a shell (CVE-2024-27980). With a shell, Node would only glue the
        // arguments together, without escaping anything (DEP0190), so the command line is made here, with every part quoted.
        const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(funcPath);

        const options: cp.SpawnOptions = { cwd: workingFolder, env, windowsHide: true, detached: StartsProcessGroup };

        this._process = needsShell ?
            cp.spawn([funcPath, ...args].map(quoteForCmd).join(' '), { ...options, shell: true })
            :
            cp.spawn(funcPath, args, options);

        this.readLines(this._process.stdout, '');
        this.readLines(this._process.stderr, 'stderr: ');

        // Without these two a process that cannot be started (a missing or a damaged executable, no permission)
        // would be an unhandled 'error' event, and one that dies would be noticed by nobody
        this._process.once('error', err => {
            this._spawnError = err;
            this._exit ??= { code: null, signal: null };
            this._options.log(`Failed to run ${funcPath}: ${err.message}`);
        });

        this._process.once('exit', (code, signal) => {
            this._exit = { code, signal };
            this._options.log(`The backend process exited (code: ${code}, signal: ${signal}).`);
        });
    }

    // Waits until the backend answers the probe with a success. Fails when the process dies, when it
    // reports a problem that waiting cannot fix, when the backend says that it does not like us (401),
    // when the time is over, and when the signal is aborted.
    async waitUntilReady(probe: { url: string, headers: Record<string, string> }, timeoutInMs: number, signal?: AbortSignal): Promise<void> {

        const deadline = Date.now() + timeoutInMs;

        while (true) {

            if (signal?.aborted) {
                throw new Error('Cancelled by the user');
            }

            if (this._spawnError) {
                throw new Error(`Failed to run ${this._options.funcPath}. ${explainSpawnError(this._spawnError, this._options.funcPath)}`);
            }

            const known = findKnownProblem(this.recentOutput);
            if (known) {
                throw new BackendStartError(known.message, known.kind);
            }

            if (this._exit) {
                throw new Error(`The backend process exited before it was ready (code: ${this._exit.code}, signal: ${this._exit.signal}).${this.tail()}`);
            }

            try {

                const response = await fetch(probe.url, { headers: probe.headers, signal: AbortSignal.timeout(2000) });

                if (response.ok) {
                    return;
                }

                if (response.status === 401) {
                    // This typically happens when mistyping Task Hub name
                    throw new UnauthorizedError('Backend responded with 401 Unauthorized. This might happen when specifying a non-existent Task Hub name.');
                }

                // Anything else (a 404 for a start) means that the host is up, and has not got to the functions yet

            } catch (err) {

                if (err instanceof UnauthorizedError) {
                    throw err;
                }

                // Not listening yet
            }

            if (Date.now() >= deadline) {
                throw new Error(`No response within ${Math.round(timeoutInMs / 1000)} seconds.${this.tail()}`);
            }

            await new Promise<void>(resolve => setTimeout(resolve, 500));
        }
    }

    // Stops the process, along with everything it started
    async stop(): Promise<void> {

        if (!this._process) {
            return;
        }

        const process = this._process;
        this._process = undefined;

        await killProcessTree(process);
    }

    private _process?: cp.ChildProcess;
    private _exit?: { code: number | null, signal: NodeJS.Signals | null };
    private _spawnError?: Error;
    private _recentLines: string[] = [];

    // Passes lines of a stream to the log, and remembers the last ones
    private readLines(stream: NodeJS.ReadableStream | null, prefix: string): void {

        if (!stream) {
            return;
        }

        let pending = '';

        stream.on('data', (data: Buffer) => {

            pending += data.toString();

            const lines = pending.split(/\r?\n/);
            pending = lines.pop() ?? '';

            for (const line of lines) {
                this.record(prefix + line);
            }
        });

        stream.on('end', () => {

            if (pending) {
                this.record(prefix + pending);
                pending = '';
            }
        });
    }

    private record(line: string): void {

        if (!line.trim()) {
            return;
        }

        this._options.log(line);

        this._recentLines.push(line);
        if (this._recentLines.length > RecentOutputLineCount) {
            this._recentLines.shift();
        }
    }

    // The end of the output, to be appended to an error message
    private tail(): string {

        const lines = this._recentLines.slice(-10);
        return lines.length ? `\nLast output of the backend:\n${lines.join('\n')}` : '';
    }
}

class UnauthorizedError extends Error { }
