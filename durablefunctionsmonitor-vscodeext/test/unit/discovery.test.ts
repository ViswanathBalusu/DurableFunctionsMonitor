// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';
import { describe, expect, test } from 'vitest';

import { type FuncDiscoveryDeps, findInstalledFunc, getCandidatePaths, resolveCommandOnPath } from '../../src/coreTools/discovery';
import { parseVersion } from '../../src/backend/versions';

const minimum = parseVersion('4.1.2')!;

// A machine, as far as finding func is concerned: which files exist, what they say their version is, and what is a link to what
function machine(options: {
    platform: NodeJS.Platform,
    env?: NodeJS.ProcessEnv,
    files?: { [file: string]: string | undefined },
    links?: { [link: string]: string }
}): FuncDiscoveryDeps & { asked: string[] } {

    const files = options.files ?? {};
    const asked: string[] = [];

    return {
        platform: options.platform,
        env: options.env ?? {},
        homeDir: path.join(path.sep, 'home', 'me'),
        isFile: p => p in files,
        realPath: p => options.links?.[p] ?? p,
        getVersion: async p => {
            asked.push(p);
            return parseVersion(files[p]);
        },
        asked
    };
}

describe('getCandidatePaths', () => {

    test('PATH comes first, in its order, and then the places package managers install to', () => {

        const deps = machine({ platform: 'linux', env: { PATH: ['one', 'two'].join(':') } });

        const candidates = getCandidatePaths(deps);

        expect(candidates.slice(0, 2)).toEqual([path.join('one', 'func'), path.join('two', 'func')]);
        expect(candidates).toContain('/usr/local/bin/func');
        expect(candidates).toContain(path.join(path.sep, 'home', 'me', '.local', 'bin', 'func'));
    });

    test('on Windows tries func.exe, then the launchers, in every folder of PATH (written as Path)', () => {

        const deps = machine({ platform: 'win32', env: { Path: 'one;"two"', ProgramFiles: 'PF' } });

        const candidates = getCandidatePaths(deps);

        expect(candidates.slice(0, 6)).toEqual([
            path.join('one', 'func.exe'), path.join('one', 'func.cmd'), path.join('one', 'func.bat'),
            path.join('two', 'func.exe'), path.join('two', 'func.cmd'), path.join('two', 'func.bat')
        ]);
        expect(candidates).toContain(path.join('PF', 'Microsoft', 'Azure Functions Core Tools', 'func.exe'));
    });

    test('lists nothing twice', () => {

        const deps = machine({ platform: 'darwin', env: { PATH: '/usr/local/bin:/usr/local/bin:/opt/homebrew/bin' } });

        const candidates = getCandidatePaths(deps);

        expect(new Set(candidates).size).toBe(candidates.length);
    });

    test('knows macOS homebrew, which a VsCode started from the dock does not have on its PATH', () => {

        expect(getCandidatePaths(machine({ platform: 'darwin', env: { PATH: '/usr/bin' } }))).toContain('/opt/homebrew/bin/func');
    });
});

