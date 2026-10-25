// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';

import type { CoreToolsDownload } from './manifest';
import type { CoreToolsPlatform } from './platform';
import { downloadFile } from './download';
import { extractZip } from './zip';

// Marks an installation as complete. It is written last, so that an installation that was interrupted is not mistaken for a good one.
const CompleteMarkerName = '.dfm-complete';

export type InstallPhase = 'download' | 'extract';

export type InstallOptions = {

    // Folder all downloaded Core Tools live in (a subfolder of the extension's global storage)
    storageFolder: string;

    platform: CoreToolsPlatform;
    download: CoreToolsDownload;

    // Reports what is going on: bytes for the download, entries for the extraction
    onProgress?: (phase: InstallPhase, done: number, total: number | undefined) => void;

    signal?: AbortSignal;
    log?: (line: string) => void;
};

function getInstallFolder(storageFolder: string, platform: CoreToolsPlatform, version: string): string {
    return path.join(storageFolder, version, platform.rid);
}

// Returns the path to func of a complete installation, if there is one
export function getInstalledFuncPath(storageFolder: string, platform: CoreToolsPlatform, version: string): string | undefined {

    const folder = getInstallFolder(storageFolder, platform, version);

    if (!fs.existsSync(path.join(folder, CompleteMarkerName))) {
        return undefined;
    }

    const funcPath = path.join(folder, platform.executable);
    return fs.existsSync(funcPath) ? funcPath : undefined;
}

// Downloads, verifies and unpacks Azure Functions Core Tools, and returns the path to func.
// Nothing shows up under its final name before it is complete: the archive is verified by its checksum
// before anything is extracted, and the extraction happens in a folder of its own, which is renamed
// only when everything is in place. So a cancelled or failed installation leaves nothing that could be mistaken for one.
export async function installCoreTools(options: InstallOptions): Promise<string> {

    const { storageFolder, platform, download, onProgress, signal, log } = options;

    const existing = getInstalledFuncPath(storageFolder, platform, download.version);
    if (existing) {
        return existing;
    }

    const finalFolder = getInstallFolder(storageFolder, platform, download.version);
    const archivePath = path.join(storageFolder, '.downloads', download.file);
    const workFolder = `${finalFolder}.${process.pid}.tmp`;

    try {

        log?.(`Downloading ${download.url}`);
        await downloadFile({
            url: download.url,
            destination: archivePath,
            sha256: download.sha256,
            signal,
            onProgress: (received, total) => onProgress?.('download', received, total ?? download.size)
        });

        log?.(`Extracting ${archivePath} to ${finalFolder}`);
        await fs.promises.rm(workFolder, { recursive: true, force: true });
        await extractZip(archivePath, workFolder, (done, total) => onProgress?.('extract', done, total));

        const funcPath = path.join(workFolder, platform.executable);
        if (!fs.existsSync(funcPath)) {
            throw new Error(`The downloaded archive does not contain ${platform.executable}.`);
        }

        // Archives do not always keep permissions
        if (process.platform !== 'win32') {
            await fs.promises.chmod(funcPath, 0o755);
        }

        await fs.promises.writeFile(path.join(workFolder, CompleteMarkerName), download.sha256);

        // Something at the final place that is not a complete installation is a leftover, and would be in the way
        await fs.promises.mkdir(path.dirname(finalFolder), { recursive: true });
        if (fs.existsSync(finalFolder) && !getInstalledFuncPath(storageFolder, platform, download.version)) {
            await fs.promises.rm(finalFolder, { recursive: true, force: true });
        }

        // Another window might have been installing the same thing. Whoever comes first wins, and the other one uses that.
        try {
            await fs.promises.rename(workFolder, finalFolder);
        } catch (err) {

            const other = getInstalledFuncPath(storageFolder, platform, download.version);
            if (!other) {
                throw err;
            }

            log?.('Another VsCode window installed Azure Functions Core Tools in the meantime. Using that one.');
        }

    } finally {

        await fs.promises.rm(workFolder, { recursive: true, force: true });
        await fs.promises.rm(archivePath, { force: true });
    }

    const installed = getInstalledFuncPath(storageFolder, platform, download.version);
    if (!installed) {
        throw new Error('Azure Functions Core Tools were not installed.');
    }

    await removeOtherVersions(storageFolder, download.version, log);

    return installed;
}

// Removes the versions that were installed before, once the current one is in place
async function removeOtherVersions(storageFolder: string, currentVersion: string, log?: (line: string) => void): Promise<void> {

    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(storageFolder, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {

        // Only folders that are named like a version: this is not the place to delete anything else
        if (!entry.isDirectory() || entry.name === currentVersion || !/^\d+\.\d+\.\d+$/.test(entry.name)) {
            continue;
        }

        try {
            await fs.promises.rm(path.join(storageFolder, entry.name), { recursive: true, force: true });
            log?.(`Removed the previous Azure Functions Core Tools ${entry.name}.`);
        } catch (err: any) {
            // A copy in use (Windows locks the executable of a running process) goes the next time
            log?.(`Could not remove the previous Azure Functions Core Tools ${entry.name}: ${err.message ?? err}`);
        }
    }
}
