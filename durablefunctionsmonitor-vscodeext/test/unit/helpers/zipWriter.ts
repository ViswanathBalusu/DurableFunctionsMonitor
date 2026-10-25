// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as zlib from 'zlib';

export type ZipEntrySpec = {

    // Written as it is: unlike the zip libraries, this does not refuse '..', absolute paths and the like,
    // because tests need archives that a hostile server could serve
    name: string;

    content?: string;

    // Unix mode, with the file type in it: 0o100755 for an executable file, 0o120777 for a symlink, 0o040755 for a folder
    unixMode?: number;
};

// Writes a zip archive (stored, not compressed) with whatever entries it is asked to
export function createZip(entries: ZipEntrySpec[]): Buffer {

    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {

        const name = Buffer.from(entry.name, 'utf8');
        const data = Buffer.from(entry.content ?? '', 'utf8');
        const crc = zlib.crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        // Made by Unix (3), so that the mode is taken into account
        central.writeUInt16LE((3 << 8) | 20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);

        localParts.push(local, name, data);
        centralParts.push(central, name);

        offset += local.length + name.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...localParts, ...centralParts, end]);
}
