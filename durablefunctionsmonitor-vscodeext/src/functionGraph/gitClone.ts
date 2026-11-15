// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Cloning for a function graph is a look at the files, not a checkout to work in. A repository that takes longer
// than this is not coming (a private one that git is waiting to be given a password for, say).
const gitTimeoutInMs = 60 * 1000;

export type RepoLocation = {
    // What 'git clone' is given
    cloneUrl: string;
    repoName: string;
    // What follows '/tree/' in a GitHub link: a branch or tag name (which may itself contain slashes),
    // then the path of a folder inside the repository
    treePath: string[];
};

export type ClonedRepo = {
    // The temporary folder that was created, to be removed when the graph is closed
    gitTempFolder: string;
    // The folder of the project inside of it
    projectFolder: string;
};

const gitHubUrlRegex = /^(https:\/\/github\.com\/[^/?#]+)\/([^/?#]+)(?:\/tree\/([^?#]*))?/i;

// Reads a link to a repository: https://github.com/org/repo, https://github.com/org/repo/tree/branch/folder,
// or the clone URL of any other git server
export function parseRepoUrl(url: string): RepoLocation {

    url = url.trim();

    const match = gitHubUrlRegex.exec(url);
    if (!match) {

        // Not a GitHub link: it is cloned as it is, and its last segment is the repository's name
        const withoutQuery = url.replace(/[?#].*$/, '').replace(/\/+$/, '');

        return { cloneUrl: url, repoName: toFolderName(withoutQuery.substring(withoutQuery.lastIndexOf('/') + 1)), treePath: [] };
    }

    const repoName = toFolderName(match[2]);

    return {
        cloneUrl: `${match[1]}/${repoName}.git`,
        repoName,
        treePath: (match[3] ?? '').split('/').map(segment => safeDecode(segment)).filter(segment => !!segment)
    };
}

function toFolderName(repoName: string): string {

    return repoName.replace(/\.git$/i, '');
}

function safeDecode(segment: string): string {

    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

// Tells the branch (or tag) of a '/tree/...' link from the folder that follows it. A branch name may contain
// slashes, so the link alone cannot tell: 'release/2.0/src' is the folder 'src' of branch 'release/2.0', or the
// folder '2.0/src' of branch 'release'. The names the repository actually has decide it, the longest one winning.
export function splitTreePath(treePath: string[], refNames: Iterable<string>): { ref?: string, folders: string[] } {

    const refs = new Set(refNames);

    for (let i = treePath.length; i > 0; i--) {

        const ref = treePath.slice(0, i).join('/');
        if (refs.has(ref)) {
            return { ref, folders: treePath.slice(i) };
        }
    }

    return { folders: [] };
}

// Reads the branch and tag names out of what 'git ls-remote --heads --tags' prints
export function parseRefNames(lsRemoteOutput: string): string[] {

    const result: string[] = [];

    for (const line of lsRemoteOutput.split(/\r?\n/)) {

        const match = /\srefs\/(?:heads|tags)\/(.+)$/.exec(line);

        // 'refs/tags/v1^{}' is the commit an annotated tag points at, not another tag
        if (match && !match[1].endsWith('^{}')) {
            result.push(match[1]);
        }
    }

    return result;
}

async function git(args: string[], cwd: string): Promise<string> {

    try {

        const { stdout } = await execFileAsync('git', args, {
            cwd,
            timeout: gitTimeoutInMs,
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
            // Nobody is there to type a password in: fail, instead of waiting for one until the timeout
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        });

        return stdout;

    } catch (err: any) {

        if (err.code === 'ENOENT') {
            throw new Error('git was not found. Install git to visualize a repository by its link.', { cause: err });
        }

        if (err.killed) {
            throw new Error(`git ${args[0]} timed out after ${gitTimeoutInMs / 1000} sec.`, { cause: err });
        }

        throw new Error(`git ${args[0]} failed. ${String(err.stderr || err.message).trim()}`, { cause: err });
    }
}

// Clones a repository into a new temporary folder and tells where the project is in it.
// git is given its arguments as they are, never through a shell: a link is something a user pasted.
export async function cloneRepo(location: RepoLocation): Promise<ClonedRepo> {

    const gitTempFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-clone-'));

    try {

        let ref: string | undefined;
        let folders: string[] = [];

        if (location.treePath.length > 0) {

            const refNames = parseRefNames(await git(['ls-remote', '--heads', '--tags', '--', location.cloneUrl], gitTempFolder));

            ({ ref, folders } = splitTreePath(location.treePath, refNames));
        }

        // The folder is named after the repository only when that is a name a folder can safely have
        const repoFolder = path.join(gitTempFolder, /^[\w.-]+$/.test(location.repoName) && !/^\.+$/.test(location.repoName) ? location.repoName : 'repo');

        // The files of one commit are all that is needed
        await git(['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', location.cloneUrl, repoFolder], gitTempFolder);

        const projectFolder = path.join(repoFolder, ...folders);

        // The folder of a link stays inside the repository it is a link to
        const relative = path.relative(repoFolder, projectFolder);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            throw new Error(`'${folders.join('/')}' is not a folder of the repository`);
        }

        return { gitTempFolder, projectFolder };

    } catch (err) {

        await fs.promises.rm(gitTempFolder, { recursive: true, force: true }).catch(() => undefined);
        throw err;
    }
}

// Clones the repository a link points to
export function cloneFromGitHub(url: string): Promise<ClonedRepo> {

    return cloneRepo(parseRepoUrl(url));
}
