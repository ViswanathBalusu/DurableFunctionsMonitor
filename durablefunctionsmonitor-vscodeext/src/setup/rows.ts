// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { type DotnetRuntime, type FrameworkRequirement, isRequirementMet } from '../backend/dotnetRuntime';
import { compareVersions, formatVersion } from '../backend/versions';
import type { CoreToolsStatus } from '../coreTools/status';
import { ConnStringUtils } from '../connections/ConnStringUtils';
import { SettingsSection } from '../constants';
import { type EmulatorEndpoints, formatEndpoints } from './emulator';
import type { EmulatorState } from './probe';

// What the Setup group of the tree says: one row for each thing the backend needs from the machine, with what it found and what to do about it.
// Has no dependency on VsCode: the tree turns a row into a tree item.

export const SetupCommands = {
    installCoreTools: 'durable-functions-monitor.installCoreTools',
    configureStorageEmulator: 'durable-functions-monitor.configureStorageEmulator',
    openSettings: 'durable-functions-monitor.openSettings',
    openDotnetDownload: 'durable-functions-monitor.openDotnetDownload'
};

export type SetupRow = {

    id: 'coreTools' | 'dotnet' | 'emulator';
    label: string;
    description: string;
    tooltip: string;
    icon: 'ok' | 'warning' | 'error';

    // Run when the row is clicked
    command?: { command: string, arguments?: unknown[] };
};

export function describeCoreTools(status: CoreToolsStatus): SetupRow {

    const label = 'Azure Functions Core Tools';
    const download = { command: SetupCommands.installCoreTools };

    switch (status.kind) {

        case 'custom':
            return {
                id: 'coreTools', label, icon: 'ok', description: 'from your settings',
                tooltip: `${status.path}\n\nThe setting '${SettingsSection}.customPathToAzureFunctionsHost' points to it.`
            };

        case 'custom-missing':
            return {
                id: 'coreTools', label, icon: 'error', description: 'not found at the path in your settings',
                tooltip: `The setting '${SettingsSection}.customPathToAzureFunctionsHost' points to ${status.path}, and there is nothing there. Click to change it.`,
                command: { command: SetupCommands.openSettings, arguments: ['customPathToAzureFunctionsHost'] }
            };

        case 'downloaded':
            return {
                id: 'coreTools', label, icon: 'ok', description: `${status.version}, downloaded by this extension`,
                tooltip: status.path
            };

        case 'system':
            return {
                id: 'coreTools', label, icon: 'ok', description: `${formatVersion(status.version)}, installed on this machine`,
                tooltip: status.path
            };

        case 'too-old':
            return {
                id: 'coreTools', label, icon: 'warning', description: `too old (${status.found.map(f => formatVersion(f.version)).join(', ')}), ${formatVersion(status.minimum)} is needed`,
                tooltip: `${status.found.map(f => `${f.path} is ${formatVersion(f.version)}`).join('\n')}\n\nClick to download the release this extension was tested with.`,
                command: download
            };

        case 'missing':
            return {
                id: 'coreTools', label, icon: 'warning', description: `not installed, click to download ${status.downloadVersion} (${Math.round(status.downloadSize / 1048576)} MB)`,
                tooltip: 'They run the backend. The extension downloads them into its own storage the first time a Task Hub is opened, unless the setting says not to.',
                command: download
            };

        default:
            return {
                id: 'coreTools', label, icon: 'error', description: `nothing to download for ${status.platform}`,
                tooltip: `Install Azure Functions Core Tools v4 yourself, and point '${SettingsSection}.customPathToAzureFunctionsHost' to the func executable. Click to change the setting.`,
                command: { command: SetupCommands.openSettings, arguments: ['customPathToAzureFunctionsHost'] }
            };
    }
}

