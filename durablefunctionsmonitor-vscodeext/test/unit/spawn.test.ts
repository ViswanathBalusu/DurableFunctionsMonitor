// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { explainSpawnError, quoteForCmd } from '../../src/backend/FuncHost';

describe('quoteForCmd', () => {

    test('leaves a plain part alone', () => {

        expect(quoteForCmd('start')).toBe('start');
        expect(quoteForCmd('--port')).toBe('--port');
        expect(quoteForCmd('37072')).toBe('37072');
        expect(quoteForCmd('C:\\Users\\me\\AppData\\Roaming\\npm\\func.cmd')).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\func.cmd');
    });

    test('quotes a part with spaces, as a path in Program Files has', () => {

        expect(quoteForCmd('C:\\Program Files\\Azure Functions Core Tools\\func.cmd')).toBe('"C:\\Program Files\\Azure Functions Core Tools\\func.cmd"');
    });

    test('quotes what the shell would take for something else', () => {

        expect(quoteForCmd('a&b')).toBe('"a&b"');
        expect(quoteForCmd('a|b')).toBe('"a|b"');
        expect(quoteForCmd('a>b')).toBe('"a>b"');
        expect(quoteForCmd('a(b)')).toBe('"a(b)"');
    });

    test('refuses what cannot be quoted safely: a quote, and a variable', () => {

        expect(() => quoteForCmd('a"b')).toThrow(/Cannot pass/);
        expect(() => quoteForCmd('%PATH%')).toThrow(/Cannot pass/);
    });
});

describe('explainSpawnError', () => {

    const enoent = Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' });

    test('says that a path of 260 characters is too long for Windows, which only ever says that nothing was found', () => {

        const longPath = 'C:/' + 'a'.repeat(260) + '/func.exe';

        const message = explainSpawnError(enoent, longPath, 'win32');

        expect(message).toContain('limit is 259');
        expect(message).toContain(String(longPath.length));
        expect(message).toContain('customPathToAzureFunctionsHost');
    });

    test('does not blame the length of a path that is not too long', () => {

        expect(explainSpawnError(enoent, 'C:/tools/func.exe', 'win32')).toContain('There is no program at');
    });

    test('knows no such limit elsewhere', () => {

        expect(explainSpawnError(enoent, '/' + 'a'.repeat(300) + '/func', 'linux')).toContain('There is no program at');
    });

    test('says that running it is not allowed', () => {

        for (const code of ['EACCES', 'EPERM']) {
            expect(explainSpawnError(Object.assign(new Error('x'), { code }), '/tools/func', 'linux')).toContain('not allowed to run');
        }
    });

    test('has nothing to add to what it does not know', () => {

        expect(explainSpawnError(Object.assign(new Error('something else'), { code: 'EMFILE' }), '/tools/func', 'linux')).toBe('something else');
    });
});
