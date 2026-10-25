// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as SharedConstants from '../constants';

import { Settings } from '../Settings';
import { SettingsDefaults } from '../settingsDefaults';
import type { Log } from '../logging';
import { StorageConnectionSettings } from '../connections/StorageConnectionSettings';
import { CoreToolsService } from '../coreTools/CoreToolsService';
import { DotnetRuntimeService } from './DotnetRuntimeService';
import { BackendStartError, FuncHost } from './FuncHost';
import { buildBackendEnvironment, getHubNameWithoutSchema, getSchemaName } from './backendEnvironment';
import { type BackendEndpoint, getBackendUrl, parseBackendBaseUrl } from './backendUrl';
import { findFreePort } from './ports';

// How many times a backend is started again on another port, when the port that was picked turns out not to be available
const MaxPortAttempts = 3;

// Responsible for running the backend process
export class BackendProcess {

    constructor(private _extensionRootFolder: string,
        private _storageConnectionSettings: StorageConnectionSettings,
        private _removeMyselfFromList: () => void,
        private _saveTaskHubs: (storageConnString: string, schemaName: string | undefined, taskHubs: string[]) => Promise<void>,
        private _coreTools: CoreToolsService,
        private _dotnet: DotnetRuntimeService,
        private _log: Log)
    { }

    // Underlying StorageConnectionSettings
    get storageConnectionSettings(): StorageConnectionSettings {
        return this._storageConnectionSettings;
    }

    // Underlying Storage Connection String
    get storageConnectionString(): string {
        return this._storageConnectionSettings.storageConnString;
    }

    // Where the backend serves its API (if it was successfully started)
    get backendUrl(): string {
        return this._backendUrl;
    }

    // Folder where backend is run from (might be different, if the backend needs to be published first)
    get binariesFolder(): string {
        return this._eventualBinariesFolder;
    }

    get backendCommunicationNonce(): string { return this._backendCommunicationNonce; }

    // Stops the backend process, along with everything it started
    async cleanup(): Promise<void> {

        this._backendPromise = null;
        this._backendUrl = '';

        const host = this._host;
        this._host = undefined;

        if (!host) {
            return;
        }

        this._log('Stopping the backend...');
        await host.stop();
    }

    // Ensures that the backend is running (starts it, if needed) and returns its properties
    getBackend(): Promise<void> {

        if (!this._backendPromise) {

            this._backendPromise = this.getBackendAsync();
        }
        return this._backendPromise;
    }

    // Promise that resolves when the backend is started successfully
    private _backendPromise: Promise<void> | null = null;

    // Where the backend serves its API (if it was successfully started)
    private _backendUrl: string = '';

    // Folder where backend is run from (might be different, if the backend needs to be published first)
    private _eventualBinariesFolder: string = '';

    // A nonce for communicating with the backend
    private _backendCommunicationNonce = crypto.randomBytes(64).toString('base64');

    // The running func
    private _host?: FuncHost;

    private get hubName(): string {
        return getHubNameWithoutSchema(this._storageConnectionSettings.hubName);
    }

    private get schemaName(): string {
        return getSchemaName(this._storageConnectionSettings.hubName);
    }

    private async getBackendAsync(): Promise<void> {

        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: 'Starting the backend',
            cancellable: true
        };

