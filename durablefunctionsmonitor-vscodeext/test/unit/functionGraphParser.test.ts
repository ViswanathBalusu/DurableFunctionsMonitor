// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { parseFunctionProject } from '../../src/functionGraph/projectParser';
import type { TraversalResult } from '../../src/functionGraph/traversal';
import {
    type ProjectFilesContent, cSharpInProcessProject, cSharpIsolatedProject, fSharpProject, javaProject, powershellProject,
    pythonV2Project, removeProject, scriptProject, writeProject
} from './helpers/functionProjects';

const folders: string[] = [];

afterEach(() => {

    for (const folder of folders.splice(0)) {
        removeProject(folder);
    }
});

// Parses a project, and makes the file paths of the result relative to it, with forward slashes
async function parse(files: ProjectFilesContent, options: { lineBreak?: '\n' | '\r\n', subFolder?: string, log?: string[] } = {}): Promise<TraversalResult> {

    const folder = writeProject(files, options.lineBreak);
    folders.push(folder);

    const result = await parseFunctionProject(options.subFolder ? path.join(folder, options.subFolder) : folder, line => options.log?.push(line.split(folder).join('<root>')));

    for (const map of [result.functions, result.proxies]) {
        for (const name in map) {

            const filePath = map[name].filePath;
            if (filePath) {
                map[name].filePath = path.relative(folder, filePath).split(path.sep).join('/');
            }
        }
    }

    return result;
}

// What each sample project is known to parse to. These were produced with az-func-as-a-graph.core 1.3.3, the
// package this parser replaced, and differ from its output only where a test below says why.
function expectedMap(name: string): TraversalResult {

    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'functionGraph', `${name}.json`), 'utf8'));
}

const sampleProjects: [string, ProjectFilesContent][] = [
    ['cSharpIsolated', cSharpIsolatedProject],
    ['cSharpInProcess', cSharpInProcessProject],
    ['fSharp', fSharpProject],
    ['java', javaProject],
    ['pythonV2', pythonV2Project],
    ['powershell', powershellProject],
    ['script', scriptProject]
];

