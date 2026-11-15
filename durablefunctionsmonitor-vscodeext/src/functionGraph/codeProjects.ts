// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { extractBindings } from './bindings';
import type { FunctionCode } from './callGraph';
import { cleanupFunctionName, escapeRegExp, getCodeInBrackets, posToLineNr, removeNamespace } from './codeText';
import { type Dialect, type PatternAndGroup, defaultDialect, pythonDialect } from './dialects';
import type { ProjectFiles } from './projectFiles';
import type { FunctionBinding, FunctionsMap } from './traversal';

// Projects whose functions are declared in code: C#, F# and Java with attributes, Python (the v2 model) with decorators.

// What a language needs to say about itself for its functions to be found
export type CodeLanguage = {
    dialect: Dialect;
    // Finds every function declared below a folder, with its bindings
    findFunctions(files: ProjectFiles, folder: string): Promise<FunctionsMap>;
    // Finds the code of one function
    findCode(files: ProjectFiles, folder: string, functionName: string): Promise<FunctionCode | undefined>;
};

// A function, as it was found in a source file
type DeclaredFunction = {
    functionName: string;
    filePath: string;
    pos: number;
    lineNr: number;
    // From the attribute that names the function to the opening bracket of its body: attributes, return type, parameters
    declarationCode: string;
};

const backtick = '`';
const durableTriggers = ['orchestrationTrigger', 'entityTrigger', 'activityTrigger'];

// [Function("Name")], [FunctionName(nameof(Name))] and so on, from 'Function' up to the closing quote or bracket
function functionStartRegex(functionName: string): RegExp {

    return new RegExp(String.raw`Function(Name)?(Attribute)?\s*\(\s*(nameof\s*\(\s*|["'${backtick}]|[\w\s\.]+\.\s*)${escapeRegExp(functionName)}\s*["'${backtick}\)]{1}`);
}

// Finds every function the given attribute declares, in every file below a folder
async function findDeclaredFunctions(files: ProjectFiles, folder: string, fileName: RegExp, attribute: () => PatternAndGroup): Promise<DeclaredFunction[]> {

    const result: DeclaredFunction[] = [];

    for (const filePath of await files.findFiles(folder, fileName)) {

        const code = await files.read(filePath);

        // A pattern of its own for every file: it is a global one, and remembers where it stopped
        const { regex, group } = attribute();

        let match: RegExpExecArray | null;
        while ((match = regex.exec(code))) {

            const functionName = cleanupFunctionName(match[group]);
            const attributeEndPos = match.index + match[0].length;

            // A body spans lines, which is what tells it from the brackets of the declaration before it
            const body = getCodeInBrackets(code, attributeEndPos, '{', '}', '\n');

            const func = { functionName, filePath, pos: match.index, lineNr: posToLineNr(code, match.index) };

            if (body.openBracketPos >= 0 && body.code) {

                result.push({ ...func, declarationCode: body.code.substring(0, body.openBracketPos) });

            } else {

                // No body: the rest of the file is all there is to go by, and nothing in it can be another function
                result.push({ ...func, declarationCode: code.substring(attributeEndPos) });

                break;
            }
        }
    }

    return result;
}

function toFunctionsMap(declaredFunctions: { func: DeclaredFunction, bindings: FunctionBinding[] }[]): FunctionsMap {

    const result: FunctionsMap = {};

    for (const { func, bindings } of declaredFunctions) {

        // A name declared twice is one function: the last declaration wins
        result[func.functionName] = { filePath: func.filePath, pos: func.pos, lineNr: func.lineNr, bindings };
    }

    return result;
}

// Languages with curly brackets around a function's body: the code of a function is the first block after its attribute
function bracketLanguage(fileName: RegExp, attribute: () => PatternAndGroup, findMoreBindings?: (files: ProjectFiles, folder: string, declarationCode: string) => Promise<FunctionBinding[]>): CodeLanguage {

    const dialect = defaultDialect;

    return {

        dialect,

        async findFunctions(files, folder) {

            const result = [];

            for (const func of await findDeclaredFunctions(files, folder, fileName, attribute)) {

                const bindings = extractBindings(func.declarationCode, dialect);

                if (findMoreBindings && !bindings.some(b => durableTriggers.includes(b.type as string))) {
                    bindings.push(...await findMoreBindings(files, folder, func.declarationCode));
                }

                result.push({ func, bindings });
            }

            return toFunctionsMap(result);
        },

        async findCode(files, folder, functionName) {

            const match = await files.findFile(folder, fileName, functionStartRegex(functionName), functionName);
            if (!match) {
                return undefined;
            }

            return {
                name: functionName,
                code: getCodeInBrackets(match.code, match.pos + match.length, '{', '}', '\n').code,
                filePath: match.filePath,
                pos: match.pos,
                lineNr: posToLineNr(match.code, match.pos)
            };
        }
    };
}

const csFileName = /.+\.cs$/i;
const functionReturnTypeRegex = /public\s*(static\s*|async\s*)*(Task\s*<\s*)?([\w.]+)/;

