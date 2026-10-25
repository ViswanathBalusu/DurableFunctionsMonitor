// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as vscode from 'vscode';

import { listDotnetRuntimes, readFrameworkRequirement } from '../backend/dotnetRuntime';
import { CoreToolsService } from '../coreTools/CoreToolsService';
import { SettingsSection } from '../constants';
import { Settings, UpdateSetting } from '../Settings';
import type { Log } from '../logging';
import { type ConfigureEmulatorUi, type ConfigureOutcome, configureEmulator } from './configureEmulator';
import { parseEmulatorEndpoints } from './emulator';
import { probeEmulator } from './probe';
import { type SetupRow, describeCoreTools, describeDotnet, describeEmulator, getDotnetStatus } from './rows';

// The settings whose value the Setup rows depend on
export const SetupSettings = ['customPathToAzureFunctionsHost', 'customPathToBackendBinaries', 'coreTools.download', 'storageEmulatorConnectionString'];

// What the Setup group of the tree shows, and the commands that change what it shows
export class SetupService {

    constructor(private _context: vscode.ExtensionContext, private _coreTools: CoreToolsService, private _log: Log) { }

    // One row for each thing the backend needs from this machine. A check that fails is a row that says so, not an empty group.
    async getRows(): Promise<SetupRow[]> {

        const connString = Settings().storageEmulatorConnectionString;
        const endpoints = parseEmulatorEndpoints(connString);

        return await Promise.all([

            this.check('coreTools', 'Azure Functions Core Tools', async () => describeCoreTools(await this._coreTools.getStatus())),
            this.check('dotnet', '.NET runtime', async () => describeDotnet(await this.getDotnetStatus())),
            this.check('emulator', 'Storage emulator', async () => describeEmulator(connString, endpoints, await probeEmulator(endpoints)))
        ]);
    }

    // Opens the settings of this extension, or the one setting that is asked for
    async openSettings(setting?: string): Promise<void> {

        const query = setting ? `${SettingsSection}.${setting}` : `@ext:${this._context.extension.id}`;
        await vscode.commands.executeCommand('workbench.action.openSettings', query);
    }

    async openDotnetDownload(needed?: string): Promise<void> {

        await vscode.env.openExternal(vscode.Uri.parse(`https://dotnet.microsoft.com/download/dotnet/${needed ?? ''}`));
    }

    async configureStorageEmulator(): Promise<void> {

        const ui: ConfigureEmulatorUi = {

            pick: async (choices, placeHolder) => {

                const picked = await vscode.window.showQuickPick(
                    choices.map(c => ({ label: c.label, description: c.description, detail: c.detail, choice: c.choice })),
                    { placeHolder, ignoreFocusOut: true });

                return picked?.choice;
            },

            input: options => vscode.window.showInputBox({ ...options, ignoreFocusOut: true }),

            report: outcome => this.report(outcome)
        };

        await configureEmulator(Settings().storageEmulatorConnectionString, ui, connString => UpdateSetting('storageEmulatorConnectionString', connString));
    }

    private report(outcome: ConfigureOutcome): void {

        const where = `${outcome.ports.blob}, ${outcome.ports.queue} and ${outcome.ports.table}`;

        if (outcome.state === 'listening') {

            vscode.window.showInformationMessage(`The Storage emulator is looked for on ports ${where}, and it is listening there.`);
            return;
        }

        this._log(`Nothing (or not all of it) listens on ports ${where}. Azurite starts there with: ${outcome.azuriteCommand}`);

        vscode.window.showWarningMessage(
            `The Storage emulator is looked for on ports ${where}, and it is not listening there yet. Start it with: ${outcome.azuriteCommand}`,
            'Copy Command'
        ).then(answer => {

            if (answer === 'Copy Command') {
                vscode.env.clipboard.writeText(outcome.azuriteCommand);
            }
        });
    }

    private async getDotnetStatus() {

        const folder = Settings().customPathToBackendBinaries || this._context.asAbsolutePath('backend');
        const requirement = fs.existsSync(folder) ? readFrameworkRequirement(folder) : undefined;

        return getDotnetStatus(requirement, await listDotnetRuntimes());
    }

    private async check(id: SetupRow['id'], label: string, describe: () => Promise<SetupRow>): Promise<SetupRow> {

        try {
            return await describe();
        } catch (err: any) {

            this._log(`Could not check '${label}': ${err?.stack ?? err}`);
            return { id, label, icon: 'error', description: `could not be checked: ${err?.message ?? err}`, tooltip: 'See the log of this extension for the details.' };
        }
    }
}
