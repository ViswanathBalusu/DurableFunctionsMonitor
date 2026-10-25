// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { isRequirementMet, parseDotnetRuntimes, readFrameworkRequirement } from '../../src/backend/dotnetRuntime';
import { parseVersion } from '../../src/backend/versions';

const windowsOutput = `Microsoft.AspNetCore.App 8.0.32 [C:\\Program Files\\dotnet\\shared\\Microsoft.AspNetCore.App]
Microsoft.AspNetCore.App 10.0.13 [C:\\Program Files\\dotnet\\shared\\Microsoft.AspNetCore.App]
Microsoft.NETCore.App 6.0.36 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.NETCore.App 8.0.32 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.13 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.WindowsDesktop.App 10.0.13 [C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App]
`;

const requirement = (version: string, rollForward?: string) => ({ name: 'Microsoft.NETCore.App', version: parseVersion(version)!, rollForward });

describe('parseDotnetRuntimes', () => {

    test('parses the output of dotnet --list-runtimes', () => {

        const runtimes = parseDotnetRuntimes(windowsOutput);

        expect(runtimes).toHaveLength(6);
        expect(runtimes[4]).toEqual({ name: 'Microsoft.NETCore.App', version: { major: 10, minor: 0, patch: 13 } });
    });

    test('parses Unix paths and CRLF, and a preview version', () => {

        const runtimes = parseDotnetRuntimes('Microsoft.NETCore.App 10.0.0-rc.2.25502.107 [/usr/share/dotnet/shared/Microsoft.NETCore.App]\r\nMicrosoft.NETCore.App 9.0.1 [/usr/share/dotnet/shared/Microsoft.NETCore.App]\r\n');

        expect(runtimes.map(r => r.version.major)).toEqual([10, 9]);
    });

    test('ignores what is not a runtime', () => {

        expect(parseDotnetRuntimes('')).toEqual([]);
        expect(parseDotnetRuntimes('No .NET runtimes found.\nCould not execute because the application was not found.')).toEqual([]);
    });
});

describe('isRequirementMet', () => {

    const runtimes = parseDotnetRuntimes(windowsOutput);

    test('a newer patch of the same major version does, as the .NET host decides it', () => {

        expect(isRequirementMet(runtimes, requirement('10.0.0'))).toBe(true);
        expect(isRequirementMet(runtimes, requirement('8.0.0'))).toBe(true);
    });

    test('a version that is not installed does not, and a newer major version does not either', () => {

        expect(isRequirementMet(runtimes, requirement('9.0.0'))).toBe(false);
        expect(isRequirementMet(runtimes, requirement('10.0.20'))).toBe(false);
        expect(isRequirementMet(runtimes, requirement('7.0.0'))).toBe(false);
    });

    test('unless the app allows rolling forward to a newer major version', () => {

        expect(isRequirementMet(runtimes, requirement('9.0.0', 'LatestMajor'))).toBe(true);
        expect(isRequirementMet(runtimes, requirement('9.0.0', 'Major'))).toBe(true);
        // Not even that makes a version that is older than the requirement good enough
        expect(isRequirementMet(runtimes, requirement('11.0.0', 'LatestMajor'))).toBe(false);
    });

    test('only a runtime of the same framework does', () => {

        expect(isRequirementMet(runtimes, { name: 'Microsoft.AspNetCore.App', version: parseVersion('10.0.0')!, rollForward: undefined })).toBe(true);
        expect(isRequirementMet(runtimes, { name: 'Microsoft.WindowsDesktop.App', version: parseVersion('8.0.0')!, rollForward: undefined })).toBe(false);
    });

    test('no runtimes, no luck', () => {

        expect(isRequirementMet([], requirement('10.0.0'))).toBe(false);
    });
});

describe('readFrameworkRequirement', () => {

    let folder: string;

    beforeEach(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-runtime-')); });
    afterEach(() => { fs.rmSync(folder, { recursive: true, force: true }); });

    const write = (name: string, content: object) => fs.writeFileSync(path.join(folder, name), JSON.stringify(content));

    const runtimeConfig = (version: string, extra: object = {}) => ({ runtimeOptions: { tfm: 'net10.0', framework: { name: 'Microsoft.NETCore.App', version }, ...extra } });

    test('reads the runtimeconfig of the assembly the worker config names', () => {

        write('worker.config.json', { description: { defaultWorkerPath: 'app.dll' } });
        write('app.runtimeconfig.json', runtimeConfig('10.0.0'));
        // Another one, that must not be taken for the app's
        write('other.runtimeconfig.json', runtimeConfig('6.0.0'));

        expect(readFrameworkRequirement(folder)).toEqual({ name: 'Microsoft.NETCore.App', version: { major: 10, minor: 0, patch: 0 }, rollForward: undefined });
    });

    test('takes any runtimeconfig, when there is no worker config', () => {

        write('whatever.runtimeconfig.json', runtimeConfig('8.0.0', { rollForward: 'LatestMajor' }));

        expect(readFrameworkRequirement(folder)).toEqual({ name: 'Microsoft.NETCore.App', version: { major: 8, minor: 0, patch: 0 }, rollForward: 'LatestMajor' });
    });

    test('has no requirement for a self-contained app', () => {

        write('app.runtimeconfig.json', { runtimeOptions: { tfm: 'net10.0', includedFrameworks: [{ name: 'Microsoft.NETCore.App', version: '10.0.0' }] } });

        expect(readFrameworkRequirement(folder)).toBeUndefined();
    });

    test('has no requirement for a folder without one, a folder that is not there, and a file that is not JSON', () => {

        expect(readFrameworkRequirement(folder)).toBeUndefined();
        expect(readFrameworkRequirement(path.join(folder, 'missing'))).toBeUndefined();

        fs.writeFileSync(path.join(folder, 'app.runtimeconfig.json'), '{ not json');
        expect(readFrameworkRequirement(folder)).toBeUndefined();
    });
});
