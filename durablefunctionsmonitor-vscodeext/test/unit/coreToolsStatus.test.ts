// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import type { FuncSearchResult } from '../../src/coreTools/discovery';
import { type CoreToolsStatusDeps, resolveCoreToolsStatus } from '../../src/coreTools/status';

const minimum = { major: 4, minor: 1, patch: 2 };

// By default there is nothing, anywhere, and a download that would fix that
function deps(overrides: Partial<CoreToolsStatusDeps> = {}, search: FuncSearchResult = { tooOld: [] }): CoreToolsStatusDeps {

    return {
        customPath: '',
        resolveCustomPath: () => undefined,
        managed: { version: '4.16.0', size: 74000000 },
        search: async () => search,
        minimumVersion: minimum,
        platform: 'win32/x64',
        ...overrides
    };
}

describe('resolveCoreToolsStatus', () => {

    test('prefers the path of the settings, and does not look further', async () => {

        const status = await resolveCoreToolsStatus(deps({
            customPath: ' C:\\tools\\func.exe ',
            resolveCustomPath: custom => custom,
            managed: { path: 'C:\\managed\\func.exe', version: '4.16.0', size: 1 },
            search: async () => { throw new Error('should not be asked'); }
        }));

        expect(status).toEqual({ kind: 'custom', path: 'C:\\tools\\func.exe' });
    });

    test('says so when the path of the settings leads nowhere, instead of falling back to another', async () => {

        const status = await resolveCoreToolsStatus(deps({
            customPath: 'nowhere',
            managed: { path: 'C:\\managed\\func.exe', version: '4.16.0', size: 1 }
        }));

        expect(status).toEqual({ kind: 'custom-missing', path: 'nowhere' });
    });

    test('takes the copy this extension downloaded before one that is installed', async () => {

        const status = await resolveCoreToolsStatus(deps(
            { managed: { path: 'C:\\managed\\func.exe', version: '4.16.0', size: 1 } },
            { tooOld: [], found: { path: 'C:\\npm\\func.cmd', version: { major: 4, minor: 9, patch: 0 } } }));

        expect(status).toEqual({ kind: 'downloaded', path: 'C:\\managed\\func.exe', version: '4.16.0' });
    });

    test('takes one that is installed and new enough', async () => {

        const found = { path: 'C:\\npm\\func.cmd', version: { major: 4, minor: 9, patch: 0 } };

        expect(await resolveCoreToolsStatus(deps({}, { tooOld: [], found }))).toEqual({ kind: 'system', path: found.path, version: found.version });
    });

    test('reports the ones that are installed and too old', async () => {

        const old = { path: 'C:\\npm\\func.cmd', version: { major: 3, minor: 0, patch: 1 } };

        expect(await resolveCoreToolsStatus(deps({}, { tooOld: [old] }))).toEqual({ kind: 'too-old', found: [old], minimum });
    });

    test('offers the download when there is none', async () => {

        expect(await resolveCoreToolsStatus(deps())).toEqual({ kind: 'missing', downloadVersion: '4.16.0', downloadSize: 74000000 });
    });

    test('offers a download that is not there yet, even when the copy was not downloaded', async () => {

        // managed without a path: this version could be had, and has not been
        expect((await resolveCoreToolsStatus(deps({ managed: { version: '4.16.0', size: 5 } }))).kind).toBe('missing');
    });

    test('says there is nothing to download for a platform that has no release', async () => {

        expect(await resolveCoreToolsStatus(deps({ managed: undefined, platform: 'freebsd/arm' }))).toEqual({ kind: 'unsupported', platform: 'freebsd/arm' });
    });

    test('still uses an installed one on a platform that has no release', async () => {

        const found = { path: '/usr/bin/func', version: { major: 4, minor: 9, patch: 0 } };

        expect((await resolveCoreToolsStatus(deps({ managed: undefined }, { tooOld: [], found }))).kind).toBe('system');
    });
});
