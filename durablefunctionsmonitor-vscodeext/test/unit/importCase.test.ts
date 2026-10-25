// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import { spawnSync } from 'child_process';
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

// A pattern in a .gitignore that is meant for a build output folder ('backend' next to the extension) matches a source
// folder of the same name as well ('src/backend'). Nothing on the developer's machine says so either: the files are
// there, the build is green, and the commit leaves them out until a checkout in CI cannot find them.

function listAll(folder: string): string[] {

    return namesIn(folder).flatMap(name => {

        const full = path.join(folder, name);

        return fs.statSync(full).isDirectory() ? listAll(full) : [full];
    });
}

describe('sources', () => {

    test('are not ignored by git', ctx => {

        const files = folders.flatMap(f => listAll(path.join(root, f)));

        const asked = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
            cwd: root,
            input: files.map(f => path.relative(root, f).split(path.sep).join('/')).join('\0'),
            encoding: 'utf8',
        });

        // 128: not inside a git work tree (a source archive), or no git at all
        if (asked.error || asked.status === 128) {
            ctx.skip();
            return;
        }

        // 1: none of them is ignored; 0: the ones that are are listed. (--no-index: a file that is committed already is never
        // reported otherwise, which would hide the problem from whoever stages the files before running this.)
        const ignored = asked.status === 0 ? asked.stdout.split('\0').filter(Boolean) : [];

        expect(files.length).toBeGreaterThan(50);
        expect(ignored, 'These would be left out of the commit, and missing from a checkout').toEqual([]);
    });
});
