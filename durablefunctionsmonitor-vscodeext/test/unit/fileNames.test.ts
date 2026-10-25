// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { toSaveFileName } from '../../src/views/fileNames';

const BS = String.fromCharCode(92);

describe('toSaveFileName', () => {

    test('keeps what the UI suggests, with the extension it already has: the UI names a chart "<instance>.svg"', () => {

        expect(toSaveFileName('order-2026-09-04-000913.svg', 'diagram', '.svg')).toBe('order-2026-09-04-000913.svg');
        expect(toSaveFileName('order-1-sequence.svg', 'diagram', '.svg')).toBe('order-1-sequence.svg');
    });

    test('does not double the extension, whatever its case', () => {

        expect(toSaveFileName('Chart.SVG', 'diagram', '.svg')).toBe('Chart.SVG');
    });

    test('adds the extension to a name that has none, which is what a download is named', () => {

        expect(toSaveFileName('order-1-history', 'download', '.json')).toBe('order-1-history.json');
    });

    test('replaces what a file name cannot have: an instance id of a sub-orchestration has a colon', () => {

        expect(toSaveFileName('order-2026-09-04-000913:0.svg', 'diagram', '.svg')).toBe('order-2026-09-04-000913_0.svg');
        expect(toSaveFileName('a<b>c"d|e?f*g.svg', 'diagram', '.svg')).toBe('a_b_c_d_e_f_g.svg');
    });

    test('takes the name and not the folder in front of it, in either spelling', () => {

        expect(toSaveFileName('../../etc/passwd', 'download', '.txt')).toBe('passwd.txt');
        expect(toSaveFileName('C:' + BS + 'Windows' + BS + 'system32' + BS + 'evil.svg', 'diagram', '.svg')).toBe('evil.svg');
        expect(toSaveFileName('folder/name', 'download', '.json')).toBe('name.json');
    });

    test('falls back when there is no name, or only dots', () => {

        expect(toSaveFileName(undefined, 'download', '.json')).toBe('download.json');
        expect(toSaveFileName('', 'download', '.json')).toBe('download.json');
        expect(toSaveFileName('   ', 'download', '.json')).toBe('download.json');
        expect(toSaveFileName('..', 'download', '.json')).toBe('download.json');
        expect(toSaveFileName('folder/', 'download', '.json')).toBe('download.json');
        expect(toSaveFileName(42, 'download', '.json')).toBe('download.json');
    });

    test('does not let control characters through', () => {

        expect(toSaveFileName('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(10) + 'c', 'download', '.json')).toBe('a_b_c.json');
    });
});
