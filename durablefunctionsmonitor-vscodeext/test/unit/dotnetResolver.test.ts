// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';
import { describe, expect, test } from 'vitest';

import { type DotnetResolverDeps, resolveDotnetRuntime } from '../../src/backend/dotnetResolver';
import { type DotnetRuntime, type FrameworkRequirement } from '../../src/backend/dotnetRuntime';

const net10: FrameworkRequirement = { name: 'Microsoft.NETCore.App', version: { major: 10, minor: 0, patch: 0 } };
const runtime = (major: number, minor = 0, patch = 1): DotnetRuntime => ({ name: 'Microsoft.NETCore.App', version: { major, minor, patch } });

function deps(options: {
    onPath?: DotnetRuntime[],
    byPath?: { [dotnetPath: string]: DotnetRuntime[] },
    acquire?: DotnetResolverDeps['acquire'],
    env?: NodeJS.ProcessEnv
}): DotnetResolverDeps & { logLines: string[], asked: (string | undefined)[] } {

    const logLines: string[] = [];
    const asked: (string | undefined)[] = [];

    return {
        listRuntimes: async (dotnetPath?: string) => { asked.push(dotnetPath); return dotnetPath ? options.byPath?.[dotnetPath] : options.onPath; },
        acquire: options.acquire,
        env: options.env ?? {},
        log: (line: string) => { logLines.push(line); },
        logLines,
        asked
    };
}

describe('resolveDotnetRuntime', () => {

    test('a backend that asks for nothing needs nothing', async () => {

        expect(await resolveDotnetRuntime(undefined, deps({}))).toEqual({ status: 'ok', env: {} });
    });

    test('is fine, when the dotnet on PATH has the runtime', async () => {

        const d = deps({ onPath: [runtime(8), runtime(10, 0, 13)] });

        expect(await resolveDotnetRuntime(net10, d)).toEqual({ status: 'ok', env: {} });
        // Nobody is asked to install anything when nothing is missing
        expect(d.asked).toEqual([undefined]);
    });

    test('is fine, when DOTNET_ROOT has it, though the dotnet on PATH does not', async () => {

        const root = path.join(path.sep, 'opt', 'dotnet');
        const dotnet = path.join(root, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');

        const result = await resolveDotnetRuntime(net10, deps({ onPath: [runtime(8)], byPath: { [dotnet]: [runtime(10)] }, env: { DOTNET_ROOT: root } }));

        expect(result).toEqual({ status: 'ok', env: {} });
    });

    test('asks to have it installed, when it is missing, and uses what it is given', async () => {

        const acquired = path.join(path.sep, 'storage', 'dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');

        const result = await resolveDotnetRuntime(net10, deps({
            onPath: [runtime(8)],
            byPath: { [acquired]: [runtime(10)] },
            acquire: async () => acquired,
            env: { PATH: 'the-path' }
        }));

        expect(result).toEqual({
            status: 'ok',
            env: { DOTNET_ROOT: path.dirname(acquired), PATH: `${path.dirname(acquired)}${path.delimiter}the-path` }
        });
    });

    test('asks to have it installed, when there is no dotnet at all', async () => {

        const acquired = path.join(path.sep, 'storage', 'dotnet', 'dotnet');

        const result = await resolveDotnetRuntime(net10, deps({ onPath: undefined, byPath: { [acquired]: [runtime(10)] }, acquire: async () => acquired }));

        expect(result.status).toBe('ok');
    });

    test('says what to install, when it is missing and nobody can install it', async () => {

        const result = await resolveDotnetRuntime(net10, deps({ onPath: [runtime(8), runtime(9)] }));

        expect(result.status).toBe('missing');
        expect((result as any).message).toContain('.NET runtime 10.0.0');
        expect((result as any).message).toContain('https://dotnet.microsoft.com/download/dotnet/10.0');
    });

    test('says the same, when the installation was refused', async () => {

        const result = await resolveDotnetRuntime(net10, deps({ onPath: [], acquire: async () => undefined }));

        expect(result.status).toBe('missing');
    });

    test('does not take a dotnet that was provided, but has the wrong runtime', async () => {

        const acquired = path.join(path.sep, 'storage', 'dotnet', 'dotnet');

        const d = deps({ onPath: [runtime(8)], byPath: { [acquired]: [runtime(9)] }, acquire: async () => acquired });
        const result = await resolveDotnetRuntime(net10, d);

        expect(result.status).toBe('missing');
        expect(d.logLines.join('\n')).toContain('does not have');
    });

    test('says what is installed and what is not, in the log', async () => {

        const d = deps({ onPath: [runtime(8, 0, 32), runtime(6, 0, 36)] });

        await resolveDotnetRuntime(net10, d);

        expect(d.logLines.join('\n')).toContain('Microsoft.NETCore.App 10.0.0 was not found (installed: 8.0.32, 6.0.36)');
    });
});
