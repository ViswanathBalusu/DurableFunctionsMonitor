// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { getInstalledFuncPath, installCoreTools } from '../../src/coreTools/installer';
import type { CoreToolsPlatform } from '../../src/coreTools/platform';
import type { CoreToolsDownload } from '../../src/coreTools/manifest';
import { TestServer } from './helpers/testServer';
import { createZip } from './helpers/zipWriter';

const platform: CoreToolsPlatform = process.platform === 'win32' ? { rid: 'win-x64', executable: 'func.exe' } : { rid: 'linux-x64', executable: 'func' };

let storage: string;
let server: TestServer;

beforeEach(async () => {

    storage = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-install-'));
    server = new TestServer();
    await server.start();
});

afterEach(async () => {

    await server.stop();
    fs.rmSync(storage, { recursive: true, force: true });
});

// An archive that looks like Azure Functions Core Tools, and the download that pins it
function publish(version: string, entries?: Parameters<typeof createZip>[0]): CoreToolsDownload {

    const archive = createZip(entries ?? [
        { name: platform.executable, content: 'func', unixMode: 0o100755 },
        { name: 'workers/dotnet/worker.dll', content: 'worker' }
    ]);

    const file = `func.${version}.zip`;
    server.serve(`/${file}`, archive);

    return { version, file, url: server.url(`/${file}`), size: archive.length, sha256: crypto.createHash('sha256').update(archive).digest('hex') };
}

