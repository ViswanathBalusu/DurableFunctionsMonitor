// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// What a file system of some platform refuses in a name (all of them together, so that a file saved on one can be opened on another).
// The backslash is spelled with its character code, the way it is not mistaken for the start of an escape.
const ForbiddenInFileName = '<>:"/|?*' + String.fromCharCode(92);

// Makes a name for a file that is about to be saved, out of what the UI suggests. The UI names a chart after its instance
// ('order-1:0.svg'), and an instance id can have characters in it that no file name can have. Only the name is taken, not
// a folder in front of it, and the extension is there once, whether the suggestion has it or not.
export function toSaveFileName(suggested: unknown, fallback: string, extension: string): string {

    let name = '';

    if (typeof suggested === 'string' && suggested.trim()) {

        // Either kind of separator, and only what is after the last one
        const parts = suggested.trim().split('/').join(String.fromCharCode(92)).split(String.fromCharCode(92));
        name = parts[parts.length - 1];
    }

    let safe = '';
    for (const ch of name) {
        safe += (ForbiddenInFileName.includes(ch) || ch.charCodeAt(0) < 32) ? '_' : ch;
    }

    // '.' and '..' are not names
    if (!safe.replace(/\./g, '').trim()) {
        safe = fallback;
    }

    return safe.toLowerCase().endsWith(extension.toLowerCase()) ? safe : safe + extension;
}