describe('findInstalledFunc', () => {

    test('finds nothing on a machine that has nothing', async () => {

        const result = await findInstalledFunc(minimum, machine({ platform: 'linux', env: { PATH: 'bin' } }));

        expect(result.found).toBeUndefined();
        expect(result.tooOld).toEqual([]);
    });

    test('finds func on PATH', async () => {

        const funcPath = path.join('bin', 'func');
        const result = await findInstalledFunc(minimum, machine({ platform: 'linux', env: { PATH: 'bin' }, files: { [funcPath]: '4.16.0' } }));

        expect(result.found).toEqual({ path: funcPath, version: { major: 4, minor: 16, patch: 0 } });
    });

    test('does not run what is not there', async () => {

        const deps = machine({ platform: 'linux', env: { PATH: 'a:b' }, files: { [path.join('b', 'func')]: '4.16.0' } });

        await findInstalledFunc(minimum, deps);

        expect(deps.asked).toEqual([path.join('b', 'func')]);
    });

    test('skips one that is too old, takes the next one that is not, and says which were too old', async () => {

        const old = path.join('a', 'func');
        const current = path.join('b', 'func');
        const deps = machine({ platform: 'linux', env: { PATH: 'a:b' }, files: { [old]: '3.0.5198', [current]: '4.13.0' } });

        const result = await findInstalledFunc(minimum, deps);

        expect(result.found?.path).toBe(current);
        expect(result.tooOld).toEqual([{ path: old, version: { major: 3, minor: 0, patch: 5198 } }]);
    });

    test('reports the old ones, when there is nothing better', async () => {

        const old = path.join('a', 'func');
        const result = await findInstalledFunc(minimum, machine({ platform: 'linux', env: { PATH: 'a' }, files: { [old]: '4.0.4629' } }));

        expect(result.found).toBeUndefined();
        expect(result.tooOld.map(f => f.path)).toEqual([old]);
    });

    test('skips what does not say its version', async () => {

        const broken = path.join('a', 'func');
        const good = path.join('b', 'func');
        const log: string[] = [];

        const result = await findInstalledFunc(minimum, machine({ platform: 'linux', env: { PATH: 'a:b' }, files: { [broken]: 'segmentation fault', [good]: '4.16.0' } }), l => log.push(l));

        expect(result.found?.path).toBe(good);
        expect(log.join('\n')).toContain(broken);
    });

    test('takes the real func behind the launcher that npm leaves on PATH (Windows)', async () => {

        const launcher = path.join('npm', 'func.cmd');
        const real = path.join('npm', 'node_modules', 'azure-functions-core-tools', 'bin', 'func.exe');
        const deps = machine({ platform: 'win32', env: { PATH: 'npm' }, files: { [launcher]: undefined, [real]: '4.14.0' } as any });

        const result = await findInstalledFunc(minimum, deps);

        // Not the launcher: that one starts Node, which starts func, and killing it leaves func behind
        expect(result.found?.path).toBe(real);
        expect(deps.asked).toEqual([real]);
    });

    test('has nothing to run, when there is a launcher and no func behind it (Windows)', async () => {

        const launcher = path.join('npm', 'func.cmd');
        const deps = machine({ platform: 'win32', env: { PATH: 'npm' }, files: { [launcher]: '4.14.0' } });

        const result = await findInstalledFunc(minimum, deps);

        expect(result.found).toBeUndefined();
        expect(deps.asked).toEqual([]);
    });

    test('takes the real func behind the link npm leaves on PATH (Linux, macOS)', async () => {

        const packageRoot = path.join(path.sep, 'usr', 'lib', 'node_modules', 'azure-functions-core-tools');
        const link = path.join(path.sep, 'usr', 'bin', 'func');
        const native = path.join(packageRoot, 'bin', 'func');

        const deps = machine({
            platform: 'linux',
            env: { PATH: path.join(path.sep, 'usr', 'bin') },
            files: { [link]: '4.14.0', [native]: '4.14.0' },
            links: { [link]: path.join(packageRoot, 'lib', 'main.js') }
        });

        const result = await findInstalledFunc(minimum, deps);

        expect(result.found?.path).toBe(native);
    });

    test('leaves a func that is not from npm alone, even when it is a link', async () => {

        const link = path.join(path.sep, 'usr', 'bin', 'func');
        const target = path.join(path.sep, 'opt', 'azure-functions-core-tools-bin', 'func');

        const deps = machine({
            platform: 'linux',
            env: { PATH: path.join(path.sep, 'usr', 'bin') },
            files: { [link]: '4.14.0' },
            links: { [link]: target }
        });

        const result = await findInstalledFunc(minimum, deps);

        expect(result.found?.path).toBe(link);
    });
});

describe('resolveCommandOnPath', () => {

    test('finds a plain command in the first folder of PATH that has it', () => {

        const wanted = path.join('b', 'func');
        const deps = machine({ platform: 'linux', env: { PATH: 'a:b:c' }, files: { [wanted]: '4.16.0', [path.join('c', 'func')]: '4.0.0' } });

        expect(resolveCommandOnPath('func', deps)).toBe(wanted);
    });

    test('on Windows finds it with the extension it runs with, as a shell would', () => {

        const deps = machine({ platform: 'win32', env: { Path: 'x;y' }, files: { [path.join('y', 'func.cmd')]: '4.16.0' } });

        expect(resolveCommandOnPath('func', deps)).toBe(path.join('y', 'func.cmd'));
    });

    test('finds nothing that is not there', () => {

        expect(resolveCommandOnPath('func', machine({ platform: 'linux', env: { PATH: 'a:b' } }))).toBeUndefined();
    });

    test('a path is not a command name: it is not looked for on PATH', () => {

        const deps = machine({ platform: 'linux', env: { PATH: 'a' }, files: { [path.join('a', 'tools', 'func')]: '4.16.0' } });

        expect(resolveCommandOnPath('tools/func', deps)).toBeUndefined();
        expect(resolveCommandOnPath('..' + path.sep + 'func', deps)).toBeUndefined();
        expect(resolveCommandOnPath('', deps)).toBeUndefined();
    });
});
