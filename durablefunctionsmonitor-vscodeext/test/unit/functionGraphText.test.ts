// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { extractBindings } from '../../src/functionGraph/bindings';
import { cleanupFunctionName, escapeRegExp, getCodeInBrackets, posToLineNr, removeNamespace } from '../../src/functionGraph/codeText';
import { defaultDialect, powershellDialect, pythonDialect } from '../../src/functionGraph/dialects';
import { ProjectFiles, isExcludedFolder } from '../../src/functionGraph/projectFiles';
import { removeProject, writeProject } from './helpers/functionProjects';

describe('posToLineNr', () => {

    test('counts lines from one, whatever the line break is', () => {

        expect(posToLineNr('abc', 0)).toBe(1);
        expect(posToLineNr('a\nb\nc', 0)).toBe(1);
        expect(posToLineNr('a\nb\nc', 2)).toBe(2);
        expect(posToLineNr('a\nb\nc', 4)).toBe(3);
        expect(posToLineNr('a\r\nb\r\nc', 3)).toBe(2);
        expect(posToLineNr('a\r\nb\r\nc', 6)).toBe(3);
        expect(posToLineNr('a\rb\rc', 4)).toBe(3);
        expect(posToLineNr('a\n\n\nb', 4)).toBe(4);
    });

    test('takes a position inside a line break for the end of the line before it', () => {

        // Between \r and \n: the \r has gone by, the \n has not
        expect(posToLineNr('a\r\nb', 2)).toBe(2);
        expect(posToLineNr('a\r\nb', 3)).toBe(2);
    });

    test('has no line for no code, and does not mind a position past the end', () => {

        expect(posToLineNr('', 0)).toBe(0);
        expect(posToLineNr(undefined, 5)).toBe(0);
        expect(posToLineNr('a\nb', 100)).toBe(2);
        expect(posToLineNr('a\nb', -1)).toBe(1);
    });
});

describe('cleanupFunctionName', () => {

    test.each([
        ['"MyFunc"', 'MyFunc'],
        ['  "MyFunc"  ', 'MyFunc'],
        ['"my-func.v2"', 'my-func.v2'],
        ['nameof(MyFunc)', 'MyFunc'],
        ['nameof( MyClass.MyFunc )', 'MyFunc'],
        ['Constants.Names.MyFunc', 'MyFunc'],
        ['MyFunc', 'MyFunc'],
        ['', '']
    ])('%s is %s', (code, name) => {

        expect(cleanupFunctionName(code)).toBe(name);
    });

    test('removeNamespace keeps what follows the last dot', () => {

        expect(removeNamespace('A.B.C')).toBe('C');
        expect(removeNamespace(' C ')).toBe('C');
        expect(removeNamespace('A.')).toBe('');
    });
});

