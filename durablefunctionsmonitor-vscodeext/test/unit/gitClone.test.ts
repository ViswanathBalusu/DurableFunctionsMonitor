// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { cloneRepo, parseRefNames, parseRepoUrl, splitTreePath } from '../../src/functionGraph/gitClone';

describe('parseRepoUrl', () => {

    test('reads a link to a GitHub repository', () => {

        expect(parseRepoUrl('https://github.com/my-org/my-repo')).toEqual({ cloneUrl: 'https://github.com/my-org/my-repo.git', repoName: 'my-repo', treePath: [] });
        expect(parseRepoUrl('https://github.com/my-org/my-repo/')).toEqual({ cloneUrl: 'https://github.com/my-org/my-repo.git', repoName: 'my-repo', treePath: [] });
        expect(parseRepoUrl('  https://github.com/my-org/my-repo.git\n')).toEqual({ cloneUrl: 'https://github.com/my-org/my-repo.git', repoName: 'my-repo', treePath: [] });
        expect(parseRepoUrl('HTTPS://GitHub.com/My-Org/My.Repo?tab=readme-ov-file#usage')).toEqual({ cloneUrl: 'HTTPS://GitHub.com/My-Org/My.Repo.git', repoName: 'My.Repo', treePath: [] });
    });

    test('reads the branch and the folder of a link into a repository, without telling which is which', () => {

        expect(parseRepoUrl('https://github.com/my-org/my-repo/tree/release/2.0/src/My%20App/').treePath).toEqual(['release', '2.0', 'src', 'My App']);
        expect(parseRepoUrl('https://github.com/my-org/my-repo/tree/main').treePath).toEqual(['main']);
        expect(parseRepoUrl('https://github.com/my-org/my-repo/tree/main?x=1').treePath).toEqual(['main']);
        expect(parseRepoUrl('https://github.com/my-org/my-repo/tree/a%ZZb').treePath).toEqual(['a%ZZb']);
    });

    test('has no use for the other pages of a repository', () => {

        expect(parseRepoUrl('https://github.com/my-org/my-repo/blob/main/host.json').treePath).toEqual([]);
        expect(parseRepoUrl('https://github.com/my-org/my-repo/issues/12').treePath).toEqual([]);
    });

    test('clones any other link as it is', () => {

        expect(parseRepoUrl('https://dev.azure.com/org/project/_git/my-repo')).toEqual({ cloneUrl: 'https://dev.azure.com/org/project/_git/my-repo', repoName: 'my-repo', treePath: [] });
        expect(parseRepoUrl('https://gitlab.com/group/my-repo.git')).toEqual({ cloneUrl: 'https://gitlab.com/group/my-repo.git', repoName: 'my-repo', treePath: [] });
        expect(parseRepoUrl('http://localhost:3000/me/my-repo/').repoName).toBe('my-repo');
    });
});

describe('parseRefNames', () => {

    test('lists the branches and tags of git ls-remote', () => {

        const output = [
            '8d3c2b7f\tHEAD',
            '8d3c2b7f\trefs/heads/main',
            '1a2b3c4d\trefs/heads/release/2.0',
            '5e6f7a8b\trefs/tags/v1.0',
            '9c0d1e2f\trefs/tags/v1.0^{}',
            'aaaabbbb\trefs/pull/7/head',
            ''
        ].join('\r\n');

        expect(parseRefNames(output)).toEqual(['main', 'release/2.0', 'v1.0']);
        expect(parseRefNames('')).toEqual([]);
    });
});

describe('splitTreePath', () => {

    test('takes the longest branch name the repository has', () => {

        expect(splitTreePath(['release', '2.0', 'src', 'app'], ['main', 'release', 'release/2.0'])).toEqual({ ref: 'release/2.0', folders: ['src', 'app'] });
        expect(splitTreePath(['release', '2.0', 'src', 'app'], ['main', 'release'])).toEqual({ ref: 'release', folders: ['2.0', 'src', 'app'] });
        expect(splitTreePath(['main'], ['main'])).toEqual({ ref: 'main', folders: [] });
    });

    test('has neither a branch nor a folder when the link names no branch of the repository', () => {

        // A commit, or a branch that is gone: the default branch is what is left to show
        expect(splitTreePath(['0123abc', 'src'], ['main'])).toEqual({ folders: [] });
        expect(splitTreePath([], ['main'])).toEqual({ folders: [] });
    });
});