describe('parseFunctionProject', () => {

    test.each(sampleProjects)('builds the function map of a %s project', async (name, files) => {

        const expected = expectedMap(name);
        const result = await parse(files);

        expect(result).toEqual(expected);

        // The order is part of the result: the same project gives the same map, on every machine
        expect(Object.keys(result.functions)).toEqual(Object.keys(expected.functions));
    });

    test.each(sampleProjects)('finds the same functions on the same lines in a %s project with Windows line endings', async (name, files) => {

        const expected = expectedMap(name);
        const result = await parse(files, { lineBreak: '\r\n' });

        // A line break is two characters now, so every position moved, and nothing else did
        const withoutPositions = (map: TraversalResult) => JSON.parse(JSON.stringify(map, (key, value) => key === 'pos' ? undefined : value));

        expect(withoutPositions(result)).toEqual(withoutPositions(expected));

        for (const functionName in expected.functions) {

            const expectedPos = expected.functions[functionName].pos!;
            const lineBreaksBefore = expected.functions[functionName].lineNr! - 1;

            expect(result.functions[functionName].pos, functionName).toBe(expectedPos + lineBreaksBefore);
        }
    });

    test('connects an orchestration with what starts it, what it calls and what signals it', async () => {

        const { functions } = await parse(cSharpIsolatedProject);

        expect(functions.ProcessOrder.isCalledBy).toEqual(['HttpStart']);
        expect(functions.ProcessOrder.isSignalledBy).toEqual([{ name: 'Approve', signalName: 'Approval' }]);
        expect(functions.ValidateOrder.isCalledBy).toEqual(['ProcessOrder', 'ShipOrder']);
        expect(functions.ChargeCard.isCalledBy).toEqual(['ProcessOrder']);
        expect(functions.ShipOrder.isCalledBy).toEqual(['ProcessOrder']);
        expect(functions.Cleanup.isCalledBy).toEqual(['TimerStart']);
        expect(functions.Cleanup.isCalledByItself).toBe(true);
        expect(functions.ProcessOrder.isCalledByItself).toBeUndefined();
    });

    test('takes the output bindings of an isolated worker function from the class it returns', async () => {

        const { functions } = await parse(cSharpIsolatedProject);

        expect(functions.QueueToMany.bindings).toEqual([
            { type: 'queueTrigger', queueName: 'incoming-orders' },
            { type: 'queue', direction: 'out', queueName: 'processed-orders' },
            { type: 'blob', direction: 'out', path: 'archive/{rand-guid}.json' }
        ]);
    });

    test('does not take a class whose name merely starts with the return type for the return type', async () => {

        const { functions } = await parse({
            'host.json': '{}',
            'App.csproj': '<Project />',
            'Functions.cs': `public class Functions
{
    [Function("Plain")]
    public async Task Plain([QueueTrigger("in")] string message)
    {
        await Task.Delay(1);
    }
}

public class TaskResult
{
    [QueueOutput("not-an-output-of-plain")]
    public string Message { get; set; }
}
`
        });

        // az-func-as-a-graph matched 'class Task...' and gave Plain the queue output of TaskResult
        expect(functions.Plain.bindings).toEqual([{ type: 'queueTrigger', queueName: 'in' }]);
    });

    test('tells an output parameter of the in-process model from an input', async () => {

        const { functions } = await parse({
            'host.json': '{}',
            'App.csproj': '<Project />',
            'Functions.cs': `public static class Functions
{
    [FunctionName("Copy")]
    public static void Copy(
        [QueueTrigger("in")] string message,
        [Blob("templates/{queueTrigger}")] string template,
        [Blob("out/{queueTrigger}")] out string copy,
        [Table("Audit")] ICollector<AuditRow> audit,
        [Table("Lookups")] CloudTable lookups,
        [CosmosDB("db", "items", ConnectionStringSetting = "Cosmos")] IAsyncCollector<object> items)
    {
        copy = template;
    }
}
`
        });

        // az-func-as-a-graph reported every one of these as an input: its check for an output never matched
        expect(functions.Copy.bindings).toEqual([
            { type: 'queueTrigger', queueName: 'in' },
            { type: 'blob', direction: 'in', path: 'templates/{queueTrigger}' },
            { type: 'blob', direction: 'out', path: 'out/{queueTrigger}' },
            { type: 'table', direction: 'out', tableName: 'Audit' },
            { type: 'table', direction: 'in', tableName: 'Lookups' },
            { type: 'cosmosDB', direction: 'out', databaseName: 'db', collectionName: 'items' }
        ]);
    });

    test('finds the functions of a file that comes after one that ends with a function without a body', async () => {

        const { functions } = await parse({
            'host.json': '{}',
            'App.csproj': '<Project />',
            // Long enough for its last function to sit further into the file than the first one of B.cs does
            'A.cs': `// ${'-'.repeat(400)}
public static class A
{
    [Function("ExpressionBodied")]
    public static string ExpressionBodied([ActivityTrigger] string input) => input;
}
`,
            'B.cs': `public static class B
{
    [Function("First")]
    public static string First([ActivityTrigger] string input)
    {
        return input;
    }
}
`
        });

        // az-func-as-a-graph kept reading B.cs from where it had stopped in A.cs, and so never saw First
        expect(Object.keys(functions)).toEqual(['ExpressionBodied', 'First']);
    });

    test('matches names as they are written, not as patterns', async () => {

        const { functions } = await parse({
            'host.json': '{}',
            'Orchestrator/function.json': '{ "bindings": [ { "type": "orchestrationTrigger", "direction": "in", "name": "context" } ] }',
            'Orchestrator/index.js': `module.exports = df.orchestrator(function* (context) {
    yield context.df.callActivity("Send.Mail", "x");
    yield context.df.callActivity("SendXText", "x");
});
`,
            'Send.Mail/function.json': '{ "bindings": [ { "type": "activityTrigger", "direction": "in", "name": "input" } ] }',
            'Send.Mail/index.js': 'module.exports = async () => {};',
            'Send.Text/function.json': '{ "bindings": [ { "type": "activityTrigger", "direction": "in", "name": "input" } ] }',
            'Send.Text/index.js': 'module.exports = async () => {};'
        });

        expect(functions['Send.Mail'].isCalledBy).toEqual(['Orchestrator']);

        // 'Send.Text' is not called: 'SendXText' is some other activity. As a pattern, the dot matched the X.
        expect(functions['Send.Text'].isCalledBy).toEqual([]);
    });

    test('finds a Python function by its whole name', async () => {

        const { functions } = await parse(pythonV2Project);

        // 'def hello' is not where hello_orchestrator is defined, which is where az-func-as-a-graph pointed for it
        expect(functions.hello_orchestrator.lineNr).toBe(13);
        expect(functions.hello.lineNr).toBe(19);
    });

    test('says so when there is no host.json', async () => {

        await expect(parse({ 'readme.md': 'Not a Functions project' })).rejects.toThrow('host.json file not found under the provided project path');
    });

    test('finds host.json below the folder it is given, and reports it', async () => {

        const log: string[] = [];
        const { functions, proxies } = await parse({
            'readme.md': 'A repository with the Function App in a folder of its own',
            'ghost.json': '{}',
            'src/app/host.json': '{}',
            'src/app/proxies.json': '{ "proxies": { "Docs": { "matchCondition": { "route": "/docs" } } } }',
            'src/app/Hello/function.json': '{ "bindings": [ { "type": "httpTrigger", "direction": "in", "name": "req" } ] }',
            'src/app/Hello/index.js': 'module.exports = async () => {};'
        }, { log });

        expect(Object.keys(functions)).toEqual(['Hello']);
        expect(functions.Hello.filePath).toBe('src/app/Hello/index.js');

        // proxies.json belongs next to host.json, wherever that is
        expect(proxies.Docs.filePath).toBe('src/app/proxies.json');

        expect(log).toEqual([`>>> Found host.json at <root>${path.sep}src${path.sep}app${path.sep}host.json`]);
    });

    test('reads the code of a C# Function App from the projects next to it', async () => {

        // The folder that is asked for is what gets searched, host.json only says what kind of project it is
        const { functions } = await parse({
            'App/host.json': '{}',
            'App/App.csproj': '<Project />',
            'App/Program.cs': 'var host = new HostBuilder().Build();',
            'Library/Functions.cs': `public class Functions
{
    [Function(nameof(Ping))]
    public string Ping([HttpTrigger(AuthorizationLevel.Anonymous, "get")] HttpRequestData req)
    {
        return "pong";
    }
}
`
        });

        expect(functions.Ping.filePath).toBe('Library/Functions.cs');
        expect(functions.Ping.bindings).toEqual([{ type: 'httpTrigger', methods: ['get'], authLevel: 'anonymous' }, { type: 'http', direction: 'out' }]);
    });

    test('leaves build output, dependencies and tooling folders alone', async () => {

        const decoy = (name: string) => `public class ${name} { [Function("${name}")] public void Run([QueueTrigger("q")] string m)
{
} }`;

        const { functions } = await parse({
            'host.json': '{}',
            'App.csproj': '<Project />',
            'Real.cs': decoy('Real'),
            'bin/Debug/InBin.cs': decoy('InBin'),
            'obj/InObj.cs': decoy('InObj'),
            'node_modules/pkg/InNodeModules.cs': decoy('InNodeModules'),
            '.git/InGit.cs': decoy('InGit'),
            'Nested/BIN/InUpperCaseBin.cs': decoy('InUpperCaseBin'),
            'Nested/Kept.cs': decoy('Kept')
        });

        expect(Object.keys(functions)).toEqual(['Kept', 'Real']);
    });

    test('does not take the extensions project of a script app for a C# app', async () => {

        const { functions } = await parse({
            'host.json': '{}',
            'extensions.csproj': '<Project />',
            'Hello/function.json': '{ "bindings": [ { "type": "queueTrigger", "direction": "in", "name": "item", "queueName": "items" } ] }',
            'Hello/index.js': 'module.exports = async () => {};'
        });

        expect(functions.Hello.bindings).toEqual([{ type: 'queueTrigger', direction: 'in', name: 'item', queueName: 'items' }]);
    });

    test('takes a function.json without bindings for a function without bindings', async () => {

        const log: string[] = [];
        const { functions } = await parse({
            'host.json': '{}',
            'NoBindings/function.json': '{ "disabled": true }',
            'NoBindings/index.js': 'module.exports = async () => {};',
            'NotJson/function.json': 'oops'
        }, { log });

        expect(functions).toEqual({
            NoBindings: { bindings: [], isCalledBy: [], isSignalledBy: [], filePath: 'NoBindings/index.js', pos: 0, lineNr: 1 }
        });

        expect(log[1]).toContain(`>>> Failed to parse <root>${path.sep}NotJson${path.sep}function.json`);
    });

    test('follows the scriptFile of a PowerShell function, but never out of the project', async () => {

        const activity = '{ "bindings": [ { "type": "activityTrigger", "direction": "in", "name": "input" } ]';

        const { functions } = await parse({
            'outside.ps1': 'Invoke-DurableActivity -FunctionName "Shared"',
            'app/host.json': '{}',
            'app/Orchestrator/function.json': '{ "bindings": [ { "type": "orchestrationTrigger", "direction": "in", "name": "Context" } ] }',
            'app/Orchestrator/run.ps1': 'Invoke-DurableActivity -FunctionName "Shared"\nInvoke-DurableActivity -FunctionName "Outside"',
            'app/Shared/function.json': `${activity}, "scriptFile": "../modules/shared-activity.ps1" }`,
            'app/modules/shared-activity.ps1': 'param($input)',
            'app/Outside/function.json': `${activity}, "scriptFile": "../../outside.ps1" }`
        }, { subFolder: 'app' });

        expect(functions.Shared.filePath).toBe('app/modules/shared-activity.ps1');
        expect(functions.Shared.isCalledBy).toEqual(['Orchestrator']);

        // Still an activity, and still called. Only its code, which is not this project's, was not read.
        expect(functions.Outside.filePath).toBeUndefined();
        expect(functions.Outside.isCalledBy).toEqual(['Orchestrator']);
    });

    test('warns about a proxies.json a C# project would not deploy, and not about one it would', async () => {

        const proxiesJson = '{ "proxies": { "Docs": { "matchCondition": { "route": "/docs" } } } }';

        const forgotten = await parse({ 'host.json': '{}', 'App.csproj': '<Project />', 'proxies.json': proxiesJson });
        expect(forgotten.proxies.Docs.warningNotAddedToCsProjFile).toBe(true);

        const listed = await parse({
            'host.json': '{}',
            'App.csproj': '<Project><ItemGroup><None Update="proxies.json"><CopyToOutputDirectory>Always</CopyToOutputDirectory></None></ItemGroup></Project>',
            'proxies.json': proxiesJson
        });
        expect(listed.proxies.Docs.warningNotAddedToCsProjFile).toBeUndefined();
        expect(listed.proxies.Docs).toEqual({ matchCondition: { route: '/docs' }, filePath: 'proxies.json', pos: 15, lineNr: 1 });
    });

    test('has no proxies when proxies.json is not what it should be', async () => {

        const log: string[] = [];

        expect((await parse({ 'host.json': '{}', 'proxies.json': '{ "proxies": ' }, { log })).proxies).toEqual({});
        expect(log[1]).toContain('>>> Failed to parse');

        expect((await parse({ 'host.json': '{}', 'proxies.json': '{ }' })).proxies).toEqual({});
        expect((await parse({ 'host.json': '{}', 'proxies.json': '{ "proxies": "none" }' })).proxies).toEqual({});
    });
});
