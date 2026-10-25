// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';
import { pipeline } from 'stream/promises';

// More than this is never legitimate for what we extract (the biggest Core Tools archive is about 1.5 GB unpacked)
const MaxUncompressedSize = 4 * 1024 * 1024 * 1024;

const UnixFileTypeMask = 0o170000;
const UnixSymlink = 0o120000;
const UnixDirectory = 0o040000;

// Tells whether a path is the folder itself or something below it
function isInside(root: string, target: string): boolean {
    return target === root || target.startsWith(root + path.sep);
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {

    return new Promise<yauzl.ZipFile>((resolve, reject) => {

        // Lazy entries: reading the next one only when we are done with the previous one
        yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipFile) => err ? reject(err) : resolve(zipFile));
    });
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {

    return new Promise<NodeJS.ReadableStream>((resolve, reject) => {

        zipFile.openReadStream(entry, (err, stream) => err ? reject(err) : resolve(stream));
    });
}

async function readEntryText(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {

    const stream = await openEntryStream(zipFile, entry);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

// Extracts a zip archive into a folder, and returns the number of files written.
// Does not trust the archive: an entry that would end up outside of the folder (a '..' segment, an absolute
// path, a symlink that points out) fails the whole extraction instead of being written.
// Preserves the permissions of the entries that carry them, which is what makes 'func' executable on Linux and macOS.
export async function extractZip(zipPath: string, destFolder: string, onProgress?: (entriesDone: number, entriesTotal: number) => void): Promise<number> {

    const root = path.resolve(destFolder);
    await fs.promises.mkdir(root, { recursive: true });

    const zipFile = await openZip(zipPath);
    const entriesTotal = zipFile.entryCount;

    let entriesDone = 0;
    let filesWritten = 0;
    let uncompressedTotal = 0;

    return await new Promise<number>((resolve, reject) => {

        const fail = (err: unknown) => {
            zipFile.close();
            reject(err);
        };

        zipFile.on('error', fail);
        zipFile.on('end', () => resolve(filesWritten));

        zipFile.on('entry', (entry: yauzl.Entry) => {

            (async () => {

                // Zip files made on Windows might use backslashes
                const name = entry.fileName.replace(/\\/g, '/');
                const target = path.resolve(root, name);

                if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || !isInside(root, target)) {
                    throw new Error(`The archive contains an entry that points out of the folder it is extracted to: '${entry.fileName}'`);
                }

                uncompressedTotal += entry.uncompressedSize;
                if (uncompressedTotal > MaxUncompressedSize) {
                    throw new Error(`The archive is bigger than ${MaxUncompressedSize} bytes when unpacked.`);
                }

                // Only archives made on Unix keep permissions (and symlinks) in the upper half of the external attributes
                const madeOnUnix = (entry.versionMadeBy >> 8) === 3;
                const unixMode = madeOnUnix ? (entry.externalFileAttributes >>> 16) : 0;
                const fileType = unixMode & UnixFileTypeMask;

                if (name.endsWith('/') || fileType === UnixDirectory) {

                    await fs.promises.mkdir(target, { recursive: true });

                } else if (fileType === UnixSymlink) {

                    // The content of a symlink entry is the path it points to
                    const linkTarget = await readEntryText(zipFile, entry);

                    if (!isInside(root, path.resolve(path.dirname(target), linkTarget))) {
                        throw new Error(`The archive contains a symlink that points out of the folder it is extracted to: '${entry.fileName}'`);
                    }

                    await fs.promises.mkdir(path.dirname(target), { recursive: true });
                    await fs.promises.symlink(linkTarget, target);

                } else {

                    await fs.promises.mkdir(path.dirname(target), { recursive: true });

                    const stream = await openEntryStream(zipFile, entry);

                    // Whatever the archive says, a file is readable and writable by us, and executable if it was so in the archive
                    const mode = (unixMode & 0o777) | 0o600;

                    await pipeline(stream, fs.createWriteStream(target, { mode }));
                    filesWritten++;
                }

                entriesDone++;
                onProgress?.(entriesDone, entriesTotal);

                zipFile.readEntry();

            })().catch(fail);
        });

        zipFile.readEntry();
    });
}