// What the machine has of the .NET runtime that the backend was built for
export type DotnetStatus =
    // There is no dotnet to ask
    | { kind: 'no-dotnet', needed?: string }
    // The backend's requirement is met by this one
    | { kind: 'ok', needed: string, found: string }
    // These are installed, and none of them is enough
    | { kind: 'missing', needed: string, installed: string[] }
    // The requirement of the backend is not known (its folder is not there to be read), so these are what there is
    | { kind: 'unknown', installed: string[] };

const FrameworkName = 'Microsoft.NETCore.App';

export function getDotnetStatus(requirement: FrameworkRequirement | undefined, runtimes: DotnetRuntime[] | undefined): DotnetStatus {

    const needed = requirement ? `${requirement.version.major}.${requirement.version.minor}` : undefined;

    if (!runtimes) {
        return { kind: 'no-dotnet', needed };
    }

    const installed = runtimes
        .filter(r => r.name === FrameworkName)
        .sort((a, b) => compareVersions(b.version, a.version))
        .map(r => formatVersion(r.version));

    if (!requirement || !needed) {
        return { kind: 'unknown', installed };
    }

    if (isRequirementMet(runtimes, requirement)) {

        // The newest one of the major version that is asked for
        const found = installed.find(v => v.startsWith(`${requirement.version.major}.`)) ?? installed[0];
        return { kind: 'ok', needed, found };
    }

    return { kind: 'missing', needed, installed };
}

export function describeDotnet(status: DotnetStatus): SetupRow {

    const label = '.NET runtime';
    const offer = 'The extension offers to install it with the .NET Install Tool when a backend is started. Click to open the download page instead.';
    const download = { command: SetupCommands.openDotnetDownload, arguments: [] as unknown[] };

    switch (status.kind) {

        case 'ok':
            return { id: 'dotnet', label, icon: 'ok', description: `${status.found} (the backend needs ${status.needed})`, tooltip: 'Microsoft.NETCore.App' };

        case 'missing':
            return {
                id: 'dotnet', label, icon: 'warning',
                description: `.NET ${status.needed} is needed, ${status.installed.length ? `found ${status.installed.join(', ')}` : 'none found'}`,
                tooltip: offer, command: { ...download, arguments: [status.needed] }
            };

        case 'no-dotnet':
            return {
                id: 'dotnet', label, icon: 'warning',
                description: status.needed ? `.NET ${status.needed} is needed, and there is no dotnet on this machine` : 'there is no dotnet on this machine',
                tooltip: offer, command: { ...download, arguments: status.needed ? [status.needed] : [] }
            };

        default:
            return {
                id: 'dotnet', label, icon: 'ok',
                description: status.installed.length ? status.installed.join(', ') : 'none found',
                tooltip: 'The backend to check against is not there, so this is what the machine has.'
            };
    }
}

export function describeEmulator(connString: string, endpoints: EmulatorEndpoints, state: EmulatorState): SetupRow {

    const label = 'Storage emulator';
    const configure = { command: SetupCommands.configureStorageEmulator };
    const where = formatEndpoints(endpoints);

    if (state === 'unknown' || !where) {

        const account = ConnStringUtils.GetAccountName(connString);

        return {
            id: 'emulator', label, icon: 'ok', description: account ? `account ${account}, not a local address` : 'no address in the connection string',
            tooltip: `The setting '${SettingsSection}.storageEmulatorConnectionString' does not say where an emulator listens. Click to configure it.`,
            command: configure
        };
    }

    const tooltip = `Looked for at ${where}, with the setting '${SettingsSection}.storageEmulatorConnectionString'. Click to change the ports.`;

    switch (state) {

        case 'listening':
            return { id: 'emulator', label, icon: 'ok', description: `${where}, listening`, tooltip, command: configure };

        case 'partly':
            return { id: 'emulator', label, icon: 'warning', description: `${where}, some of it is not listening`, tooltip, command: configure };

        default:
            return { id: 'emulator', label, icon: 'warning', description: `${where}, nothing is listening`, tooltip, command: configure };
    }
}
