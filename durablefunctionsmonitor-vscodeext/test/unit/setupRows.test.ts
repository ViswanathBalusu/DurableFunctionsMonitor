// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import type { DotnetRuntime, FrameworkRequirement } from '../../src/backend/dotnetRuntime';
import type { CoreToolsStatus } from '../../src/coreTools/status';
import { buildEmulatorConnectionString, parseEmulatorEndpoints, portsFromBlobPort } from '../../src/setup/emulator';
import { SetupCommands, describeCoreTools, describeDotnet, describeEmulator, getDotnetStatus } from '../../src/setup/rows';

const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });
const runtime = (major: number, minor: number, patch: number, name = 'Microsoft.NETCore.App'): DotnetRuntime => ({ name, version: v(major, minor, patch) });
const needs10: FrameworkRequirement = { name: 'Microsoft.NETCore.App', version: v(10, 0, 0) };

describe('describeCoreTools', () => {

    const rows = (status: CoreToolsStatus) => describeCoreTools(status);

    test('is fine with a path from the settings, and with a copy that was downloaded or installed', () => {

        expect(rows({ kind: 'custom', path: 'C:\\f\\func.exe' })).toMatchObject({ icon: 'ok', description: 'from your settings' });
        expect(rows({ kind: 'downloaded', path: 'p', version: '4.16.0' })).toMatchObject({ icon: 'ok', description: '4.16.0, downloaded by this extension' });
        expect(rows({ kind: 'system', path: 'p', version: v(4, 9, 0) })).toMatchObject({ icon: 'ok', description: '4.9.0, installed on this machine' });

        // Nothing to do about any of them
        expect(rows({ kind: 'downloaded', path: 'p', version: '4.16.0' }).command).toBeUndefined();
    });

    test('sends a path from the settings that leads nowhere to that setting', () => {

        const row = rows({ kind: 'custom-missing', path: 'C:\\gone\\func.exe' });

        expect(row.icon).toBe('error');
        expect(row.command).toEqual({ command: SetupCommands.openSettings, arguments: ['customPathToAzureFunctionsHost'] });
        expect(row.tooltip).toContain('C:\\gone\\func.exe');
    });

    test('offers the download when there are none, and says how big it is', () => {

        const row = rows({ kind: 'missing', downloadVersion: '4.16.0', downloadSize: 74448896 });

        expect(row.icon).toBe('warning');
        expect(row.description).toBe('not installed, click to download 4.16.0 (71 MB)');
        expect(row.command).toEqual({ command: SetupCommands.installCoreTools });
    });

    test('offers the download when the ones installed are too old, and says which', () => {

        const row = rows({ kind: 'too-old', found: [{ path: 'p', version: v(3, 0, 1) }], minimum: v(4, 1, 2) });

        expect(row.icon).toBe('warning');
        expect(row.description).toBe('too old (3.0.1), 4.1.2 is needed');
        expect(row.command).toEqual({ command: SetupCommands.installCoreTools });
    });

    test('says there is nothing to download for a platform that has no release', () => {

        const row = rows({ kind: 'unsupported', platform: 'freebsd/arm' });

        expect(row.icon).toBe('error');
        expect(row.description).toBe('nothing to download for freebsd/arm');
    });
});

describe('getDotnetStatus', () => {

    test('is ok when the runtime that is asked for is installed, and names the newest of its major version', () => {

        expect(getDotnetStatus(needs10, [runtime(8, 0, 1), runtime(10, 0, 3), runtime(10, 0, 13)])).toEqual({ kind: 'ok', needed: '10.0', found: '10.0.13' });
    });

    test('is missing when only another major version is installed, and lists what is', () => {

        expect(getDotnetStatus(needs10, [runtime(8, 0, 1), runtime(9, 0, 5)])).toEqual({ kind: 'missing', needed: '10.0', installed: ['9.0.5', '8.0.1'] });
    });

    test('does not take the desktop or the ASP.NET runtime for the one that is asked for', () => {

        expect(getDotnetStatus(needs10, [runtime(10, 0, 13, 'Microsoft.AspNetCore.App'), runtime(10, 0, 13, 'Microsoft.WindowsDesktop.App')]))
            .toEqual({ kind: 'missing', needed: '10.0', installed: [] });
    });

    test('says there is no dotnet when there is none to ask', () => {

        expect(getDotnetStatus(needs10, undefined)).toEqual({ kind: 'no-dotnet', needed: '10.0' });
    });

    test('lists what there is when the backend does not say what it needs', () => {

        expect(getDotnetStatus(undefined, [runtime(9, 0, 5), runtime(10, 0, 13)])).toEqual({ kind: 'unknown', installed: ['10.0.13', '9.0.5'] });
    });
});

describe('describeDotnet', () => {

    test('is fine when the runtime is there', () => {

        expect(describeDotnet({ kind: 'ok', needed: '10.0', found: '10.0.13' })).toMatchObject({ icon: 'ok', description: '10.0.13 (the backend needs 10.0)' });
    });

    test('sends a missing runtime to the download page of its version', () => {

        const row = describeDotnet({ kind: 'missing', needed: '10.0', installed: ['9.0.5'] });

        expect(row.icon).toBe('warning');
        expect(row.description).toBe('.NET 10.0 is needed, found 9.0.5');
        expect(row.command).toEqual({ command: SetupCommands.openDotnetDownload, arguments: ['10.0'] });
    });

    test('says when there is no dotnet at all', () => {

        const row = describeDotnet({ kind: 'no-dotnet', needed: '10.0' });

        expect(row.description).toBe('.NET 10.0 is needed, and there is no dotnet on this machine');
        expect(describeDotnet({ kind: 'no-dotnet' }).command?.arguments).toEqual([]);
    });
});

describe('describeEmulator', () => {

    const connString = buildEmulatorConnectionString(portsFromBlobPort(11000));
    const endpoints = parseEmulatorEndpoints(connString);

    test('says where it looks, and that something is listening there', () => {

        const row = describeEmulator(connString, endpoints, 'listening');

        expect(row).toMatchObject({ icon: 'ok', description: '127.0.0.1:11000-11002, listening' });
        expect(row.command).toEqual({ command: SetupCommands.configureStorageEmulator });
    });

    test('warns when nothing is, or only some of it is', () => {

        expect(describeEmulator(connString, endpoints, 'not listening')).toMatchObject({ icon: 'warning', description: '127.0.0.1:11000-11002, nothing is listening' });
        expect(describeEmulator(connString, endpoints, 'partly')).toMatchObject({ icon: 'warning', description: '127.0.0.1:11000-11002, some of it is not listening' });
    });

    test('does not call a connection string of an Azure account an emulator that is not running', () => {

        const azure = 'DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=abc;EndpointSuffix=core.windows.net';

        expect(describeEmulator(azure, parseEmulatorEndpoints(azure), 'unknown')).toMatchObject({ icon: 'ok', description: 'account acme, not a local address' });
    });
});
