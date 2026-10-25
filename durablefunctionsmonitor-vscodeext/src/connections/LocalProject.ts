// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';

import { ConnStringUtils } from './ConnStringUtils';
import { StorageConnectionSettings } from './StorageConnectionSettings';

export type HostJsonInfo = {
    hubName?: string,
    storageProviderType: 'default' | 'mssql' | 'netherite',
    connectionStringName: string,
    schemaName?: string,
    otherConnectionStringName?: string
};

// Tells whether a folder is the root of an Azure Functions project
export function isFunctionsProject(folder: string): boolean {
    return fs.existsSync(path.join(folder, 'host.json'));
}

// Returns the folders of a list, that are Azure Functions projects
export function findFunctionsProjects(folders: string[]): string[] {
    return folders.filter(isFunctionsProject);
}

// Parses a JSON file. Editors on Windows like to put a BOM at the start of the file, and JSON.parse does not.
function readJsonFile(filePath: string): any {

    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text);
}

// An Azure Functions project on disk, which tells how it is connected to its Task Hub
export class LocalProject {

    constructor(
        readonly projectPath: string,
        private _getEmulatorConnString: () => string,
        private _log: (line: string) => void = () => { }) { }

    // Parses host.json
    readHostJson(): HostJsonInfo {

        const result: HostJsonInfo = {
            hubName: '',
            storageProviderType: 'default',
            connectionStringName: '',
            otherConnectionStringName: undefined,
            schemaName: undefined
        };

        const hostJsonPath = path.join(this.projectPath, 'host.json');
        if (!fs.existsSync(hostJsonPath)) {
            return result;
        }

        let hostJson;
        try {

            hostJson = readJsonFile(hostJsonPath);

        } catch (err) {

            this._log(`Failed to parse host.json: ${!(err as any).message ? err : (err as any).message}`);
            return result;
        }

        const durableTask = hostJson?.extensions?.durableTask;
        if (!durableTask) {
            return result;
        }

        const hubName = durableTask.HubName ?? durableTask.hubName;
        if (hubName) {
            // The name of a Task Hub is often taken from an app setting: "hubName": "%TaskHubName%"
            result.hubName = this.resolveAppSetting(hubName);
        }

        if (durableTask.storageProvider) {

            switch (durableTask.storageProvider.type?.toLowerCase()) {
                case 'mssql':
                    result.storageProviderType = 'mssql';
                    result.connectionStringName = durableTask.storageProvider.connectionStringName;
                    result.schemaName = durableTask.storageProvider.schemaName;
                    break;
                case 'netherite':
                    result.storageProviderType = 'netherite';
                    result.connectionStringName = durableTask.storageProvider.StorageConnectionName || 'AzureWebJobsStorage';
                    result.otherConnectionStringName = durableTask.storageProvider.EventHubsConnectionName || 'EventHubsConnection';
                    break;
                default:
                    result.connectionStringName = durableTask.storageProvider.connectionStringName;
            }
        }

        return result;
    }

    // Returns a value from the Values section of local.settings.json, or an empty string, if there is none
    getValueFromLocalSettings(valueName: string): string {

        try {

            const localSettingsPath = path.join(this.projectPath, 'local.settings.json');

            if (fs.existsSync(localSettingsPath)) {

                const localSettings = readJsonFile(localSettingsPath);

                if (!!localSettings.Values && !!localSettings.Values[valueName]) {
                    return localSettings.Values[valueName];
                }
            }

        } catch (err) {

            this._log(`Failed to parse local.settings.json: ${!(err as any).message ? err : (err as any).message}`);
        }

        return '';
    }

    // Tries to infer connection settings from the files of the project
    getStorageConnectionSettings(defaultTaskHubName?: string): StorageConnectionSettings | null {

        const hostJson = this.readHostJson();
        let hubName = hostJson.hubName;

        if (hostJson.storageProviderType === 'mssql') {

            const sqlConnectionString = this.getValueFromLocalSettings(hostJson.connectionStringName);
            if (!sqlConnectionString) {
                return null;
            }

            return new StorageConnectionSettings(sqlConnectionString, `${hostJson.schemaName || 'dt'}/${hubName || 'dbo'}`);
        }

        if (!hubName) {

            hubName = defaultTaskHubName;
            if (!hubName) {
                return null;
            }
        }

        if (hostJson.storageProviderType === 'netherite') {

            const storageConnString = this.getValueFromLocalSettings(hostJson.connectionStringName);
            if (!storageConnString) {
                return null;
            }

            if (!hostJson.otherConnectionStringName) {
                return null;
            }

            const hubsConnString = this.getValueFromLocalSettings(hostJson.otherConnectionStringName);
            if (!hubsConnString) {
                return null;
            }

            return new StorageConnectionSettings(this.expandEmulatorShortcut(storageConnString), hubName, hubsConnString);
        }

        const storageConnString = this.getValueFromLocalSettings(hostJson.connectionStringName || 'AzureWebJobsStorage');
        if (!storageConnString) {
            return null;
        }

        return new StorageConnectionSettings(this.expandEmulatorShortcut(storageConnString), hubName);
    }

    // Replaces 'UseDevelopmentStorage=true' with the full Storage Emulator connection string
    expandEmulatorShortcut(connString: string): string {
        return ConnStringUtils.ExpandEmulatorShortcutIfNeeded(connString, this._getEmulatorConnString());
    }

    // '%Name%' is the value of the app setting Name. Returns what is not like that as it is, and an empty string for a setting that is not there.
    private resolveAppSetting(value: string): string {

        const match = /^%([^%]+)%$/.exec(value);
        if (!match) {
            return value;
        }

        return this.getValueFromLocalSettings(match[1]);
    }
}
