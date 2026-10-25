// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { compareVersions, formatVersion, isVersionAtLeast, parseVersion } from '../../src/backend/versions';

describe('versions', () => {

    test('parses what func --version prints', () => {

        expect(parseVersion('4.16.0')).toEqual({ major: 4, minor: 16, patch: 0 });
        expect(parseVersion('4.0.4629\r\n')).toEqual({ major: 4, minor: 0, patch: 4629 });
        expect(parseVersion('Azure Functions Core Tools\nCore Tools Version: 4.13.0+dd0daba (64-bit)')).toEqual({ major: 4, minor: 13, patch: 0 });
    });

    test('returns undefined, when there is no version', () => {

        expect(parseVersion('')).toBeUndefined();
        expect(parseVersion(undefined)).toBeUndefined();
        expect(parseVersion('command not found')).toBeUndefined();
        expect(parseVersion('4.16')).toBeUndefined();
    });

    test('compares numbers, not strings', () => {

        expect(compareVersions(parseVersion('4.9.0')!, parseVersion('4.10.0')!)).toBeLessThan(0);
        expect(compareVersions(parseVersion('4.16.0')!, parseVersion('4.2.9')!)).toBeGreaterThan(0);
        expect(compareVersions(parseVersion('4.16.0')!, parseVersion('4.16.0')!)).toBe(0);
        expect(compareVersions(parseVersion('5.0.0')!, parseVersion('4.99.99')!)).toBeGreaterThan(0);
    });

    test('tells whether a version is at least the minimum', () => {

        const minimum = parseVersion('4.1.2')!;

        expect(isVersionAtLeast(parseVersion('4.1.2')!, minimum)).toBe(true);
        expect(isVersionAtLeast(parseVersion('4.16.0')!, minimum)).toBe(true);
        expect(isVersionAtLeast(parseVersion('4.1.1')!, minimum)).toBe(false);
        expect(isVersionAtLeast(parseVersion('3.0.9999')!, minimum)).toBe(false);
    });

    test('formats a version', () => {
        expect(formatVersion({ major: 4, minor: 16, patch: 0 })).toBe('4.16.0');
    });
});
