// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';

import type { Log } from '../logging';
import { listDotnetRuntimes, readFrameworkRequirement, type FrameworkRequirement } from './dotnetRuntime';
import { resolveDotnetRuntime, type DotnetResolution } from './dotnetResolver';

// The extension that installs .NET runtimes for other extensions, and the command it offers for that
const DotnetInstallToolId = 'ms-dotnettools.vscode-dotnet-runtime';
const AcquireCommand = 'dotnet.acquire';

// Makes sure the machine has the .NET runtime a backend was built for. A backend that is run by a runtime that
// is not there does not fail in a way that says so: func starts, and its worker never comes up.
export class DotnetRuntimeService {

    constructor(private _extensionId: string, private _log: Log) { }

    async ensureRuntime(backendFolder: string): Promise<DotnetResolution> {

        return await resolveDotnetRuntime(readFrameworkRequirement(backendFolder), {
            listRuntimes: dotnetPath => listDotnetRuntimes(dotnetPath),
            acquire: requirement => this.acquire(requirement),
            env: process.env,
            log: this._log
        });
    }

    // Asks the .NET Install Tool to install the runtime (it downloads it from Microsoft, and keeps it in its own storage, apart from the .NET of the machine)
    private async acquire(requirement: FrameworkRequirement): Promise<string | undefined> {

        const version = `${requirement.version.major}.${requirement.version.minor}`;

        let tool = vscode.extensions.getExtension(DotnetInstallToolId);

        if (!tool) {

            const answer = await vscode.window.showWarningMessage(
                `The backend needs the .NET ${version} runtime, which is not installed. The .NET Install Tool extension can install it for you.`,
                'Install .NET Install Tool', 'Download .NET Myself');

            if (answer === 'Download .NET Myself') {
                await vscode.env.openExternal(vscode.Uri.parse(`https://dotnet.microsoft.com/download/dotnet/${version}`));
            }

            if (answer !== 'Install .NET Install Tool') {
                return undefined;
            }

            try {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', DotnetInstallToolId);
            } catch (err: any) {
                this._log(`Failed to install ${DotnetInstallToolId}: ${err.message ?? err}`);
                return undefined;
            }

            tool = vscode.extensions.getExtension(DotnetInstallToolId);
            if (!tool) {
                return undefined;
            }
        }

        try {

            if (!tool.isActive) {
                await tool.activate();
            }

            this._log(`Asking ${DotnetInstallToolId} for the .NET ${version} runtime...`);

            const result = await vscode.commands.executeCommand<{ dotnetPath?: string } | undefined>(AcquireCommand, {
                version,
                requestingExtensionId: this._extensionId,
                mode: 'runtime'
            });

            return result?.dotnetPath;

        } catch (err: any) {

            this._log(`${DotnetInstallToolId} could not provide the .NET ${version} runtime: ${err.message ?? err}`);
            return undefined;
        }
    }
}