function hasGit(): boolean {

    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Needs git, which every machine that could have checked this repository out has
describe.skipIf(!hasGit())('cloneRepo', () => {

    let workFolder: string;
    let cloneUrl: string;
    const clones: string[] = [];

    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.org', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

    const write = (repoFolder: string, relativePath: string, content: string) => {

        const filePath = path.join(repoFolder, ...relativePath.split('/'));

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    };

    beforeAll(() => {

        // A repository with a default branch, and a branch with a slash in its name that has the project in a folder
        workFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-git-'));

        const repoFolder = path.join(workFolder, 'sample-repo');
        fs.mkdirSync(repoFolder);

        git(repoFolder, 'init', '--initial-branch', 'main');
        write(repoFolder, 'host.json', '{ "branch": "main" }');
        git(repoFolder, 'add', '.');
        git(repoFolder, 'commit', '-m', 'main');

        git(repoFolder, 'checkout', '-b', 'release/2.0');
        write(repoFolder, 'src/app/host.json', '{ "branch": "release/2.0" }');
        git(repoFolder, 'add', '.');
        git(repoFolder, 'commit', '-m', 'release');
        git(repoFolder, 'tag', 'v2.0');

        git(repoFolder, 'checkout', 'main');

        cloneUrl = pathToFileURL(repoFolder).href;
    });

    afterAll(() => {

        for (const folder of [...clones, workFolder]) {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });

    const clone = async (treePath: string[]) => {

        const result = await cloneRepo({ cloneUrl, repoName: 'sample-repo', treePath });
        clones.push(result.gitTempFolder);

        return result;
    };

    test('clones the default branch into a temporary folder of its own', async () => {

        const { gitTempFolder, projectFolder } = await clone([]);

        expect(projectFolder).toBe(path.join(gitTempFolder, 'sample-repo'));
        expect(path.basename(gitTempFolder)).toMatch(/^git-clone-/);
        expect(JSON.parse(fs.readFileSync(path.join(projectFolder, 'host.json'), 'utf8'))).toEqual({ branch: 'main' });
        expect(fs.existsSync(path.join(projectFolder, 'src'))).toBe(false);
    });

    test('clones the branch of a link, and points at the folder the link is to', async () => {

        const { gitTempFolder, projectFolder } = await clone(['release', '2.0', 'src', 'app']);

        expect(projectFolder).toBe(path.join(gitTempFolder, 'sample-repo', 'src', 'app'));
        expect(JSON.parse(fs.readFileSync(path.join(projectFolder, 'host.json'), 'utf8'))).toEqual({ branch: 'release/2.0' });
    });

    test('clones a tag as well', async () => {

        const { projectFolder } = await clone(['v2.0', 'src']);

        expect(fs.existsSync(path.join(projectFolder, 'app', 'host.json'))).toBe(true);
    });

    test('falls back to the default branch when the link names none the repository has', async () => {

        const { gitTempFolder, projectFolder } = await clone(['gone', 'src', 'app']);

        expect(projectFolder).toBe(path.join(gitTempFolder, 'sample-repo'));
        expect(JSON.parse(fs.readFileSync(path.join(projectFolder, 'host.json'), 'utf8'))).toEqual({ branch: 'main' });
    });

    test('refuses a folder that would be outside of the repository', async () => {

        await expect(cloneRepo({ cloneUrl, repoName: 'sample-repo', treePath: ['main', '..', '..'] })).rejects.toThrow('is not a folder of the repository');
    });

    test('says what git said when the repository cannot be cloned, and leaves nothing behind', async () => {

        const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('git-clone-'));

        const missing = pathToFileURL(path.join(workFolder, 'no-such-repo')).href;

        await expect(cloneRepo({ cloneUrl: missing, repoName: 'no-such-repo', treePath: [] })).rejects.toThrow(/^git clone failed\. /);
        await expect(cloneRepo({ cloneUrl: missing, repoName: 'no-such-repo', treePath: ['main'] })).rejects.toThrow(/^git ls-remote failed\. /);

        expect(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('git-clone-'))).toEqual(before);
    });

    test('does not hand a link to a shell', async () => {

        // With a shell this would run a second command. git is given it as one argument, and has no such repository.
        const marker = path.join(workFolder, 'injected.txt');
        const url = `${cloneUrl} && echo injected > "${marker}"`;

        await expect(cloneRepo({ cloneUrl: url, repoName: 'sample-repo', treePath: [] })).rejects.toThrow(/^git clone failed\. /);

        expect(fs.existsSync(marker)).toBe(false);
    });
});
