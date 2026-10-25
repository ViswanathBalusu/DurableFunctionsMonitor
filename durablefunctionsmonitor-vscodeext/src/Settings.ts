// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';

import { SettingsSection } from './constants';
import { SettingsDefaults } from './settingsDefaults';

export type ISettings = {
    backendBaseUrl: string;
    customPathToBackendBinaries: string;
    customPathToAzureFunctionsHost: string;
    coreToolsDownload: 'always' | 'prompt' | 'never';
    backendTimeoutInSeconds: number;
    storageEmulatorConnectionString: string;
    showTimeAs: 'UTC' | 'Local';
    showWhenDebugSessionStarts: boolean;
    taskHubsDiscoveryMode: 'Default' | 'Do not use Storage keys' | 'Do not use Azure account';
};

// Returns config values stored in VsCode's settings.json
export function Settings(): ISettings {

    const config = vscode.workspace.getConfiguration(SettingsSection);

    return {
        backendBaseUrl: config.get('backendBaseUrl', SettingsDefaults.backendBaseUrl),
        customPathToBackendBinaries: config.get('customPathToBackendBinaries', SettingsDefaults.customPathToBackendBinaries),
        customPathToAzureFunctionsHost: config.get('customPathToAzureFunctionsHost', SettingsDefaults.customPathToAzureFunctionsHost),
        coreToolsDownload: config.get('coreTools.download', SettingsDefaults['coreTools.download']),
        backendTimeoutInSeconds: config.get('backendTimeoutInSeconds', SettingsDefaults.backendTimeoutInSeconds),
        storageEmulatorConnectionString: config.get('storageEmulatorConnectionString', SettingsDefaults.storageEmulatorConnectionString),
        showTimeAs: config.get('showTimeAs', SettingsDefaults.showTimeAs),
        showWhenDebugSessionStarts: config.get('showWhenDebugSessionStarts', SettingsDefaults.showWhenDebugSessionStarts),
        taskHubsDiscoveryMode: config.get('taskHubsDiscoveryMode', SettingsDefaults.taskHubsDiscoveryMode),
    };
}

// Updates a config value stored in VsCode's settings.json
export function UpdateSetting(name: string, val: any): Thenable<void> {

    const config = vscode.workspace.getConfiguration(SettingsSection);
    return config.update(name, val, true);
}
