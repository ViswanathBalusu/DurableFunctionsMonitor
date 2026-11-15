// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';

import { mapOrchestratorsAndActivities } from './callGraph';
import { type CodeLanguage, cSharp, fSharp, java, pythonV2 } from './codeProjects';
import { defaultDialect, powershellDialect } from './dialects';
import { ProjectFiles } from './projectFiles';
import { findPowershellCode, findScriptCode, readFunctionsJson, readProxiesJson } from './scriptProjects';
import type { FunctionsMap, TraversalResult } from './traversal';

// Builds the function map of an Azure Functions project: every function with its bindings, what calls what
// (when the project uses Durable Functions), and the proxies.
//
// Nothing is compiled, built or run: the project's files are read as text. That makes it work on any project the
// moment it is opened, at the price of being a good guess rather than the truth - see callGraph.ts.

type Log = (line: string) => void;

const hostJsonName = /^host\.json$/i;
const functionJsonName = /^function\.json$/i;

// Parses the project in (or below) a folder
export async function parseFunctionProject(projectFolder: string, log: Log): Promise<TraversalResult> {

    const files = new ProjectFiles();

    const hostJsonPath = await files.findFilePath(projectFolder, hostJsonName);
    if (!hostJsonPath) {
        throw new Error('host.json file not found under the provided project path');
    }

    log(`>>> Found host.json at ${hostJsonPath}`);

    const hostJsonFolder = path.dirname(hostJsonPath);

    const isCSharpProject = await hasProjectFile(files, hostJsonFolder, '.csproj');

    let functions: FunctionsMap;

    if (isCSharpProject) {

        functions = await parseCodeProject(files, projectFolder, cSharp);

    } else if (await hasProjectFile(files, hostJsonFolder, '.fsproj')) {

        functions = await parseCodeProject(files, projectFolder, fSharp);

    } else if (await files.hasFile(hostJsonFolder, /.+\.java$/i)) {

        functions = await parseCodeProject(files, projectFolder, java);

    } else if (await isPowershellProject(files, hostJsonFolder)) {

        functions = await mapOrchestratorsAndActivities(
            await readFunctionsJson(files, hostJsonFolder, log),
            name => findPowershellCode(files, hostJsonFolder, name),
            powershellDialect);

    } else if (await isPythonV2Project(files, hostJsonFolder)) {

        functions = await parseCodeProject(files, projectFolder, pythonV2);

    } else {

        functions = await mapOrchestratorsAndActivities(
            await readFunctionsJson(files, hostJsonFolder, log),
            name => findScriptCode(files, hostJsonFolder, name),
            defaultDialect);
    }

    const proxies = await readProxiesJson(files, hostJsonFolder, isCSharpProject, log);

    return { functions, proxies };
}

// Functions declared in code can live anywhere below the folder that was asked for, not only next to host.json:
// a Function App may get them from a class library next to it (this very repo does).
async function parseCodeProject(files: ProjectFiles, projectFolder: string, language: CodeLanguage): Promise<FunctionsMap> {

    const functions = await language.findFunctions(files, projectFolder);

    return mapOrchestratorsAndActivities(functions, name => language.findCode(files, projectFolder, name), language.dialect);
}

// A .csproj or .fsproj next to host.json. extensions.csproj is what a script project keeps its binding extensions in.
async function hasProjectFile(files: ProjectFiles, folder: string, extension: string): Promise<boolean> {

    return (await files.list(folder)).some(entry => {

        const name = entry.name.toLowerCase();

        return !entry.isDirectory && name.endsWith(extension) && name !== 'extensions.csproj';
    });
}

// The folder of the first function has a PowerShell script in it
async function isPowershellProject(files: ProjectFiles, folder: string): Promise<boolean> {

    const firstFunctionJson = await files.findFilePath(folder, functionJsonName);

    return !!firstFunctionJson && await files.hasFile(path.dirname(firstFunctionJson), /.+\.ps1$/i);
}

// Python code, and no function.json anywhere: the functions are declared with decorators
async function isPythonV2Project(files: ProjectFiles, folder: string): Promise<boolean> {

    return await files.hasFile(folder, /.+\.py$/i) && !(await files.hasFile(folder, functionJsonName));
}