describe('escapeRegExp', () => {

    test('makes any text match itself and nothing else', () => {

        const text = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';

        expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
        expect(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb')).toBe(false);
        expect(escapeRegExp('plain-name_1')).toBe('plain-name_1');
    });
});

describe('getCodeInBrackets', () => {

    test('returns everything up to the end of the first block', () => {

        const code = 'void Run() { if (x) { y(); } } void Other() { }';

        expect(getCodeInBrackets(code, 0, '{', '}')).toEqual({ code: 'void Run() { if (x) { y(); } }', openBracketPos: 11 });
    });

    test('counts from where it is told to', () => {

        const code = 'a { b } c { d }';

        expect(getCodeInBrackets(code, 7, '{', '}')).toEqual({ code: ' c { d }', openBracketPos: 3 });
    });

    test('skips the blocks that do not have the symbol it must have, which is how a body is told from a route', () => {

        const code = '[HttpTrigger("get", Route = "items/{id}")] HttpRequestData req)\n{\n    return x;\n}\nrest';

        const result = getCodeInBrackets(code, 0, '{', '}', '\n');

        expect(result.code).toBe('[HttpTrigger("get", Route = "items/{id}")] HttpRequestData req)\n{\n    return x;\n}');
        expect(code[result.openBracketPos]).toBe('{');
        expect(code.substring(0, result.openBracketPos)).toBe('[HttpTrigger("get", Route = "items/{id}")] HttpRequestData req)\n');
    });

    test('finds nothing when there is no block, or it never ends', () => {

        expect(getCodeInBrackets('=> x;', 0, '{', '}', '\n')).toEqual({ code: '', openBracketPos: -1 });
        expect(getCodeInBrackets('{ { }', 0, '{', '}')).toEqual({ code: '', openBracketPos: -1 });
        expect(getCodeInBrackets('{ one line }', 0, '{', '}', '\n')).toEqual({ code: '', openBracketPos: -1 });
    });

    test('works with round brackets as well', () => {

        expect(getCodeInBrackets('[Queue("a", Connection = nameof(X))] string q', 6, '(', ')').code).toBe('("a", Connection = nameof(X))');
    });
});

describe('extractBindings', () => {

    const bindingsOf = (code: string) => extractBindings(code, defaultDialect);

    test('reads the triggers of the Durable Functions models', () => {

        expect(bindingsOf('[OrchestrationTrigger] TaskOrchestrationContext context')).toEqual([{ type: 'orchestrationTrigger', direction: 'in' }]);
        expect(bindingsOf('[ActivityTrigger] string input')).toEqual([{ type: 'activityTrigger', direction: 'in' }]);
        expect(bindingsOf('[EntityTrigger] TaskEntityDispatcher dispatcher')).toEqual([{ type: 'entityTrigger', direction: 'in' }]);
        expect(bindingsOf('@DurableOrchestrationTrigger(name = "ctx") TaskOrchestrationContext ctx')).toEqual([{ type: 'orchestrationTrigger', direction: 'in' }]);
        expect(bindingsOf('@DurableActivityTrigger(name = "name") String name')).toEqual([{ type: 'activityTrigger', direction: 'in' }]);
        expect(bindingsOf('[DurableClient] DurableTaskClient client')).toEqual([{ type: 'durableClient', direction: 'in' }]);
        expect(bindingsOf('[OrchestrationClient] DurableOrchestrationClient client')).toEqual([{ type: 'durableClient', direction: 'in' }]);
    });

    test('reads an HTTP trigger with its route, methods and level, and adds the response to it', () => {

        expect(bindingsOf('[HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "orders/{id}")] HttpRequestData req')).toEqual([
            { type: 'httpTrigger', methods: ['get', 'post'], route: 'orders/{id}', authLevel: 'anonymous' },
            { type: 'http', direction: 'out' }
        ]);

        expect(bindingsOf('[HttpTrigger(AuthorizationLevel.Function, "DELETE")] HttpRequestData req')).toEqual([
            { type: 'httpTrigger', methods: ['delete'] },
            { type: 'http', direction: 'out' }
        ]);
    });

    test('understands the attribute spelled in full, and the F# brackets', () => {

        expect(bindingsOf('[QueueTriggerAttribute("orders")] string order')).toEqual([{ type: 'queueTrigger', queueName: 'orders' }]);
        expect(bindingsOf('[<QueueTrigger("orders")>] order: string')).toEqual([{ type: 'queueTrigger', queueName: 'orders' }]);
    });

    test.each([
        ['[BlobTrigger("in/{name}")] Stream blob', { type: 'blobTrigger', path: 'in/{name}' }],
        ['[BlobInput("in/{name}")] string blob', { type: 'blob', direction: 'in', path: 'in/{name}' }],
        ['[BlobOutput("out/{name}")] string blob', { type: 'blob', direction: 'out', path: 'out/{name}' }],
        ['[TableInput("Orders")] TableClient table', { type: 'table', direction: 'in', tableName: 'Orders' }],
        ['[TableOutput(nameof(Orders))] Order order', { type: 'table', direction: 'out', tableName: 'Orders' }],
        ['[CosmosDBInput("db", "items")] Item item', { type: 'cosmosDB', direction: 'in', databaseName: 'db', collectionName: 'items' }],
        ['[CosmosDBOutput("db", "items")] Item item', { type: 'cosmosDB', direction: 'out', databaseName: 'db', collectionName: 'items' }],
        ['[CosmosDBTrigger("db", "items")] IReadOnlyList<Item> items', { type: 'cosmosDBTrigger', databaseName: 'db' }],
        ['[EventGridOutput(TopicEndpointUri = "Endpoint", TopicKeySetting = "Key")] object e', { type: 'eventGrid', direction: 'out', topicEndpointUri: 'Endpoint', topicKeySetting: 'Key' }],
        ['[EventGridTrigger] EventGridEvent e', { type: 'eventGridTrigger' }],
        ['[EventHubOutput("telemetry")] string e', { type: 'eventHub', direction: 'out', eventHubName: 'telemetry' }],
        ['[EventHubTrigger("telemetry", Connection = "Hub")] string[] events', { type: 'eventHubTrigger', eventHubName: 'telemetry' }],
        ['[KafkaOutput("broker:9092", "topic")] string e', { type: 'kafka', direction: 'out', brokerList: 'broker' }],
        ['[KafkaTrigger("broker", "topic")] string e', { type: 'kafkaTrigger', brokerList: 'broker' }],
        ['[QueueOutput("orders")] string order', { type: 'queue', direction: 'out', queueName: 'orders' }],
        ['[ServiceBusOutput("orders")] string order', { type: 'serviceBus', direction: 'out', queueName: 'orders' }],
        ['[ServiceBusTrigger("orders", Connection = "Bus")] string order', { type: 'serviceBusTrigger', queueName: 'orders' }],
        ['[SignalRConnectionInfoInput(HubName = "chat")] string info', { type: 'signalRConnectionInfo', direction: 'in', hubName: 'chat' }],
        ['[SignalROutput(HubName = "chat")] object message', { type: 'signalR', direction: 'out', hubName: 'chat' }],
        ['[SignalRTrigger("chat", "messages", "send")] object invocation', { type: 'signalRTrigger', hubName: 'chat' }],
        ['[RabbitMQOutput(QueueName = "orders")] string order', { type: 'rabbitMQ', direction: 'out', queueName: 'orders' }],
        ['[RabbitMQTrigger("orders")] string order', { type: 'rabbitMQTrigger', queueName: 'orders' }],
        ['[SendGridOutput(ApiKey = "Key")] string message', { type: 'sendGrid', direction: 'out' }],
        ['[TwilioSms(AccountSidSetting = "Sid")] out CreateMessageOptions message', { type: 'twilioSms', direction: 'out' }]
    ])('%s', (code, binding) => {

        expect(bindingsOf(code)).toEqual([binding]);
    });

    test('takes a binding of the in-process model for an output when it is the return value or an output parameter', () => {

        expect(bindingsOf('[Blob("a")] string blob')).toEqual([{ type: 'blob', direction: 'in', path: 'a' }]);
        expect(bindingsOf('[return: Blob("a")]')).toEqual([{ type: 'blob', direction: 'out', path: 'a' }]);
        expect(bindingsOf('[Blob("a")] out string blob')).toEqual([{ type: 'blob', direction: 'out', path: 'a' }]);
        expect(bindingsOf('[Table("T")]\n    ICollector<Row> rows')).toEqual([{ type: 'table', direction: 'out', tableName: 'T' }]);
        expect(bindingsOf('[CosmosDB("db", "items")] IAsyncCollector<Item> items')).toEqual([{ type: 'cosmosDB', direction: 'out', databaseName: 'db', collectionName: 'items' }]);

        // An output further down the parameter list says nothing about this one
        expect(bindingsOf('[Blob("a")] string blob, [Queue("q")] out string message')).toEqual([
            { type: 'blob', direction: 'in', path: 'a' },
            { type: 'queue', direction: 'out', queueName: 'q' }
        ]);
    });

    test('leaves alone what is not known to be a binding', () => {

        expect(bindingsOf('[Function("MyFunc")] [FromBody] Order order, [SomethingElse(1)] int x, items[0]')).toEqual([]);
        expect(bindingsOf('')).toEqual([]);
    });

    test('reads the decorators of the Python v2 model', () => {

        const code = `@app.route(route="orders", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
@app.durable_client_input(client_name="client")
@app.queue_output(arg_name="msg", queue_name="out", connection="Storage")
`;

        expect(extractBindings(code, pythonDialect)).toEqual([
            { type: 'httpTrigger', methods: ['post'], authLevel: 'anonymous' },
            { type: 'http', direction: 'out' },
            // The first value of a decorator is taken for the name it is about, which here is the argument's
            { type: 'queue', direction: 'out', queueName: 'arg_name' }
        ]);

        expect(extractBindings('@app.orchestration_trigger(context_name="context")', pythonDialect)).toEqual([{ type: 'orchestrationTrigger', direction: 'in' }]);
        expect(extractBindings('@app.activity_trigger(input_name="city")', pythonDialect)).toEqual([{ type: 'activityTrigger', direction: 'in' }]);
    });
});

describe('dialects', () => {

    test.each([
        'await client.ScheduleNewOrchestrationInstanceAsync("MyOrch", input);',
        'await client.ScheduleNewOrchestrationInstanceAsync(nameof(MyOrch));',
        'await client.ScheduleNewOrchestrationInstanceAsync(nameof(Orchestrators.MyOrch), input);',
        'await starter.StartNewAsync<string>("MyOrch", input);',
        'await starter.StartNewAsync(Names.MyOrch, input);',
        'const id = await client.startNew("MyOrch");',
        "instance_id = await client.start_new('MyOrch')",
        'client.scheduleNewOrchestrationInstance("MyOrch");'
    ])('sees an orchestration being started in: %s', code => {

        expect(defaultDialect.startNewOrchestration('MyOrch').test(code)).toBe(true);
    });

    test.each([
        'await client.ScheduleNewOrchestrationInstanceAsync("MyOrchestration", input);',
        'await client.ScheduleNewOrchestrationInstanceAsync("OtherOrch");',
        'await client.GetInstanceAsync("MyOrch");'
    ])('does not see one in: %s', code => {

        expect(defaultDialect.startNewOrchestration('MyOrch').test(code)).toBe(false);
    });

    test('sees activities, sub-orchestrations, events and entities', () => {

        expect(defaultDialect.callActivity('Send').test('await context.CallActivityAsync<string>("Send", x);')).toBe(true);
        expect(defaultDialect.callActivity('Send').test('await context.CallActivityWithRetryAsync(nameof(Send), options, x);')).toBe(true);
        expect(defaultDialect.callActivity('Send').test('yield context.df.callActivity("Send", x)')).toBe(true);
        expect(defaultDialect.callActivity('Send').test('yield context.call_activity("Send", x)')).toBe(true);
        expect(defaultDialect.callActivity('Send').test('await context.CallActivityAsync("SendMore", x);')).toBe(false);

        expect(defaultDialect.callSubOrchestrator('Child').test('await context.CallSubOrchestratorAsync(nameof(Child), x);')).toBe(true);
        expect(defaultDialect.callSubOrchestrator('Child').test('await context.CallSubOrchestratorWithRetryAsync<int>("Child", options, x);')).toBe(true);
        expect(defaultDialect.callSubOrchestrator('Child').test('yield context.call_sub_orchestrator("Child", x)')).toBe(true);
        expect(defaultDialect.callSubOrchestrator('Child').test('await context.CallActivityAsync("Child", x);')).toBe(false);

        expect(defaultDialect.continueAsNew().test('context.ContinueAsNew(state);')).toBe(true);
        expect(defaultDialect.continueAsNew().test('context.df.continueAsNew (state)')).toBe(true);

        expect(defaultDialect.raiseEvent('Approval').test('await client.RaiseEventAsync(id, "Approval", true);')).toBe(true);
        expect(defaultDialect.raiseEvent('Approval').test('await client.raise_event(\n    id,\n    "Approval")')).toBe(true);
        expect(defaultDialect.raiseEvent('Approval').test('await client.TerminateAsync(id, "Approval");')).toBe(false);

        expect(defaultDialect.signalEntity('Counter').test('new EntityInstanceId(nameof(Counter), "key")')).toBe(false);
        expect(defaultDialect.signalEntity('Counter').test('new EntityId("Counter", "key")')).toBe(true);
        expect(defaultDialect.signalEntity('Counter').test('context.Entities.SignalEntityAsync<Counter>(id)')).toBe(true);
    });

    test('lists the events an orchestration waits for', () => {

        const { regex, group } = defaultDialect.waitForExternalEvent();

        const code = `var a = await context.WaitForExternalEvent<bool>("Approval");
var b = await context.WaitForExternalEvent<string>(nameof(Events.Rejected));
c = yield context.wait_for_external_event('Cancelled')`;

        expect([...code.matchAll(regex)].map(match => match[group])).toEqual(['Approval', 'Events.Rejected', 'Cancelled']);
    });

    test('reads the cmdlets of PowerShell', () => {

        expect(powershellDialect.startNewOrchestration('MyOrch').test('$id = Start-DurableOrchestration -FunctionName "MyOrch" -Input $x')).toBe(true);
        expect(powershellDialect.startNewOrchestration('MyOrch').test('$id = Start-NewOrchestration -FunctionName \'MyOrch\'')).toBe(true);
        expect(powershellDialect.startNewOrchestration('MyOrch').test('Start-DurableOrchestration -FunctionName "MyOrchestration"')).toBe(false);

        expect(powershellDialect.callActivity('Hello').test('Invoke-DurableActivity -FunctionName "Hello" -Input "x"')).toBe(true);
        expect(powershellDialect.callActivity('Hello').test('Invoke-ActivityFunction -FunctionName \'Hello\'')).toBe(true);

        expect(powershellDialect.raiseEvent('Go').test('Send-DurableExternalEvent -InstanceId $id -EventName "Go"')).toBe(true);

        const { regex, group } = powershellDialect.waitForExternalEvent();
        expect([...'Start-DurableExternalEventListener -EventName "Go"'.matchAll(regex)].map(match => match[group])).toEqual(['Go']);
    });

    test('reads the Python v2 way of starting an orchestration', () => {

        expect(pythonDialect.startNewOrchestration('hello').test('instance_id = await client.start_new("hello")')).toBe(true);
        expect(pythonDialect.startNewOrchestration('hello').test('instance_id = await client.start_new("hello_world")')).toBe(false);
    });
});

describe('ProjectFiles', () => {

    let folder: string | undefined;

    afterEach(() => {

        if (folder) {
            removeProject(folder);
            folder = undefined;
        }
    });

    test('lists a folder in one order on every file system: by name, ignoring case', async () => {

        folder = writeProject({ 'b.txt': '', 'A.txt': '', 'c/x.txt': '', 'B/x.txt': '', '_z.txt': '', 'a10.txt': '', 'a2.txt': '' });

        expect((await new ProjectFiles().list(folder)).map(entry => entry.name)).toEqual(['A.txt', 'a10.txt', 'a2.txt', 'B', 'b.txt', 'c', '_z.txt']);
    });

    test('reads every file once: a parse sees one state of the project', async () => {

        folder = writeProject({ 'a.cs': 'first' });
        const filePath = path.join(folder, 'a.cs');

        const files = new ProjectFiles();
        expect(await files.read(filePath)).toBe('first');

        fs.writeFileSync(filePath, 'second');

        expect(await files.read(filePath)).toBe('first');
        expect(await new ProjectFiles().read(filePath)).toBe('second');
    });

    test('looks through the files of a folder before its subfolders, and returns where the pattern matched', async () => {

        folder = writeProject({
            'a/deep.cs': 'class Target {}',
            'z.cs': 'namespace X { class Target {} }',
            'other.txt': 'class Target {}'
        });

        const match = await new ProjectFiles().findFile(folder, /\.cs$/i, /class\s+Target/);

        expect(match).toEqual({ filePath: path.join(folder, 'z.cs'), code: 'namespace X { class Target {} }', pos: 14, length: 12 });
    });

    test('finds the same file with a global pattern as with a plain one, time after time', async () => {

        folder = writeProject({ 'a.cs': 'x Target', 'b.cs': 'Target' });

        const files = new ProjectFiles();
        const pattern = /Target/g;

        expect((await files.findFile(folder, /\.cs$/i, pattern))?.pos).toBe(2);
        expect((await files.findFile(folder, /\.cs$/i, pattern))?.pos).toBe(2);
    });

    test('skips a file that cannot match, when told what a match must contain', async () => {

        folder = writeProject({ 'a.cs': 'class Other {}', 'b.cs': 'class Target {}' });

        const files = new ProjectFiles();

        expect((await files.findFile(folder, /\.cs$/i, /class\s+\w+/, 'Target'))?.filePath).toBe(path.join(folder, 'b.cs'));
        expect(await files.findFile(folder, /\.cs$/i, /class\s+\w+/, 'Missing')).toBeUndefined();
        expect(await files.findFile(folder, /\.fs$/i)).toBeUndefined();
    });

    test('walks a tree in listing order, a subfolder at its own place, and stays out of the excluded folders', async () => {

        folder = writeProject({
            'b.cs': '', 'a/2.cs': '', 'a/1.cs': '', 'a/b/c.cs': '', 'c.txt': '', 'obj/x.cs': '', 'a/node_modules/y.cs': '', 'd/e.cs': ''
        });

        const found = await new ProjectFiles().findFiles(folder, /\.cs$/i);

        expect(found.map(filePath => path.relative(folder!, filePath).split(path.sep).join('/'))).toEqual(['a/1.cs', 'a/2.cs', 'a/b/c.cs', 'b.cs', 'd/e.cs']);
    });

    test('knows the folders that never hold source code, in any case', () => {

        for (const name of ['node_modules', 'bin', 'OBJ', 'Target', '.git', '.vs', '.vscode', '.github', '.env', '.python_packages']) {
            expect(isExcludedFolder(name), name).toBe(true);
        }

        for (const name of ['src', 'binaries', 'objects', 'git']) {
            expect(isExcludedFolder(name), name).toBe(false);
        }
    });
});
