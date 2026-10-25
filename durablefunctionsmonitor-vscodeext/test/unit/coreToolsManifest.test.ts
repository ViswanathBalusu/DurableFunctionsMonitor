// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { CoreToolsManifest, getCoreToolsDownload, getMinimumCoreToolsVersion } from '../../src/coreTools/manifest';
import { getCoreToolsPlatform } from '../../src/coreTools/platform';
import { isVersionAtLeast, parseVersion } from '../../src/backend/versions';

// What the extension downloads and executes is decided by this one file. These tests are the review
// of it, for the day somebody bumps it.

const supported: [NodeJS.Platform, string][] = [
    ['win32', 'x64'], ['win32', 'arm64'], ['win32', 'ia32'],
    ['linux', 'x64'], ['linux', 'arm64'],
    ['darwin', 'x64'], ['darwin', 'arm64']
];

describe('platform', () => {

    test.each(supported)('%s/%s has something to download', (platform, arch) => {

        const target = getCoreToolsPlatform(platform, arch);
        expect(target).toBeDefined();
        expect(getCoreToolsDownload(target!)).toBeDefined();
    });

    test('the executable is func.exe on Windows only', () => {

        expect(getCoreToolsPlatform('win32', 'x64')?.executable).toBe('func.exe');
        expect(getCoreToolsPlatform('linux', 'x64')?.executable).toBe('func');
        expect(getCoreToolsPlatform('darwin', 'arm64')?.executable).toBe('func');
    });

    test('a platform Core Tools is not published for has none', () => {

        expect(getCoreToolsPlatform('freebsd', 'x64')).toBeUndefined();
        expect(getCoreToolsPlatform('linux', 'ppc64')).toBeUndefined();
        expect(getCoreToolsPlatform('win32', 'mips')).toBeUndefined();
    });
});

describe('the pinned Azure Functions Core Tools', () => {

    test('is a release version, which is newer than the minimum an installed one may be', () => {

        expect(CoreToolsManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(isVersionAtLeast(parseVersion(CoreToolsManifest.version)!, getMinimumCoreToolsVersion())).toBe(true);
    });

    test.each(supported)('%s/%s: the archive is pinned by a SHA-256 and comes from the official release', (platform, arch) => {

        const download = getCoreToolsDownload(getCoreToolsPlatform(platform, arch)!)!;

        expect(download.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(download.size).toBeGreaterThan(10 * 1024 * 1024);
        expect(download.version).toBe(CoreToolsManifest.version);
        expect(download.file).toContain(`.${CoreToolsManifest.version}.zip`);
        expect(download.url).toBe(`https://github.com/Azure/azure-functions-core-tools/releases/download/${CoreToolsManifest.version}/${download.file}`);
    });

    test('Windows gets the small packages, the others the full ones', () => {

        for (const rid of ['win-x64', 'win-arm64', 'win-x86']) {
            expect(CoreToolsManifest.assets[rid].file, rid).toContain('.min.');
            // 'min' is about 70 MB. If that is not so, it is not what we think it is.
            expect(CoreToolsManifest.assets[rid].size, rid).toBeLessThan(150 * 1024 * 1024);
        }

        for (const rid of ['linux-x64', 'linux-arm64', 'osx-x64', 'osx-arm64']) {
            expect(CoreToolsManifest.assets[rid].file, rid).not.toContain('.min.');
        }
    });

    test('has no two archives with the same checksum', () => {

        const checksums = Object.values(CoreToolsManifest.assets).map(a => a.sha256);
        expect(new Set(checksums).size).toBe(checksums.length);
    });

    test('has an entry for every platform the code knows, and for nothing else', () => {

        const rids = supported.map(([platform, arch]) => getCoreToolsPlatform(platform, arch)!.rid).sort();
        expect(Object.keys(CoreToolsManifest.assets).sort()).toEqual(rids);
    });
});