        await vscode.window.withProgress(progressOptions, async (progress, token) => {

            const cancel = new AbortController();
            token.onCancellationRequested(() => cancel.abort());

            try {

                const funcPath = await this._coreTools.getFuncPath();
                this._log(`Using Functions host: ${funcPath}`);

                const endpoint = this.getEndpoint();

                const binariesFolder = this.getBinariesFolder();
                if (!fs.existsSync(binariesFolder)) {
                    throw new Error(`Couldn't find backend binaries in ${binariesFolder}`);
                }

                this._eventualBinariesFolder = await this.publishIfSourceProject(binariesFolder, cancel.signal);

                const runtime = await this._dotnet.ensureRuntime(this._eventualBinariesFolder);
                if (runtime.status === 'missing') {
                    throw new Error(runtime.message);
                }

                await this.startHost(funcPath, endpoint, runtime.env, message => progress.report({ message }), cancel.signal);

                // Also fetching Task Hub names from backend, but by now only for MSSQL
                if (this._storageConnectionSettings.isMsSql) {

                    await this.loadTaskHubs();
                }

            } catch (err) {

                // This call is important, without it a typo in connString would persist until vsCode restart
                this._removeMyselfFromList();

                throw err;
            }
        });
    }

    // Where to start the backend, as the settings say
    private getEndpoint(): BackendEndpoint {

        const setting = Settings().backendBaseUrl;

        const endpoint = parseBackendBaseUrl(setting);
        if (!endpoint) {

            this._log(`The setting 'backendBaseUrl' is '${setting}', which is not a URL like 'http://localhost:{portNr}'. Using the default.`);
            return parseBackendBaseUrl(SettingsDefaults.backendBaseUrl)!;
        }

        return endpoint;
    }

    // Starts func and waits until the backend answers. When the port that was picked is taken in the meantime
    // (two windows starting at the same moment, a port that the system reserves), tries again on another one.
    private async startHost(funcPath: string, endpoint: BackendEndpoint, extraEnv: NodeJS.ProcessEnv, report: (message: string) => void, signal: AbortSignal): Promise<void> {

        const attempts = endpoint.port !== undefined ? 1 : MaxPortAttempts;
        const timeoutInMs = Settings().backendTimeoutInSeconds * 1000;

        for (let attempt = 1; ; attempt++) {

            const port = endpoint.port ?? await findFreePort(endpoint.portRange!.from, endpoint.portRange!.to);
            const backendUrl = getBackendUrl(endpoint, port);

            report(backendUrl);
            this._log(`Attempting to start the backend from ${this._eventualBinariesFolder} on ${backendUrl}...`);

            const env = buildBackendEnvironment({ ...process.env, ...extraEnv }, this._storageConnectionSettings, this._backendCommunicationNonce);

            const host = new FuncHost({ funcPath, workingFolder: this._eventualBinariesFolder, port, env, log: this._log });
            this._host = host;
            host.start();

            try {

                await host.waitUntilReady({
                    url: `${backendUrl}/--${this.hubName}/about`,
                    headers: { [SharedConstants.NonceHeaderName]: this._backendCommunicationNonce }
                }, timeoutInMs, signal);

                this._backendUrl = backendUrl;
                this._log(`The backend is now running on ${backendUrl}`);
                return;

            } catch (err) {

                await host.stop();
                this._host = undefined;

                if (err instanceof BackendStartError && err.kind === 'port' && attempt < attempts) {

                    this._log(`Port ${port} turned out not to be available. Trying another one.`);
                    continue;
                }

                // Telling the user what to do is better than telling him that nothing answered
                if (!(err instanceof BackendStartError) && /^No response within/.test((err as Error).message)) {

                    throw new Error(`${(err as Error).message}\nEnsure that the backend is not blocked by a firewall, and that the machine can start Azure Functions Core Tools. See the log ('Durable Functions Monitor: Show Log') for what the backend wrote.`, { cause: err });
                }

                throw err;
            }
        }
    }

    // Calculates the backend binaries folder to use, based on Settings
    private getBinariesFolder(): string {

        const customBinariesFolder = Settings().customPathToBackendBinaries;

        if (customBinariesFolder) {

            return customBinariesFolder;
        }

        if (this._storageConnectionSettings.isMsSql) {

            return path.join(this._extensionRootFolder, 'custom-backends', 'dotnetIsolated-mssql');

        } else if (this._storageConnectionSettings.isNetherite) {

            return path.join(this._extensionRootFolder, 'custom-backends', 'dotnetIsolated-netherite');
        }

        return path.join(this._extensionRootFolder, 'backend');
    }

    // A custom backend might be given as a source code project, which needs to be published first
    private async publishIfSourceProject(binariesFolder: string, signal: AbortSignal): Promise<string> {

        if (!fs.readdirSync(binariesFolder).some(fn => fn.toLowerCase().endsWith('.csproj'))) {
            return binariesFolder;
        }

        const publishFolder = path.join(binariesFolder, 'publish');

        // if it wasn't published yet
        if (!fs.existsSync(publishFolder)) {

            this._log(`Publishing ${binariesFolder}...`);
            await this.runDotnetPublish(binariesFolder, publishFolder, signal);
        }

        return publishFolder;
    }

    private runDotnetPublish(projectFolder: string, publishFolder: string, signal: AbortSignal): Promise<void> {

        return new Promise<void>((resolve, reject) => {

            const publish = cp.spawn('dotnet', ['publish', '-o', publishFolder], { cwd: projectFolder, windowsHide: true });

            let output = '';
            const collect = (data: Buffer) => {
                const text = data.toString();
                output = (output + text).slice(-4000);
                this._log(text.trimEnd());
            };

            publish.stdout.on('data', collect);
            publish.stderr.on('data', collect);

            const onAbort = () => publish.kill();
            signal.addEventListener('abort', onAbort);

            publish.once('error', err => {
                signal.removeEventListener('abort', onAbort);
                reject(new Error(`dotnet publish failed. ${err.message}`));
            });

            publish.once('exit', code => {

                signal.removeEventListener('abort', onAbort);

                if (signal.aborted) {
                    reject(new Error('Cancelled by the user'));
                } else if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`dotnet publish failed (exit code ${code}). ${output}`));
                }
            });
        });
    }

    private async loadTaskHubs(): Promise<void> {

        try {

            const response = await fetch(`${this.backendUrl}/task-hub-names`, { headers: { [SharedConstants.NonceHeaderName]: this.backendCommunicationNonce } });

            if (!response.ok) {
                throw new Error(`Request failed with status code ${response.status}`);
            }

            await this._saveTaskHubs(this._storageConnectionSettings.storageConnString, this.schemaName, await response.json() as string[]);

        } catch (err: any) {

            this._log(`Failed to get Task Hub names from backend. ${err.message ?? err}`);
        }
    }
}