describe('installCoreTools', () => {

    test('downloads, verifies and unpacks, and returns the path to func', async () => {

        const download = publish('4.16.0');

        const phases = new Set<string>();
        const funcPath = await installCoreTools({ storageFolder: storage, platform, download, onProgress: phase => phases.add(phase) });

        expect(funcPath).toBe(path.join(storage, '4.16.0', platform.rid, platform.executable));
        expect(fs.readFileSync(funcPath, 'utf8')).toBe('func');
        expect(fs.existsSync(path.join(storage, '4.16.0', platform.rid, 'workers', 'dotnet', 'worker.dll'))).toBe(true);
        expect([...phases]).toEqual(['download', 'extract']);

        // The archive is not kept
        expect(fs.readdirSync(path.join(storage, '.downloads'))).toEqual([]);
        expect(fs.readdirSync(path.join(storage, '4.16.0'))).toEqual([platform.rid]);
    });

    test('knows what it has installed, and downloads nothing the second time', async () => {

        const download = publish('4.16.0');

        expect(getInstalledFuncPath(storage, platform, '4.16.0')).toBeUndefined();

        const first = await installCoreTools({ storageFolder: storage, platform, download });
        expect(getInstalledFuncPath(storage, platform, '4.16.0')).toBe(first);

        const requestsBefore = server.requests.length;
        const second = await installCoreTools({ storageFolder: storage, platform, download });

        expect(second).toBe(first);
        expect(server.requests.length).toBe(requestsBefore);
    });

    test('installs nothing, when the archive is not the pinned one', async () => {

        const download = { ...publish('4.16.0'), sha256: 'a'.repeat(64) };

        await expect(installCoreTools({ storageFolder: storage, platform, download })).rejects.toThrow(/pinned checksum/);

        expect(getInstalledFuncPath(storage, platform, '4.16.0')).toBeUndefined();
        expect(fs.existsSync(path.join(storage, '4.16.0'))).toBe(false);
        expect(fs.readdirSync(path.join(storage, '.downloads'))).toEqual([]);
    });

    test('installs nothing, when the archive has no func in it', async () => {

        const download = publish('4.16.0', [{ name: 'readme.txt', content: 'no func here' }]);

        await expect(installCoreTools({ storageFolder: storage, platform, download })).rejects.toThrow(/does not contain/);

        expect(getInstalledFuncPath(storage, platform, '4.16.0')).toBeUndefined();
        expect(fs.existsSync(path.join(storage, '4.16.0', platform.rid))).toBe(false);
    });

    test('installs nothing, when the archive tries to write outside of its folder', async () => {

        const download = publish('4.16.0', [
            { name: platform.executable, content: 'func' },
            { name: '../../outside.txt', content: 'gotcha' }
        ]);

        await expect(installCoreTools({ storageFolder: storage, platform, download })).rejects.toThrow(/points out of the folder|invalid relative path/);

        expect(getInstalledFuncPath(storage, platform, '4.16.0')).toBeUndefined();
        expect(fs.existsSync(path.join(path.dirname(storage), 'outside.txt'))).toBe(false);
    });

    test('does not take an interrupted installation for a complete one', async () => {

        const download = publish('4.16.0');

        // What a crash leaves: the files are there, the marker is not
        const folder = path.join(storage, '4.16.0', platform.rid);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, platform.executable), 'half of func');

        expect(getInstalledFuncPath(storage, platform, '4.16.0')).toBeUndefined();

        const funcPath = await installCoreTools({ storageFolder: storage, platform, download });

        expect(fs.readFileSync(funcPath, 'utf8')).toBe('func');
    });

    test('removes the versions installed before', async () => {

        await installCoreTools({ storageFolder: storage, platform, download: publish('4.15.0') });
        expect(fs.existsSync(path.join(storage, '4.15.0'))).toBe(true);

        await installCoreTools({ storageFolder: storage, platform, download: publish('4.16.0') });

        expect(fs.existsSync(path.join(storage, '4.15.0'))).toBe(false);
        expect(fs.existsSync(path.join(storage, '4.16.0'))).toBe(true);
    });

    test('leaves alone what is not a version', async () => {

        fs.mkdirSync(path.join(storage, 'something-else'), { recursive: true });
        fs.writeFileSync(path.join(storage, 'something-else', 'file.txt'), 'mine');

        await installCoreTools({ storageFolder: storage, platform, download: publish('4.16.0') });

        expect(fs.readFileSync(path.join(storage, 'something-else', 'file.txt'), 'utf8')).toBe('mine');
    });

    test.skipIf(process.platform === 'win32')('makes func executable, even when the archive does not say so', async () => {

        const download = publish('4.16.0', [{ name: 'func', content: 'func', unixMode: 0o100644 }]);

        const funcPath = await installCoreTools({ storageFolder: storage, platform, download });

        expect(fs.statSync(funcPath).mode & 0o111).not.toBe(0);
    });

    test('two windows installing at the same time end up with one working installation', async () => {

        const download = publish('4.16.0');

        const [a, b] = await Promise.all([
            installCoreTools({ storageFolder: storage, platform, download }),
            installCoreTools({ storageFolder: storage, platform, download })
        ]);

        expect(a).toBe(b);
        expect(fs.readFileSync(a, 'utf8')).toBe('func');
        expect(fs.readdirSync(path.join(storage, '4.16.0'))).toEqual([platform.rid]);
    });

    test('many installations at the same time leave nothing behind but the one that works', async () => {

        // A file system that lets a file be removed while another reader has it open (every one but Windows) used to fail one of them
        const download = publish('4.16.0');

        const paths = await Promise.all(Array.from({ length: 5 }, () => installCoreTools({ storageFolder: storage, platform, download })));

        expect(new Set(paths).size).toBe(1);
        expect(fs.readFileSync(paths[0], 'utf8')).toBe('func');
        expect(fs.readdirSync(path.join(storage, '4.16.0'))).toEqual([platform.rid]);
        expect(fs.readdirSync(path.join(storage, '.downloads'))).toEqual([]);
    });

    test('removes what an installation that was killed left in the downloads folder, once it is a day old', async () => {

        const download = publish('4.16.0');

        const downloads = path.join(storage, '.downloads');
        fs.mkdirSync(downloads, { recursive: true });

        const killed = path.join(downloads, 'deadbeef.func.4.15.0.zip');
        const inProgress = path.join(downloads, 'cafebabe.func.4.16.0.zip');
        fs.writeFileSync(killed, 'half');
        fs.writeFileSync(inProgress, 'half');

        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        fs.utimesSync(killed, twoDaysAgo, twoDaysAgo);

        await installCoreTools({ storageFolder: storage, platform, download });

        // The one that is a few seconds old might be another window's download, which is not for us to remove
        expect(fs.readdirSync(downloads)).toEqual(['cafebabe.func.4.16.0.zip']);
    });
});
