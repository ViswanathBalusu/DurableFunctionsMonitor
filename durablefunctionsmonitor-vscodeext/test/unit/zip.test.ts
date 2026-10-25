// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { extractZip } from '../../src/coreTools/zip';
import { createZip } from './helpers/zipWriter';

// Either of the two layers refuses it: yauzl (with its own wording) or the check of extractZip
const Refused = /points out of the folder|invalid relative path|absolute path|invalid characters/;

let work: string;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-zip-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

// Writes an archive, and extracts it into a folder of its own, which is inside of the work folder
// (so that anything that escapes it can be found)
async function extract(entries: Parameters<typeof createZip>[0]): Promise<{ dest: string, count: number }> {

    const zipPath = path.join(work, 'a.zip');
    fs.writeFileSync(zipPath, createZip(entries));

    const dest = path.join(work, 'dest');
    const count = await extractZip(zipPath, dest);

    return { dest, count };
}

describe('extractZip', () => {

    test('extracts files and folders', async () => {

        const { dest, count } = await extract([
            { name: 'a.txt', content: 'hello' },
            { name: 'sub/', unixMode: 0o040755 },
            { name: 'sub/deeper/b.txt', content: 'world' },
            { name: 'func.exe', content: 'MZ' }
        ]);

        expect(count).toBe(3);
        expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('hello');
        expect(fs.readFileSync(path.join(dest, 'sub', 'deeper', 'b.txt'), 'utf8')).toBe('world');
        expect(fs.existsSync(path.join(dest, 'func.exe'))).toBe(true);
    });

    test('reports progress', async () => {

        const zipPath = path.join(work, 'a.zip');
        fs.writeFileSync(zipPath, createZip([{ name: 'a', content: '1' }, { name: 'b', content: '2' }, { name: 'c', content: '3' }]));

        const progress: [number, number][] = [];
        await extractZip(zipPath, path.join(work, 'dest'), (done, total) => progress.push([done, total]));

        expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    test.skipIf(process.platform === 'win32')('keeps the executable bit, which is what makes func runnable', async () => {

        const { dest } = await extract([
            { name: 'func', content: '#!/bin/sh', unixMode: 0o100755 },
            { name: 'data.txt', content: 'x', unixMode: 0o100644 }
        ]);

        expect(fs.statSync(path.join(dest, 'func')).mode & 0o111).not.toBe(0);
        expect(fs.statSync(path.join(dest, 'data.txt')).mode & 0o111).toBe(0);
    });

    test('refuses an entry that climbs out of the folder (zip slip), and writes nothing outside of it', async () => {

        await expect(extract([
            { name: 'ok.txt', content: 'fine' },
            { name: '../evil.txt', content: 'gotcha' }
        ])).rejects.toThrow(Refused);

        expect(fs.existsSync(path.join(work, 'evil.txt'))).toBe(false);
    });

    test('refuses an entry with an absolute path', async () => {

        const outside = path.join(work, 'outside.txt').replace(/\\/g, '/');

        await expect(extract([{ name: outside, content: 'gotcha' }])).rejects.toThrow(Refused);
        await expect(extract([{ name: '/etc/passwd-ish', content: 'gotcha' }])).rejects.toThrow(Refused);

        expect(fs.existsSync(path.join(work, 'outside.txt'))).toBe(false);
    });

    test('refuses an entry that climbs out with backslashes', async () => {

        await expect(extract([{ name: '..\\..\\evil.txt', content: 'gotcha' }])).rejects.toThrow(Refused);

        expect(fs.existsSync(path.join(work, 'evil.txt'))).toBe(false);
    });

    test('refuses a symlink that points out of the folder', async () => {

        await expect(extract([
            { name: 'link', content: '../../../etc', unixMode: 0o120777 }
        ])).rejects.toThrow(/symlink that points out/);
    });

    test('refuses a drive-relative name, which has no .. and no leading slash, and still leaves the folder on Windows', async () => {

        await expect(extract([{ name: 'C:evil.txt', content: 'gotcha' }])).rejects.toThrow(Refused);

        expect(fs.existsSync(path.join(work, 'dest', 'C:evil.txt'))).toBe(false);
    });

    test.skipIf(process.platform === 'win32')('creates a symlink that stays inside', async () => {

        const { dest } = await extract([
            { name: 'real.txt', content: 'target' },
            { name: 'link', content: 'real.txt', unixMode: 0o120777 }
        ]);

        expect(fs.lstatSync(path.join(dest, 'link')).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(path.join(dest, 'link'), 'utf8')).toBe('target');
    });

    test('fails on something that is not a zip', async () => {

        const zipPath = path.join(work, 'not.zip');
        fs.writeFileSync(zipPath, 'this is not an archive at all, and it is long enough to look for a directory in');

        await expect(extractZip(zipPath, path.join(work, 'dest'))).rejects.toThrow();
    });
});
