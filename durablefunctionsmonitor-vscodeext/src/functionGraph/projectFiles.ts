// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';

// Folders that hold build output, dependencies or tooling, never the source code of a Functions project
const excludedFolders = new Set(['node_modules', 'target', 'bin', 'obj', '.vs', '.vscode', '.env', '.python_packages', '.git', '.github']);

export type FileMatch = {
    filePath: string;
    code: string;
    // Where the pattern matched, and how long the match is. Zero when no pattern was asked for.
    pos: number;
    length: number;
};

type FolderEntry = { name: string, isDirectory: boolean };

// The files of one project, as one parse of it sees them.
//
// Building a function map asks the same questions of the same files over and over (which file declares this
// function? and this one? which class is that return type?), so every folder is listed once and every file is
// read once, and both are remembered for as long as this object lives. One object per parse: it is a snapshot,
// and is not told when a file changes.
export class ProjectFiles {

    // Lists a folder: its entries in a fixed order (by name, ignoring case), so that the function map of a
    // project comes out the same on every file system. Symbolic links are not followed.
    async list(folder: string): Promise<FolderEntry[]> {

        let entries = this._folders.get(folder);

        if (!entries) {

            entries = fs.promises.readdir(folder, { withFileTypes: true }).then(dirents => dirents
                .map(dirent => ({ name: dirent.name, isDirectory: dirent.isDirectory() }))
                .sort(compareByName)
            );

            this._folders.set(folder, entries);
        }

        return entries;
    }

    read(filePath: string): Promise<string> {

        let code = this._files.get(filePath);

        if (!code) {

            code = fs.promises.readFile(filePath, { encoding: 'utf8' });
            this._files.set(filePath, code);
        }

        return code;
    }

    async exists(filePath: string): Promise<boolean> {

        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    // Finds the first file whose name matches, and (when a pattern is given) whose contents match as well.
    // The files of a folder are tried before any of its subfolders.
    //
    // 'mustContain' is a piece of text every match of the pattern is known to contain (the name being looked for).
    // A file without it is skipped without running the pattern, which is what keeps looking one name up in every
    // file of a large project cheap.
    async findFile(folder: string, fileName: RegExp, pattern?: RegExp, mustContain?: string): Promise<FileMatch | undefined> {

        const subFolders: string[] = [];

        for (const entry of await this.list(folder)) {

            const fullPath = path.join(folder, entry.name);

            if (entry.isDirectory) {

                if (!isExcludedFolder(entry.name)) {
                    subFolders.push(fullPath);
                }

            } else if (fileName.test(entry.name)) {

                const code = await this.read(fullPath);

                if (!pattern) {
                    return { filePath: fullPath, code, pos: 0, length: 0 };
                }

                if (mustContain && !code.includes(mustContain)) {
                    continue;
                }

                const match = firstMatch(pattern, code);
                if (match) {
                    return { filePath: fullPath, code, pos: match.index, length: match[0].length };
                }
            }
        }

        for (const subFolder of subFolders) {

            const result = await this.findFile(subFolder, fileName, pattern, mustContain);
            if (result) {
                return result;
            }
        }

        return undefined;
    }

    // Tells whether a file with a matching name exists anywhere below a folder, without reading anything
    async hasFile(folder: string, fileName: RegExp): Promise<boolean> {

        return !!(await this.findFilePath(folder, fileName));
    }

    // The path of the first file whose name matches. Files of a folder are tried before its subfolders.
    async findFilePath(folder: string, fileName: RegExp): Promise<string | undefined> {

        const subFolders: string[] = [];

        for (const entry of await this.list(folder)) {

            if (entry.isDirectory) {

                if (!isExcludedFolder(entry.name)) {
                    subFolders.push(path.join(folder, entry.name));
                }

            } else if (fileName.test(entry.name)) {

                return path.join(folder, entry.name);
            }
        }

        for (const subFolder of subFolders) {

            const result = await this.findFilePath(subFolder, fileName);
            if (result) {
                return result;
            }
        }

        return undefined;
    }

    // Lists every file below a folder whose name matches, walking the tree in the order of 'list':
    // a subfolder is walked at the place it has among the entries of its parent.
    async findFiles(folder: string, fileName: RegExp): Promise<string[]> {

        const result: string[] = [];

        for (const entry of await this.list(folder)) {

            const fullPath = path.join(folder, entry.name);

            if (entry.isDirectory) {

                if (!isExcludedFolder(entry.name)) {
                    result.push(...await this.findFiles(fullPath, fileName));
                }

            } else if (fileName.test(entry.name)) {

                result.push(fullPath);
            }
        }

        return result;
    }

    private _folders = new Map<string, Promise<FolderEntry[]>>();
    private _files = new Map<string, Promise<string>>();
}

export function isExcludedFolder(name: string): boolean {

    return excludedFolders.has(name.toLowerCase());
}

// Matches a pattern against a text from the start of it, whatever state a 'g' or 'y' pattern was left in
function firstMatch(pattern: RegExp, text: string): RegExpExecArray | null {

    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    pattern.lastIndex = 0;

    return match;
}

// By name, upper-cased: the order NTFS lists a folder in, made the order of every file system
function compareByName(a: FolderEntry, b: FolderEntry): number {

    const upperA = a.name.toUpperCase();
    const upperB = b.name.toUpperCase();

    if (upperA !== upperB) {
        return upperA < upperB ? -1 : 1;
    }

    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
}
