// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'vitest';

// This is developed on Windows (and macOS), where './settings' finds Settings.ts, and built on Linux, where it does not.
// Nothing on the developer's machine says so: the build is green until CI. So the capitalisation of every relative
// import is compared with the capitalisation of the file it leads to.

const root = path.resolve(__dirname, '../..');
const folders = ['src', 'test', 'scripts'];

// The names of a folder, as the file system spells them
const namesCache = new Map<string, string[]>();
function namesIn(folder: string): string[] {

    let names = namesCache.get(folder);
    if (!names) {
        names = fs.existsSync(folder) ? fs.readdirSync(folder) : [];
        namesCache.set(folder, names);
    }
    return names;
}

// Tells whether a file exists, with exactly this capitalisation
function existsExactly(file: string): boolean {
    return namesIn(path.dirname(file)).includes(path.basename(file));
}

function listSources(folder: string): string[] {

    const result: string[] = [];

    for (const name of namesIn(folder)) {

        const full = path.join(folder, name);

        if (fs.statSync(full).isDirectory()) {
            result.push(...listSources(full));
        } else if (/\.(ts|mjs|cjs)$/.test(name)) {
            result.push(full);
        }
    }

    return result;
}

describe('imports', () => {

    test('lead to a file whose name is spelled exactly like the import spells it', () => {

        const problems: string[] = [];
        let checked = 0;

        for (const file of folders.flatMap(f => listSources(path.join(root, f)))) {

            const text = fs.readFileSync(file, 'utf8');

            for (const match of text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(['"](\.{1,2}\/[^'"]+)['"]\)|require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {

                const specifier = match[1] ?? match[2] ?? match[3];
                const target = path.resolve(path.dirname(file), specifier);
                checked++;

                const candidates = [target, ...['.ts', '.js', '.mjs', '.cjs', '.json'].map(e => target + e), path.join(target, 'index.ts')];

                if (!candidates.some(c => existsExactly(c))) {
                    problems.push(`${path.relative(root, file)} imports '${specifier}'`);
                }
            }
        }

        expect(checked).toBeGreaterThan(50);
        expect(problems, 'These would not be found on a file system that tells capital letters apart').toEqual([]);
    });
});
