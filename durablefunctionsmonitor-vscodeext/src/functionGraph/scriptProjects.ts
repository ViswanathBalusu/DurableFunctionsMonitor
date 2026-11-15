// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';

import type { FunctionCode } from './callGraph';
import { escapeRegExp, posToLineNr } from './codeText';
import type { ProjectFiles } from './projectFiles';
import type { FunctionsMap, ProxiesMap } from './traversal';

// Projects of the function.json programming model (JavaScript, TypeScript, Python v1, PowerShell): one folder
// per function, with a function.json that lists its bindings and a script that is its code. Plus proxies.json,
// which belongs to no language.

type Log = (line: string) => void;

const functionJsonName = 'function.json';

// Reads the function.json of every function folder, which are the folders right below host.json
export async function readFunctionsJson(files: ProjectFiles, hostJsonFolder: string, log: Log): Promise<FunctionsMap> {

    const functions: FunctionsMap = {};

    for (const entry of await files.list(hostJsonFolder)) {

        if (!entry.isDirectory) {
            continue;
        }

        const functionJsonPath = path.join(hostJsonFolder, entry.name, functionJsonName);
        if (!(await files.exists(functionJsonPath))) {
            continue;
        }

        try {

            const functionJson = JSON.parse(await files.read(functionJsonPath));

            // A function.json without bindings is a function without bindings, not a reason to fail
            functions[entry.name] = { bindings: functionJson.bindings ?? [], isCalledBy: [], isSignalledBy: [] };

        } catch (err) {

            log(`>>> Failed to parse ${functionJsonPath}: ${err}`);
        }
    }

    return functions;
}

function wholeFile(functionName: string, filePath: string, code: string): FunctionCode {

    return { name: functionName, code, filePath, pos: 0, lineNr: posToLineNr(code, 0) };
}

const scriptFileName = /(index\.ts|index\.js|__init__\.py)$/i;

// JavaScript, TypeScript and Python v1: the code of a function is the index file of its folder
export async function findScriptCode(files: ProjectFiles, hostJsonFolder: string, functionName: string): Promise<FunctionCode | undefined> {

    const match = await files.findFile(path.join(hostJsonFolder, functionName), scriptFileName);

    return match ? wholeFile(functionName, match.filePath, match.code) : undefined;
}

const defaultPowershellScriptName = /run\.ps1$/i;

// PowerShell: the code of a function is run.ps1, unless its function.json names another script
export async function findPowershellCode(files: ProjectFiles, hostJsonFolder: string, functionName: string): Promise<FunctionCode | undefined> {

    const functionFolder = path.join(hostJsonFolder, functionName);

    const scriptFile = await readScriptFileSetting(files, functionFolder);
    if (scriptFile) {

        // 'scriptFile' is a path relative to the function's folder, and may point at a script that several functions share
        const scriptPath = path.resolve(functionFolder, scriptFile);

        if (isInside(hostJsonFolder, scriptPath) && await files.exists(scriptPath)) {
            return wholeFile(functionName, scriptPath, await files.read(scriptPath));
        }

        return undefined;
    }

    const match = await files.findFile(functionFolder, defaultPowershellScriptName);

    return match ? wholeFile(functionName, match.filePath, match.code) : undefined;
}

async function readScriptFileSetting(files: ProjectFiles, functionFolder: string): Promise<string | undefined> {

    try {

        const functionJson = JSON.parse(await files.read(path.join(functionFolder, functionJsonName)));

        return typeof functionJson.scriptFile === 'string' && functionJson.scriptFile ? functionJson.scriptFile : undefined;

    } catch {

        return undefined;
    }
}

// A project never reads code from outside of itself, whatever its function.json says
function isInside(folder: string, filePath: string): boolean {

    const relative = path.relative(folder, filePath);

    return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

const csprojFileName = /.+\.csproj$/i;
const proxiesJsonInCsprojRegex = /\s*=\s*"proxies.json"\s*>/;

// Reads proxies.json, which lives next to host.json, and notes where each proxy is defined in it
export async function readProxiesJson(files: ProjectFiles, hostJsonFolder: string, isCSharpProject: boolean, log: Log): Promise<ProxiesMap> {

    const proxiesJsonPath = path.join(hostJsonFolder, 'proxies.json');
    if (!(await files.exists(proxiesJsonPath))) {
        return {};
    }

    const proxiesJson = await files.read(proxiesJsonPath);

    try {

        const proxies = JSON.parse(proxiesJson).proxies as ProxiesMap;
        if (!proxies || typeof proxies !== 'object') {
            return {};
        }

        // A C# project only deploys the files its .csproj lists, and proxies.json is easy to forget there
        let notAddedToCsProjFile = false;
        if (isCSharpProject) {

            const csprojFile = await files.findFile(hostJsonFolder, csprojFileName);

            notAddedToCsProjFile = !!csprojFile?.code && !proxiesJsonInCsprojRegex.test(csprojFile.code);
        }

        for (const proxyName in proxies) {

            const proxy = proxies[proxyName];
            if (!proxy || typeof proxy !== 'object') {
                continue;
            }

            proxy.filePath = proxiesJsonPath;
            if (notAddedToCsProjFile) {
                proxy.warningNotAddedToCsProjFile = true;
            }

            const match = new RegExp(String.raw`"${escapeRegExp(proxyName)}"\s*:`).exec(proxiesJson);
            if (match) {

                proxy.pos = match.index;
                proxy.lineNr = posToLineNr(proxiesJson, proxy.pos);
            }
        }

        return proxies;

    } catch (err) {

        log(`>>> Failed to parse ${proxiesJsonPath}: ${err}`);
        return {};
    }
}
