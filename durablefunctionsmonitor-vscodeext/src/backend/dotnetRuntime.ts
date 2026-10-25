// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { type Version, isVersionAtLeast, parseVersion } from './versions';

export type DotnetRuntime = { name: string, version: Version };

// What a backend asks of the machine, as its *.runtimeconfig.json says
export type FrameworkRequirement = {
    name: string;
    version: Version;
    rollForward?: string;
};

// Parses the output of 'dotnet --list-runtimes':
//   Microsoft.NETCore.App 10.0.13 [C:\Program Files\dotnet\shared\Microsoft.NETCore.App]
export function parseDotnetRuntimes(output: string): DotnetRuntime[] {

    const result: DotnetRuntime[] = [];

    for (const line of output.split(/\r?\n/)) {

        const match = /^\s*(\S+)\s+(\d+\.\d+\.\d+\S*)\s+\[/.exec(line);
        const version = parseVersion(match?.[2]);

        if (match && version) {
            result.push({ name: match[1], version });
        }
    }

    return result;
}

// Lists the runtimes installed for a 'dotnet'. Returns undefined, if there is no dotnet to ask.
export function listDotnetRuntimes(dotnetPath: string = 'dotnet'): Promise<DotnetRuntime[] | undefined> {

    return new Promise<DotnetRuntime[] | undefined>(resolve => {

        cp.execFile(dotnetPath, ['--list-runtimes'], { timeout: 30000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
            resolve(err ? undefined : parseDotnetRuntimes(stdout));
        });
    });
}

// Reads which framework a backend folder needs. A backend that was published for .NET 10 needs the .NET 10 runtime,
// and without it func still starts, and then fails to start the worker, with nothing that points to the cause.
export function readFrameworkRequirement(backendFolder: string): FrameworkRequirement | undefined {

    let runtimeConfigPath: string | undefined;

    // The worker config says which assembly is the app, and the runtimeconfig.json of that assembly is the one that counts
    try {

        const workerConfig = JSON.parse(fs.readFileSync(path.join(backendFolder, 'worker.config.json'), 'utf8'));
        const workerPath: string | undefined = workerConfig?.description?.defaultWorkerPath;

        if (workerPath) {
            const candidate = path.join(backendFolder, workerPath.replace(/\.(dll|exe)$/i, '') + '.runtimeconfig.json');
            if (fs.existsSync(candidate)) {
                runtimeConfigPath = candidate;
            }
        }

    } catch {
        // No worker config, or not one we understand. Looking for any runtimeconfig then.
    }

    if (!runtimeConfigPath) {

        try {

            const found = fs.readdirSync(backendFolder).find(f => f.toLowerCase().endsWith('.runtimeconfig.json'));
            if (found) {
                runtimeConfigPath = path.join(backendFolder, found);
            }

        } catch {
            return undefined;
        }
    }

    if (!runtimeConfigPath) {
        return undefined;
    }

    try {

        const runtimeOptions = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'))?.runtimeOptions;

        // A self-contained app carries its runtime and asks for none
        const framework = runtimeOptions?.framework ?? runtimeOptions?.frameworks?.[0];
        const version = parseVersion(framework?.version);

        if (!framework?.name || !version) {
            return undefined;
        }

        return { name: framework.name, version, rollForward: runtimeOptions.rollForward };

    } catch {
        return undefined;
    }
}

// Tells whether the installed runtimes serve a requirement, the way the .NET host decides it: by default
// a newer minor or patch of the same major version does, and a newer major version does not (unless the app
// allows rolling forward to it).
export function isRequirementMet(runtimes: DotnetRuntime[], requirement: FrameworkRequirement): boolean {

    const rollsToNewerMajor = /^(Major|LatestMajor)$/i.test(requirement.rollForward ?? '');

    return runtimes.some(r =>
        r.name === requirement.name
        && isVersionAtLeast(r.version, requirement.version)
        && (r.version.major === requirement.version.major || rollsToNewerMajor)
    );
}
