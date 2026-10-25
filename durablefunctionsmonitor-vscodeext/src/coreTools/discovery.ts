// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { type Version, isVersionAtLeast, parseVersion } from '../backend/versions';

// Everything the search for an installed Azure Functions Core Tools needs from the machine, so that it can be tested without one
export type FuncDiscoveryDeps = {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    homeDir: string;
    isFile: (filePath: string) => boolean;
    realPath: (filePath: string) => string;
    getVersion: (funcPath: string) => Promise<Version | undefined>;
};

export function getDefaultDiscoveryDeps(): FuncDiscoveryDeps {

    return {
        platform: process.platform,
        env: process.env,
        homeDir: os.homedir(),
        isFile: filePath => {
            try { return fs.statSync(filePath).isFile(); } catch { return false; }
        },
        realPath: filePath => fs.realpathSync(filePath),
        getVersion: getFuncVersion
    };
}

// Runs 'func --version'. Returns undefined, if that does not work.
export function getFuncVersion(funcPath: string): Promise<Version | undefined> {

    return new Promise<Version | undefined>(resolve => {

        // No shell, so that a path with spaces or special characters is passed on as it is
        cp.execFile(funcPath, ['--version'], { timeout: 30000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
            resolve(err ? undefined : parseVersion(stdout));
        });
    });
}

// Places an installed Azure Functions Core Tools might be in, besides those on PATH.
// VsCode started from a dock or a start menu does not see the PATH of an interactive shell, so the
// places package managers install it to are listed explicitly.
function getWellKnownPaths(deps: FuncDiscoveryDeps): string[] {

    const result: string[] = [];
    const { env, homeDir } = deps;

    switch (deps.platform) {
        case 'win32':
            for (const programFiles of [env['ProgramFiles'], env['ProgramFiles(x86)'], env['ProgramW6432']]) {
                if (programFiles) {
                    result.push(path.join(programFiles, 'Microsoft', 'Azure Functions Core Tools', 'func.exe'));
                }
            }
            if (env['APPDATA']) {
                result.push(path.join(env['APPDATA'], 'npm', 'node_modules', 'azure-functions-core-tools', 'bin', 'func.exe'));
            }
            if (env['LOCALAPPDATA']) {
                result.push(path.join(env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links', 'func.exe'));
            }
            break;
        case 'darwin':
            result.push('/opt/homebrew/bin/func', '/usr/local/bin/func');
            result.push('/opt/homebrew/lib/node_modules/azure-functions-core-tools/bin/func', '/usr/local/lib/node_modules/azure-functions-core-tools/bin/func');
            break;
        default:
            result.push('/usr/bin/func', '/usr/local/bin/func', path.join(homeDir, '.local', 'bin', 'func'));
            result.push('/usr/lib/node_modules/azure-functions-core-tools/bin/func', '/usr/local/lib/node_modules/azure-functions-core-tools/bin/func');
            break;
    }

    return result;
}

// All the places to look for func in, in the order of preference: PATH first, because that is what the user would run in a terminal
export function getCandidatePaths(deps: FuncDiscoveryDeps): string[] {

    const result: string[] = [];

    const isWindows = deps.platform === 'win32';
    const names = isWindows ? ['func.exe', 'func.cmd', 'func.bat'] : ['func'];

    // On Windows the variable might be called Path
    const pathVariable = deps.env['PATH'] ?? deps.env['Path'] ?? '';

    for (const folder of pathVariable.split(isWindows ? ';' : ':')) {

        const trimmed = folder.trim().replace(/^"(.*)"$/, '$1');
        if (!trimmed) {
            continue;
        }

        for (const name of names) {
            result.push(path.join(trimmed, name));
        }
    }

    result.push(...getWellKnownPaths(deps));

    // No duplicates (compared like the file system would)
    const seen = new Set<string>();
    return result.filter(p => {
        const key = isWindows ? p.toLowerCase() : p;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// An 'npm install -g azure-functions-core-tools' leaves a launcher on PATH: func.cmd on Windows, a symlink to a Node
// script elsewhere. Running it starts a Node process, which starts the real func. Killing the launcher does not
// kill the real one, so the real one is what is wanted. It sits in the 'bin' folder of the package.
function resolveNpmLauncher(candidate: string, deps: FuncDiscoveryDeps): string | undefined {

    const nativeName = deps.platform === 'win32' ? 'func.exe' : 'func';

    if (/\.(cmd|bat)$/i.test(candidate)) {

        const native = path.join(path.dirname(candidate), 'node_modules', 'azure-functions-core-tools', 'bin', nativeName);
        return deps.isFile(native) ? native : undefined;
    }

    if (deps.platform !== 'win32') {

        let real = candidate;
        try { real = deps.realPath(candidate); } catch { /* it is not a link, or it is a broken one */ }

        const parts = real.split(path.sep);
        const packageIndex = parts.lastIndexOf('azure-functions-core-tools');

        if (packageIndex >= 0) {

            const native = path.join(parts.slice(0, packageIndex + 1).join(path.sep) || path.sep, 'bin', nativeName);
            if (native !== real && deps.isFile(native)) {
                return native;
            }
        }
    }

    return candidate;
}

// Finds what a shell would run for a plain command name ('func'): the first folder of PATH that has it
// (on Windows with one of the extensions it runs). Returns undefined for anything that is not a plain name.
export function resolveCommandOnPath(command: string, deps: Pick<FuncDiscoveryDeps, 'platform' | 'env' | 'isFile'> = getDefaultDiscoveryDeps()): string | undefined {

    if (!command || command.includes('/') || command.includes(path.sep) || command.includes(String.fromCharCode(92))) {
        return undefined;
    }

    const isWindows = deps.platform === 'win32';
    const extensions = isWindows ? ['', '.exe', '.cmd', '.bat'] : [''];
    const pathVariable = deps.env['PATH'] ?? deps.env['Path'] ?? '';

    for (const folder of pathVariable.split(isWindows ? ';' : ':')) {

        const trimmed = folder.trim().replace(/^"(.*)"$/, '$1');
        if (!trimmed) {
            continue;
        }

        for (const extension of extensions) {

            const candidate = path.join(trimmed, command + extension);
            if (deps.isFile(candidate)) {
                return candidate;
            }
        }
    }

    return undefined;
}

export type InstalledFunc = { path: string, version: Version };

export type FuncSearchResult = {

    // The first one that is new enough
    found?: InstalledFunc;

    // Those that were there, but are too old
    tooOld: InstalledFunc[];
};

// Looks for an Azure Functions Core Tools that is already installed on this machine, and is not older than the minimum
export async function findInstalledFunc(minimumVersion: Version, deps: FuncDiscoveryDeps = getDefaultDiscoveryDeps(), log?: (line: string) => void): Promise<FuncSearchResult> {

    const result: FuncSearchResult = { tooOld: [] };
    const tried = new Set<string>();

    for (const candidate of getCandidatePaths(deps)) {

        if (!deps.isFile(candidate)) {
            continue;
        }

        const funcPath = resolveNpmLauncher(candidate, deps);
        if (!funcPath || tried.has(funcPath)) {
            continue;
        }
        tried.add(funcPath);

        const version = await deps.getVersion(funcPath);
        if (!version) {

            log?.(`Skipping ${funcPath}: it does not report its version.`);
            continue;
        }

        if (isVersionAtLeast(version, minimumVersion)) {

            result.found = { path: funcPath, version };
            return result;
        }

        result.tooOld.push({ path: funcPath, version });
    }

    return result;
}