// The isolated worker model returns several outputs as one object, whose properties carry the output bindings:
//
//     public class MyOutputs { [QueueOutput("orders")] public string Order { get; set; } ... }
//
// So the class a function returns is looked up, and the attributes inside it are bindings of the function.
async function findBindingsOfReturnType(files: ProjectFiles, folder: string, declarationCode: string): Promise<FunctionBinding[]> {

    const returnTypeMatch = functionReturnTypeRegex.exec(declarationCode);
    if (!returnTypeMatch) {
        return [];
    }

    const returnTypeName = removeNamespace(returnTypeMatch[3]);
    if (!returnTypeName) {
        return [];
    }

    // The whole name: a function that returns Task is not returning a class called TaskResult
    const classDefinitionRegex = new RegExp(String.raw`\bclass\s+${escapeRegExp(returnTypeName)}\b`);

    const definition = await files.findFile(folder, csFileName, classDefinitionRegex, returnTypeName);
    if (!definition) {
        return [];
    }

    const classBody = getCodeInBrackets(definition.code, definition.pos + definition.length, '{', '}');

    return classBody.code ? extractBindings(classBody.code, defaultDialect) : [];
}

export const cSharp = bracketLanguage(
    csFileName,
    () => ({ regex: /\[\s*Function(Name)?(Attribute)?\s*\((["\w\s.()-]+)\)\s*\]/g, group: 3 }),
    findBindingsOfReturnType);

export const fSharp = bracketLanguage(
    /.+\.fs$/i,
    () => ({ regex: /\[<\s*Function(Name)?\s*\((["\w\s.()-]+)\)/g, group: 2 }));

export const java = bracketLanguage(
    /.+\.java$/i,
    () => ({ regex: /@\s*FunctionName\s*\((["\w\s.()-]+)\)/g, group: 1 }));

const pyFileName = /.+\.py$/i;

// A decorator that makes a function an Azure Function, up to the name of the function it is on
const pythonFunctionRegex = () => /@[\w\s]+\.\s*(function_name|route|blob_trigger|cosmos_db_trigger|event_hub_message_trigger|queue_trigger|service_bus_queue_trigger|service_bus_topic_trigger|orchestration_trigger|activity_trigger|schedule)(.|\r|\n)+?def\s+([\w-]+)/g;

// @app.function_name(name="MyFunc") gives a function a name other than its own
const pythonFunctionNameRegex = /\.\s*function_name\s*\(\s*name\s*=\s*["']([\w-]+)["']/;

function pythonFunctionStartRegex(functionName: string): RegExp {

    const name = escapeRegExp(functionName);

    // The whole name: 'def hello' is not where 'hello_orchestrator' is defined
    return new RegExp(String.raw`(@[\w\s]+\.\s*function_name\s*\(\s*name\s*=\s*["']${name}["']|^(async)?\s*def\s+${name}(?![\w-]))`, 'm');
}

// Splits a Python function into its decorators and its body. 'startPos' is where the decorators begin.
// The body ends where the next line begins that is not indented.
function getPythonFunctionCode(code: string, startPos: number): { declarationCode: string, bodyCode: string } {

    const defRegex = /^(async)?\s*def /gm;
    defRegex.lastIndex = startPos;

    const defMatch = defRegex.exec(code);
    if (!defMatch) {

        const restOfFile = code.substring(startPos);
        return { declarationCode: restOfFile, bodyCode: restOfFile };
    }

    const bodyPos = defMatch.index + defMatch[0].length;

    const nextStatementRegex = /^[^\s]/gm;
    nextStatementRegex.lastIndex = bodyPos;

    const nextStatementMatch = nextStatementRegex.exec(code);

    return {
        declarationCode: code.substring(startPos, defMatch.index),
        bodyCode: nextStatementMatch ? code.substring(bodyPos, nextStatementMatch.index) : code.substring(bodyPos)
    };
}

export const pythonV2: CodeLanguage = {

    dialect: pythonDialect,

    async findFunctions(files, folder) {

        const result = [];

        for (const filePath of await files.findFiles(folder, pyFileName)) {

            const code = await files.read(filePath);
            const regex = pythonFunctionRegex();

            let match: RegExpExecArray | null;
            while ((match = regex.exec(code))) {

                let functionName = match[3];
                let { declarationCode } = getPythonFunctionCode(code, match.index);

                const functionNameMatch = pythonFunctionNameRegex.exec(declarationCode);
                if (functionNameMatch) {

                    functionName = functionNameMatch[1];

                    // The decorator that names the function is not a binding
                    declarationCode = declarationCode.replace('function_name', '');
                }

                result.push({
                    func: { functionName, filePath, pos: match.index, lineNr: posToLineNr(code, match.index), declarationCode },
                    bindings: extractBindings(declarationCode, pythonDialect)
                });
            }
        }

        return toFunctionsMap(result);
    },

    async findCode(files, folder, functionName) {

        const match = await files.findFile(folder, pyFileName, pythonFunctionStartRegex(functionName), functionName);
        if (!match) {
            return undefined;
        }

        // The pattern can match from the line break before 'def' on (^ is also after a \r), or from the blank
        // lines above it. The function is where its first character is.
        let pos = match.pos;
        while (pos < match.pos + match.length && /\s/.test(match.code[pos])) {
            pos++;
        }

        return {
            name: functionName,
            code: getPythonFunctionCode(match.code, match.pos).bodyCode,
            filePath: match.filePath,
            pos,
            lineNr: posToLineNr(match.code, pos)
        };
    }
};
