// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Version } from '../backend/versions';
import type { FuncSearchResult, InstalledFunc } from './discovery';

// Which Azure Functions Core Tools the backend would be started with, as far as it can be told without starting anything or downloading anything.
// (CoreToolsService.getFuncPath is the one that decides, and does what it takes. This is what the Setup view says about it.)
export type CoreToolsStatus =
    // The executable the setting points to
    | { kind: 'custom', path: string }
    | { kind: 'custom-missing', path: string }
    // The copy this extension downloaded
    | { kind: 'downloaded', path: string, version: string }
    // One that was installed on the machine
    | { kind: 'system', path: string, version: Version }
    // Some are installed, and they are too old
    | { kind: 'too-old', found: InstalledFunc[], minimum: Version }
    // None, and the extension would download this one
    | { kind: 'missing', downloadVersion: string, downloadSize: number }
    // None, and there is nothing to download for this machine
    | { kind: 'unsupported', platform: string };

export type CoreToolsStatusDeps = {

    // The setting customPathToAzureFunctionsHost
    customPath: string;

    // Resolves the custom path: it used to be a command name, which is what a shell finds on PATH
    resolveCustomPath: (custom: string) => string | undefined;

    // The copy this extension downloaded earlier, if there is one, with its version. Undefined if there is nothing to download for this machine.
    managed: { path?: string, version: string, size: number } | undefined;

    // Asks the machine for an installed one
    search: () => Promise<FuncSearchResult>;

    minimumVersion: Version;
    platform: string;
};

// The same order as CoreToolsService.getFuncPath
export async function resolveCoreToolsStatus(deps: CoreToolsStatusDeps): Promise<CoreToolsStatus> {

    const custom = deps.customPath.trim();
    if (custom) {

        const resolved = deps.resolveCustomPath(custom);
        return resolved ? { kind: 'custom', path: resolved } : { kind: 'custom-missing', path: custom };
    }

    if (deps.managed?.path) {
        return { kind: 'downloaded', path: deps.managed.path, version: deps.managed.version };
    }

    const search = await deps.search();
    if (search.found) {
        return { kind: 'system', path: search.found.path, version: search.found.version };
    }

    if (search.tooOld.length) {
        return { kind: 'too-old', found: search.tooOld, minimum: deps.minimumVersion };
    }

    if (!deps.managed) {
        return { kind: 'unsupported', platform: deps.platform };
    }

    return { kind: 'missing', downloadVersion: deps.managed.version, downloadSize: deps.managed.size };
}
