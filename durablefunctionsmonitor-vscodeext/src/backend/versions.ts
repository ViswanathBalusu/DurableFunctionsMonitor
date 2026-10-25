// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export type Version = { major: number, minor: number, patch: number };

// Extracts the first major.minor.patch triple from a text, e.g. the output of 'func --version'
export function parseVersion(text: string | undefined): Version | undefined {

    const match = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
    if (!match) {
        return undefined;
    }

    return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) };
}

// Returns a negative number, if a is older than b, a positive one, if it is newer, and 0 when they are the same
export function compareVersions(a: Version, b: Version): number {

    if (a.major !== b.major) {
        return a.major - b.major;
    }

    if (a.minor !== b.minor) {
        return a.minor - b.minor;
    }

    return a.patch - b.patch;
}

export function isVersionAtLeast(actual: Version, minimum: Version): boolean {
    return compareVersions(actual, minimum) >= 0;
}

export function formatVersion(version: Version): string {
    return `${version.major}.${version.minor}.${version.patch}`;
}
