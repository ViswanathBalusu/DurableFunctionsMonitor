// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { Settings } from '../Settings';
import type { Log } from '../logging';
import { SettingsSection } from '../constants';
import { findInstalledFunc, resolveCommandOnPath } from './discovery';
import { getInstalledFuncPath, installCoreTools } from './installer';
import { CoreToolsManifest, getCoreToolsDownload, getMinimumCoreToolsVersion } from './manifest';
import { getCoreToolsPlatform } from './platform';
import { formatVersion } from '../backend/versions';

// Thrown when there is no Azure Functions Core Tools to run the backend with, and none is going to be had
export class CoreToolsUnavailableError extends Error { }

// Finds Azure Functions Core Tools for the backends to run on, and downloads them when there are none.
// In the order of preference:
//   1. the executable the user has pointed to (durableFunctionsMonitor.customPathToAzureFunctionsHost)
//   2. the copy this extension downloaded earlier
//   3. an Azure Functions Core Tools installed on this machine, that is new enough
//   4. a download of the release this extension pins (see manifest.json), if the user allows it
export class CoreToolsService {

    constructor(private _context: vscode.ExtensionContext, private _log: Log) { }

    // Returns the path to func, downloading Azure Functions Core Tools first, if that is what it takes
    async getFuncPath(): Promise<string> {

        const custom = Settings().customPathToAzureFunctionsHost.trim();
        if (custom) {

            // The setting used to take a plain command name ('func') as well, which is what a shell finds on PATH
            const resolved = fs.existsSync(custom) ? custom : resolveCommandOnPath(custom);

            if (!resolved) {
                throw new CoreToolsUnavailableError(`The setting '${SettingsSection}.customPathToAzureFunctionsHost' points to ${custom}, and there is nothing there.`);
            }

            this._log(`Using Azure Functions Core Tools from the settings: ${resolved}`);
            return resolved;
        }

        // Once found, for as long as it is there
        if (this._resolved && fs.existsSync(this._resolved)) {
            return this._resolved;
        }

        const platform = getCoreToolsPlatform();
        const download = platform ? getCoreToolsDownload(platform) : undefined;

        if (platform && download) {

            const managed = getInstalledFuncPath(this.storageFolder, platform, download.version);
            if (managed) {

                this._log(`Using Azure Functions Core Tools ${download.version} that were downloaded earlier: ${managed}`);
                return this._resolved = managed;
            }
        }

        const search = await findInstalledFunc(getMinimumCoreToolsVersion(), undefined, this._log);
        if (search.found) {

            this._log(`Using Azure Functions Core Tools ${formatVersion(search.found.version)} that are installed on this machine: ${search.found.path}`);
            return this._resolved = search.found.path;
        }

        const tooOld = search.tooOld.map(f => `${f.path} is ${formatVersion(f.version)}`).join('; ');
        const reason = tooOld
            ? `The Azure Functions Core Tools that are installed are too old (${tooOld}; ${CoreToolsManifest.minimumVersion} is needed to run a .NET 10 backend).`
            : 'Azure Functions Core Tools are not installed.';

        if (!platform || !download) {
            throw new CoreToolsUnavailableError(`${reason} There is nothing to download for ${process.platform}/${process.arch}. Install Azure Functions Core Tools v4 yourself, ` +
                `or point '${SettingsSection}.customPathToAzureFunctionsHost' to a func executable.`);
        }

        this._log(reason);

        if (!(await this.isDownloadAllowed(reason, download.size))) {

            throw new CoreToolsUnavailableError(`${reason} Install Azure Functions Core Tools v4 (https://learn.microsoft.com/azure/azure-functions/functions-run-local), ` +
                `set '${SettingsSection}.customPathToAzureFunctionsHost' to the func executable, or let the extension download them with the command 'Durable Functions Monitor: Download Azure Functions Core Tools'.`);
        }

        return this._resolved = await this.install();
    }

    // Downloads Azure Functions Core Tools, whether there are some already or not. That is what the command does.
    async installNow(): Promise<string> {

        const platform = getCoreToolsPlatform();
        if (!platform || !getCoreToolsDownload(platform)) {
            throw new CoreToolsUnavailableError(`There is nothing to download for ${process.platform}/${process.arch}.`);
        }

        return this._resolved = await this.install();
    }

    // Folder the downloads live in. It is in the global storage of the extension, so it survives updates of the extension.
    get storageFolder(): string {
        return path.join(this._context.globalStorageUri.fsPath, 'azure-functions-core-tools');
    }

    private _resolved?: string;

    // One download at a time, however many views ask for func
    private _installing?: Promise<string>;

    private async isDownloadAllowed(reason: string, size: number): Promise<boolean> {

        const policy = Settings().coreToolsDownload;
        const megabytes = Math.round(size / 1048576);

        switch (policy) {

            case 'always':
                return true;

            case 'prompt': {

                const answer = await vscode.window.showInformationMessage(
                    `${reason} Durable Functions Monitor needs them to run its backend. Download Azure Functions Core Tools ${CoreToolsManifest.version} (${megabytes} MB)?`,
                    'Download', 'Cancel');

                return answer === 'Download';
            }

            default: {

                const answer = await vscode.window.showWarningMessage(
                    `${reason} Downloading them is switched off in the settings.`,
                    'Download Now', 'Open Settings');

                if (answer === 'Open Settings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', `${SettingsSection}.coreTools.download`);
                }

                return answer === 'Download Now';
            }
        }
    }

    private install(): Promise<string> {

        this._installing ??= this.installWithProgress().finally(() => { this._installing = undefined; });
        return this._installing;
    }

    private async installWithProgress(): Promise<string> {

        const platform = getCoreToolsPlatform()!;
        const download = getCoreToolsDownload(platform)!;

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading Azure Functions Core Tools ${download.version}`,
            cancellable: true
        }, async (progress, token) => {

            const cancel = new AbortController();
            token.onCancellationRequested(() => cancel.abort(new CoreToolsUnavailableError('The download of Azure Functions Core Tools was cancelled.')));

            let reported = 0;

            try {

                const funcPath = await installCoreTools({
                    storageFolder: this.storageFolder,
                    platform,
                    download,
                    signal: cancel.signal,
                    log: this._log,
                    onProgress: (phase, done, total) => {

                        if (phase === 'extract') {
                            progress.report({ message: 'Unpacking...', increment: reported < 100 ? 100 - reported : 0 });
                            reported = 100;
                            return;
                        }

                        const percent = total ? Math.min(99, Math.floor(done * 100 / total)) : 0;

                        // Chunks come much more often than percents
                        if (total && percent <= reported) {
                            return;
                        }

                        progress.report({
                            message: total ? `${Math.round(done / 1048576)} of ${Math.round(total / 1048576)} MB` : `${Math.round(done / 1048576)} MB`,
                            increment: percent - reported
                        });
                        reported = Math.max(reported, percent);
                    }
                });

                this._log(`Azure Functions Core Tools ${download.version} are installed in ${funcPath}`);
                return funcPath;

            } catch (err: any) {

                this._log(`Failed to download Azure Functions Core Tools. ${err.message ?? err}`);

                if (err instanceof CoreToolsUnavailableError) {
                    throw err;
                }

                throw new CoreToolsUnavailableError(`Failed to download Azure Functions Core Tools ${download.version} from ${download.url}. ${err.message ?? err} ` +
                    `You can install Azure Functions Core Tools yourself, or set '${SettingsSection}.customPathToAzureFunctionsHost' to a func executable.`);
            }
        });
    }
}
