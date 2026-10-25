// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { Log } from '../logging';
import { FunctionGraphView } from './FunctionGraphView';
import type { TraversalResult } from './traversal';

import { FunctionProjectParser } from 'az-func-as-a-graph.core/dist/functionProjectParser';
import { FileSystemWrapper } from 'az-func-as-a-graph.core/dist/fileSystemWrapper';
import { cloneFromGitHub } from 'az-func-as-a-graph.core/dist/gitUtils';

// Aggregates Function Graph views
export class FunctionGraphList {

    constructor(private _context: vscode.ExtensionContext, private _log: Log) { }

    async traverseFunctions(projectPath: string): Promise<TraversalResult> {

        if (this._traversalResults[projectPath]) {
            return this._traversalResults[projectPath];
        }

        // If it is a git repo, cloning it
        if (projectPath.toLowerCase().startsWith('http')) {

            this._log(`Cloning ${projectPath}`);

            const gitInfo = await cloneFromGitHub(projectPath);

            this._log(`Successfully cloned to ${gitInfo.gitTempFolder}`);

            this._tempFolders.push(gitInfo.gitTempFolder);
            projectPath = gitInfo.projectFolder;
        }

        const result = await FunctionProjectParser.parseFunctions(projectPath, new FileSystemWrapper(), this._log);

        // Caching current project's functions
        if (vscode.workspace.workspaceFolders?.some(f => f.uri.fsPath === projectPath)) {

            this._traversalResults[projectPath] = { functions: result.functions, proxies: result.proxies };

            // And cleanup the cache on any change to the file system
            if (this._watcher) {
                this._watcher.dispose();
            }
            this._watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectPath, '**/*'));

            const cacheCleanupRoutine = () => {

                this._traversalResults = {};

                if (this._watcher) {
                    this._watcher.dispose();
                    this._watcher = undefined;
                }
            };

            this._watcher.onDidCreate(cacheCleanupRoutine);
            this._watcher.onDidDelete(cacheCleanupRoutine);
            this._watcher.onDidChange(cacheCleanupRoutine);
        }

        return { functions: result.functions, proxies: result.proxies };
    }

    visualize(item?: vscode.Uri): void {

        // If host.json was clicked
        if (!!item && item.scheme === 'file' && item.fsPath.toLowerCase().endsWith('host.json')) {

            this.visualizeProjectPath(path.dirname(item.fsPath));
            return;
        }

        let defaultProjectPath = '';
        const firstFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!!firstFolder && fs.existsSync(path.join(firstFolder, 'host.json'))) {
            defaultProjectPath = firstFolder;
        }

        vscode.window.showInputBox({ value: defaultProjectPath, prompt: 'Local path or link to GitHub repo' }).then(projectPath => {

            if (projectPath) {
                this.visualizeProjectPath(projectPath);
            }
        });
    }

    visualizeProjectPath(projectPath: string): void {

        try {
            this._views.push(new FunctionGraphView(this._context, projectPath, this, this._log));
        } catch (err: any) {
            vscode.window.showErrorMessage(err.message ?? err);
        }
    }

    // Closes all views, and removes what was cloned
    async cleanup(): Promise<void> {

        if (this._watcher) {
            this._watcher.dispose();
            this._watcher = undefined;
        }

        for (const view of this._views) {
            view.cleanup();
        }
        this._views = [];

        const tempFolders = this._tempFolders;
        this._tempFolders = [];

        for (const tempFolder of tempFolders) {

            this._log(`Removing ${tempFolder}`);
            try {
                await fs.promises.rm(tempFolder, { recursive: true, force: true });
            } catch (err: any) {
                this._log(`Failed to remove ${tempFolder}: ${err.message}`);
            }
        }
    }

    private _views: FunctionGraphView[] = [];
    private _traversalResults: { [path: string]: TraversalResult } = {};
    private _watcher?: vscode.FileSystemWatcher;
    private _tempFolders: string[] = [];
}
