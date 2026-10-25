// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';

import { Settings } from '../Settings';
import type { Log } from '../logging';
import { LocalProject, findFunctionsProjects } from './LocalProject';

// The Azure Functions projects among the folders of the workspace.
// A workspace that is not trusted is not read at all: host.json and local.settings.json are files somebody else
// wrote, and what is in them (connection strings, a hub name) ends up in a backend that is started with them.
export function getWorkspaceProjectFolders(): string[] {

    if (!vscode.workspace.isTrusted) {
        return [];
    }

    return findFunctionsProjects((vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath));
}

// The first Azure Functions project of the workspace (the one that is used for Functions graph, and to suggest connection settings)
export function getFirstWorkspaceProjectFolder(): string | undefined {
    return getWorkspaceProjectFolders()[0];
}

export function createLocalProject(projectPath: string, log: Log): LocalProject {
    return new LocalProject(projectPath, () => Settings().storageEmulatorConnectionString, log);
}
