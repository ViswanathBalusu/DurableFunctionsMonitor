// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

// Thrown, when what was downloaded is not what the manifest pins
export class ChecksumMismatchError extends Error {

    constructor(public readonly expected: string, public readonly actual: string) {
        super(`The downloaded file does not match its pinned checksum (expected SHA-256 ${expected}, got ${actual}).`);
        this.name = 'ChecksumMismatchError';
    }
}

export type DownloadOptions = {

    url: string;
    destination: string;

    // Lower-case hex SHA-256 of the file
    sha256: string;

    // Called with the number of bytes received so far, and the total, when the server tells it
    onProgress?: (received: number, total: number | undefined) => void;

    // Cancels the download
    signal?: AbortSignal;

    // The download is given up, if no data arrives for this long
    stallTimeoutInMs?: number;
};

// Downloads a file, and makes sure it is the file that was pinned. The file only appears under its
// destination name when its checksum matches: it is written under a temporary name first and then moved.
export async function downloadFile(options: DownloadOptions): Promise<void> {

    const { url, destination, sha256, onProgress, signal } = options;
    const stallTimeoutInMs = options.stallTimeoutInMs ?? 60000;

    await fs.promises.mkdir(path.dirname(destination), { recursive: true });

    // Two VsCode windows might download the same file at the same time, so no shared temporary name
    const partialPath = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.partial`;

    // Aborting on user's request and on stall, whichever comes first
    const abort = new AbortController();
    const onAbort = () => abort.abort(signal?.reason);
    if (signal?.aborted) {
        abort.abort(signal.reason);
    }
    signal?.addEventListener('abort', onAbort);

    let stallTimer: NodeJS.Timeout | undefined;
    const restartStallTimer = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => abort.abort(new Error(`No data received for ${stallTimeoutInMs / 1000} seconds.`)), stallTimeoutInMs);
    };

    try {

        restartStallTimer();

        // GitHub redirects release downloads to a CDN, which fetch follows
        const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });

        if (!response.ok || !response.body) {
            throw new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
        }

        const contentLength = parseInt(response.headers.get('content-length') ?? '');
        const total = Number.isFinite(contentLength) ? contentLength : undefined;

        const hash = crypto.createHash('sha256');
        let received = 0;

        const measure = new Transform({
            transform(chunk: Buffer, _encoding, callback) {

                restartStallTimer();

                hash.update(chunk);
                received += chunk.length;
                onProgress?.(received, total);

                callback(null, chunk);
            }
        });

        await pipeline(
            Readable.fromWeb(response.body as any),
            measure,
            fs.createWriteStream(partialPath),
            { signal: abort.signal }
        );

        const actual = hash.digest('hex');
        if (actual !== sha256.toLowerCase()) {
            throw new ChecksumMismatchError(sha256.toLowerCase(), actual);
        }

        await fs.promises.rename(partialPath, destination);

    } catch (err) {

        await fs.promises.rm(partialPath, { force: true });

        // Telling a cancellation and a stall from a network error
        if (abort.signal.aborted && abort.signal.reason instanceof Error) {
            throw abort.signal.reason;
        }
        throw err;

    } finally {

        clearTimeout(stallTimer);
        signal?.removeEventListener('abort', onAbort);
    }
}
