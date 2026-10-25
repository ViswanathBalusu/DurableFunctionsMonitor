// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';

import { type DotnetRuntime, type FrameworkRequirement, isRequirementMet } from './dotnetRuntime';
import { formatVersion } from './versions';

// What deciding about the .NET runtime needs from the outside
export type DotnetResolverDeps = {

    // The runtimes a dotnet has. Without a path: the one that is on PATH. Undefined, when there is no such dotnet.
    listRuntimes: (dotnetPath?: string) => Promise<DotnetRuntime[] | undefined>;

    // Gets a dotnet that has the runtime, installing it if needed (the .NET Install Tool does that). Returns the path to it,
    // or undefined, when that is not possible (the tool is not there, the user said no, the download failed).
    acquire?: (requirement: FrameworkRequirement) => Promise<string | undefined>;

    // The environment the backend is going to be started in
    env: NodeJS.ProcessEnv;

    log?: (line: string) => void;
};

export type DotnetResolution =
    // The runtime is there. 'env' has to be added to the environment of the backend (it is empty when the runtime was found on PATH).
    { status: 'ok', env: NodeJS.ProcessEnv }
    // It is not, and cannot be had
    | { status: 'missing', message: string };

// Makes sure that the machine has the .NET runtime a backend was built for
export async function resolveDotnetRuntime(requirement: FrameworkRequirement | undefined, deps: DotnetResolverDeps): Promise<DotnetResolution> {

    // Nothing is asked: a self-contained backend carries its runtime
    if (!requirement) {
        return { status: 'ok', env: {} };
    }

    const wanted = `${requirement.name} ${requirement.version.major}.${requirement.version.minor}.${requirement.version.patch}`;

    // The dotnet the user has
    const onPath = await deps.listRuntimes();
    if (!!onPath && isRequirementMet(onPath, requirement)) {
        return { status: 'ok', env: {} };
    }

    // The dotnet DOTNET_ROOT points to, which the host starts the worker with when it is set
    const root = deps.env['DOTNET_ROOT'];
    if (root) {

        const dotnetPath = path.join(root, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
        const inRoot = await deps.listRuntimes(dotnetPath);

        if (!!inRoot && isRequirementMet(inRoot, requirement)) {
            return { status: 'ok', env: {} };
        }
    }

    deps.log?.(`.NET runtime ${wanted} was not found${onPath ? ` (installed: ${onPath.filter(r => r.name === requirement.name).map(r => formatVersion(r.version)).join(', ') || 'none of it'})` : ' (there is no dotnet on PATH)'}.`);

    // One more way: let somebody install it
    const acquired = await deps.acquire?.(requirement);

    if (acquired) {

        const runtimes = await deps.listRuntimes(acquired);

        if (!!runtimes && isRequirementMet(runtimes, requirement)) {

            const folder = path.dirname(acquired);
            const pathVariable = deps.env['PATH'] !== undefined ? 'PATH' : (deps.env['Path'] !== undefined ? 'Path' : 'PATH');

            return {
                status: 'ok',
                env: {
                    DOTNET_ROOT: folder,
                    // First on PATH, so that this is the dotnet that is found
                    [pathVariable]: `${folder}${path.delimiter}${deps.env[pathVariable] ?? ''}`
                }
            };
        }

        deps.log?.(`The dotnet that was provided (${acquired}) does not have ${wanted} either.`);
    }

    return {
        status: 'missing',
        message: `The backend needs the .NET runtime ${requirement.version.major}.${requirement.version.minor}.${requirement.version.patch} (${requirement.name}), and it is not installed. ` +
            `Install the .NET ${requirement.version.major} runtime from https://dotnet.microsoft.com/download/dotnet/${requirement.version.major}.0 and start the monitor again.`
    };
}
