// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Small Azure Functions projects, one per programming model the function graph understands. They are kept here
// as text and written to a temporary folder by the tests, so that nothing about them depends on how git checks
// files out (line endings move every position in a file) or on what .gitignore hides (bin, obj, local.settings.json).

export type ProjectFilesContent = { [relativePath: string]: string };

// Writes a project into a new temporary folder and returns that folder
export function writeProject(files: ProjectFilesContent, lineBreak: '\n' | '\r\n' = '\n'): string {

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-graph-'));

    for (const relativePath in files) {

        const filePath = path.join(folder, ...relativePath.split('/'));

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, lineBreak === '\n' ? files[relativePath] : files[relativePath].replace(/\n/g, lineBreak));
    }

    return folder;
}

export function removeProject(folder: string): void {

    fs.rmSync(folder, { recursive: true, force: true });
}

const hostJson = `{
    "version": "2.0"
}
`;

// The isolated worker model: [Function], the Durable Task client, output bindings on the properties of a return type
export const cSharpIsolatedProject: ProjectFilesContent = {

    'host.json': hostJson,

    'MyApp.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
  </PropertyGroup>
</Project>
`,

    'Functions/Starters.cs': `using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;

namespace MyApp;

public class Starters
{
    [Function("HttpStart")]
    public async Task<HttpResponseData> HttpStart(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "orders/{id}")] HttpRequestData req,
        [DurableClient] DurableTaskClient client)
    {
        string instanceId = await client.ScheduleNewOrchestrationInstanceAsync(nameof(Orchestrators.ProcessOrder), null);

        return req.CreateResponse();
    }

    [Function(nameof(TimerStart))]
    public async Task TimerStart([TimerTrigger("0 */5 * * * *")] TimerInfo timer, [DurableClient] DurableTaskClient client)
    {
        await client.ScheduleNewOrchestrationInstanceAsync("Cleanup");
    }

    [Function("Approve")]
    public async Task<HttpResponseData> Approve(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req,
        [DurableClient] DurableTaskClient client)
    {
        await client.RaiseEventAsync("some-id", "Approval", true);
        await client.Entities.SignalEntityAsync(new EntityInstanceId(nameof(Counter), "key"), "add");

        return req.CreateResponse();
    }

    [Function("QueueToMany")]
    public MultiOutput QueueToMany([QueueTrigger("incoming-orders", Connection = "Storage")] string message)
    {
        return new MultiOutput { Processed = message, Archived = message };
    }
}

public class MultiOutput
{
    [QueueOutput("processed-orders")]
    public string Processed { get; set; }

    [BlobOutput("archive/{rand-guid}.json")]
    public string Archived { get; set; }
}
`,

    'Functions/Orchestrators.cs': `using Microsoft.Azure.Functions.Worker;
using Microsoft.DurableTask;

namespace MyApp;

public static class Orchestrators
{
    [Function(nameof(ProcessOrder))]
    public static async Task<string> ProcessOrder([OrchestrationTrigger] TaskOrchestrationContext context)
    {
        var order = await context.CallActivityAsync<string>(nameof(Activities.ValidateOrder), "x");

        await context.CallActivityAsync("ChargeCard", order);
        await context.CallSubOrchestratorAsync(nameof(ShipOrder), order);

        bool approved = await context.WaitForExternalEvent<bool>("Approval");

        return order;
    }

    [Function(nameof(ShipOrder))]
    public static async Task ShipOrder([OrchestrationTrigger] TaskOrchestrationContext context)
    {
        await context.CallActivityAsync(nameof(Activities.ValidateOrder), "y");
    }

    [Function("Cleanup")]
    public static async Task Cleanup([OrchestrationTrigger] TaskOrchestrationContext context)
    {
        await context.CreateTimer(context.CurrentUtcDateTime.AddHours(1), CancellationToken.None);

        context.ContinueAsNew(null);
    }
}
`,

    'Functions/Activities.cs': `using Microsoft.Azure.Functions.Worker;

namespace MyApp;

public static class Activities
{
    [Function(nameof(ValidateOrder))]
    public static string ValidateOrder([ActivityTrigger] string order)
    {
        return order;
    }

    [Function("ChargeCard")]
    public static string ChargeCard([ActivityTrigger] string order, FunctionContext executionContext)
    {
        return order;
    }

    [Function(nameof(Counter))]
    public static Task Counter([EntityTrigger] TaskEntityDispatcher dispatcher)
    {
        return dispatcher.DispatchAsync(operation =>
        {
            return default;
        });
    }
}
`
};

// The in-process model: [FunctionName], bindings whose direction is the parameter's, proxies
export const cSharpInProcessProject: ProjectFilesContent = {

    'host.json': hostJson,

    'Legacy.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <None Update="host.json">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>
</Project>
`,

    'proxies.json': `{
    "$schema": "http://json.schemastore.org/proxies",
    "proxies": {
        "ToBackend": {
            "matchCondition": {
                "methods": [ "GET" ],
                "route": "/api/legacy/{*rest}"
            },
            "backendUri": "https://example.org/{rest}"
        },
        "Docs": {
            "matchCondition": {
                "route": "/docs"
            },
            "backendUri": "https://example.org/docs"
        }
    }
}
`,

    'Functions.cs': `using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.DurableTask;

namespace Legacy
{
    public static class Functions
    {
        [FunctionName("Starter")]
        public static async Task Starter(
            [ServiceBusTrigger("incoming", Connection = "ServiceBus")] string message,
            [DurableClient] IDurableOrchestrationClient starter)
        {
            await starter.StartNewAsync("MainOrchestrator", null, message);
        }

        [FunctionName("MainOrchestrator")]
        public static async Task<string> MainOrchestrator([OrchestrationTrigger] IDurableOrchestrationContext context)
        {
            string result = await context.CallActivityWithRetryAsync<string>("Transform", new RetryOptions(TimeSpan.FromSeconds(5), 3), "x");

            await context.CallSubOrchestratorWithRetryAsync("Notify", new RetryOptions(TimeSpan.FromSeconds(5), 3), result);
            await context.WaitForExternalEvent("Go");

            return result;
        }

        [FunctionName("Notify")]
        public static async Task Notify([OrchestrationTrigger] IDurableOrchestrationContext context)
        {
            await context.CallActivityAsync("Transform", "y");
        }

        [FunctionName("Transform")]
        [return: Queue("transformed")]
        public static string Transform(
            [ActivityTrigger] string input,
            [Blob("templates/default.txt")] string template,
            [Table("Lookups")] CloudTable lookups)
        {
            return input;
        }

        [FunctionName("EventsIn")]
        public static async Task EventsIn(
            [EventHubTrigger("telemetry", Connection = "EventHub")] EventData[] events,
            [CosmosDB("telemetry-db", "readings", ConnectionStringSetting = "Cosmos")] IAsyncCollector<object> readings,
            [SignalR(HubName = "dashboard")] IAsyncCollector<SignalRMessage> signalRMessages,
            [DurableClient] IDurableOrchestrationClient client)
        {
            await client.RaiseEventAsync("some-id", "Go");
        }

        [FunctionName("Digest")]
        public static void Digest(
            [TimerTrigger("0 0 8 * * *")] TimerInfo timer,
            [SendGrid(ApiKey = "SendGridKey")] out SendGridMessage message)
        {
            message = new SendGridMessage();
        }
    }
}
`
};

export const fSharpProject: ProjectFilesContent = {

    'host.json': hostJson,

    'App.fsproj': `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <Compile Include="Functions.fs" />
  </ItemGroup>
</Project>
`,

    'Functions.fs': `module Functions

open Microsoft.Azure.WebJobs
open Microsoft.Azure.WebJobs.Extensions.DurableTask

[<FunctionName("HttpStart")>]
let httpStart ([<HttpTrigger(AuthorizationLevel.Anonymous, "post")>] req: HttpRequestMessage, [<DurableClient>] starter: IDurableOrchestrationClient) =
    task {
        let! instanceId = starter.StartNewAsync("Orchestrator", null)
        return starter.CreateCheckStatusResponse(req, instanceId)
    }

[<FunctionName("Orchestrator")>]
let orchestrator ([<OrchestrationTrigger>] context: IDurableOrchestrationContext) =
    task {
        let! greeting = context.CallActivityAsync<string>("SayHello", "Tokyo")
        return greeting
    }

[<FunctionName("SayHello")>]
let sayHello ([<ActivityTrigger>] name: string) =
    task {
        return sprintf "Hello %s" name
    }
`
};

export const javaProject: ProjectFilesContent = {

    'host.json': hostJson,

    'pom.xml': `<project>
  <modelVersion>4.0.0</modelVersion>
</project>
`,

    'src/main/java/com/example/Functions.java': `package com.example;

import com.microsoft.azure.functions.annotation.*;
import com.microsoft.durabletask.azurefunctions.*;

public class Functions {

    @FunctionName("HttpStart")
    public HttpResponseMessage httpStart(
            @HttpTrigger(name = "req", methods = {HttpMethod.GET, HttpMethod.POST}, authLevel = AuthorizationLevel.ANONYMOUS) HttpRequestMessage<Optional<String>> request,
            @DurableClientInput(name = "durableContext") DurableClientContext durableContext,
            final ExecutionContext context) {

        DurableTaskClient client = durableContext.getClient();
        String instanceId = client.scheduleNewOrchestrationInstance("Cities");

        return durableContext.createCheckStatusResponse(request, instanceId);
    }

    @FunctionName("Cities")
    public String citiesOrchestrator(
            @DurableOrchestrationTrigger(name = "ctx") TaskOrchestrationContext ctx) {

        String result = ctx.callActivity("Capitalize", "Tokyo", String.class).await();

        return result;
    }

    @FunctionName("Capitalize")
    public String capitalize(@DurableActivityTrigger(name = "name") String name, final ExecutionContext context) {

        return name.toUpperCase();
    }
}
`
};

// The Python v2 model: decorators, and no function.json
export const pythonV2Project: ProjectFilesContent = {

    'host.json': hostJson,

    'requirements.txt': `azure-functions
azure-functions-durable
`,

    'function_app.py': `import azure.functions as func
import azure.durable_functions as df

myApp = df.DFApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@myApp.route(route="orchestrators/{functionName}")
@myApp.durable_client_input(client_name="client")
async def http_start(req: func.HttpRequest, client):
    instance_id = await client.start_new("hello_orchestrator")
    return client.create_check_status_response(req, instance_id)

@myApp.orchestration_trigger(context_name="context")
def hello_orchestrator(context):
    result1 = yield context.call_activity("hello", "Seattle")
    approved = yield context.wait_for_external_event("Approval")
    return [result1]

@myApp.activity_trigger(input_name="city")
def hello(city: str):
    return f"Hello {city}"

@myApp.function_name(name="QueueWorker")
@myApp.queue_trigger(arg_name="msg", queue_name="work-items", connection="AzureWebJobsStorage")
@myApp.blob_output(arg_name="outputblob", path="out/{rand-guid}.txt", connection="AzureWebJobsStorage")
def queue_worker(msg: func.QueueMessage, outputblob: func.Out[str]):
    outputblob.set(msg.get_body().decode())

@myApp.schedule(schedule="0 */5 * * * *", arg_name="timer")
@myApp.durable_client_input(client_name="client")
async def raise_approval(timer, client):
    await client.raise_event("some-id", "Approval", True)
`
};

export const powershellProject: ProjectFilesContent = {

    'host.json': hostJson,

    'profile.ps1': `# Runs on every cold start
`,

    'HttpStart/function.json': `{
    "bindings": [
        { "authLevel": "anonymous", "name": "Request", "type": "httpTrigger", "direction": "in", "methods": [ "post" ] },
        { "type": "http", "direction": "out", "name": "Response" },
        { "name": "starter", "type": "durableClient", "direction": "in" }
    ]
}
`,
    'HttpStart/run.ps1': `param($Request, $TriggerMetadata)

$InstanceId = Start-DurableOrchestration -FunctionName "Orchestrator" -Input $Request.Body
Push-OutputBinding -Name Response -Value (New-DurableCheckStatusResponse -Request $Request -InstanceId $InstanceId)
`,

    'Orchestrator/function.json': `{
    "bindings": [
        { "name": "Context", "type": "orchestrationTrigger", "direction": "in" }
    ]
}
`,
    'Orchestrator/run.ps1': `param($Context)

$output = @()
$output += Invoke-DurableActivity -FunctionName 'Hello' -Input 'Tokyo'
$approved = Start-DurableExternalEventListener -EventName "Approval"

$output
`,

    'Hello/function.json': `{
    "scriptFile": "say-hello.ps1",
    "bindings": [
        { "name": "name", "type": "activityTrigger", "direction": "in" }
    ]
}
`,
    'Hello/say-hello.ps1': `param($name)

"Hello $name!"
`,

    'Approver/function.json': `{
    "bindings": [
        { "authLevel": "function", "name": "Request", "type": "httpTrigger", "direction": "in", "methods": [ "post" ] },
        { "type": "http", "direction": "out", "name": "Response" },
        { "name": "starter", "type": "durableClient", "direction": "in" }
    ]
}
`,
    'Approver/run.ps1': `param($Request)

Send-DurableExternalEvent -InstanceId $Request.Query.id -EventName "Approval"
`
};

// The function.json model with JavaScript and TypeScript: a folder per function, the code in its index file
export const scriptProject: ProjectFilesContent = {

    'host.json': hostJson,

    'package.json': `{ "name": "script-app" }
`,

    'proxies.json': `{
    "proxies": {
        "Health": {
            "matchCondition": { "route": "/health" },
            "backendUri": "https://example.org/health"
        }
    }
}
`,

    'HttpStart/function.json': `{
    "bindings": [
        { "authLevel": "anonymous", "name": "req", "type": "httpTrigger", "direction": "in", "route": "start/{functionName}", "methods": [ "post" ] },
        { "name": "$return", "type": "http", "direction": "out" },
        { "name": "starter", "type": "durableClient", "direction": "in" }
    ]
}
`,
    'HttpStart/index.js': `const df = require("durable-functions");

module.exports = async function (context, req) {
    const client = df.getClient(context);
    const instanceId = await client.startNew("Orchestrator", undefined, req.body);

    return client.createCheckStatusResponse(context.bindingData.req, instanceId);
};
`,

    'Orchestrator/function.json': `{
    "bindings": [
        { "name": "context", "type": "orchestrationTrigger", "direction": "in" }
    ]
}
`,
    'Orchestrator/index.js': `const df = require("durable-functions");

module.exports = df.orchestrator(function* (context) {
    const outputs = [];

    outputs.push(yield context.df.callActivity("Hello", "Tokyo"));
    outputs.push(yield context.df.callSubOrchestrator("SubOrchestrator", "x"));

    const approved = yield context.df.waitForExternalEvent("Approval");
    if (!approved) {
        context.df.continueAsNew(undefined);
    }

    return outputs;
});
`,

    'SubOrchestrator/function.json': `{
    "bindings": [
        { "name": "context", "type": "orchestrationTrigger", "direction": "in" }
    ]
}
`,
    'SubOrchestrator/index.ts': `import * as df from "durable-functions";

const orchestrator = df.orchestrator(function* (context) {
    return yield context.df.callActivity("Hello", "London");
});

export default orchestrator;
`,

    'Hello/function.json': `{
    "bindings": [
        { "name": "name", "type": "activityTrigger", "direction": "in" },
        { "name": "outputQueue", "type": "queue", "direction": "out", "queueName": "greetings", "connection": "AzureWebJobsStorage" }
    ]
}
`,
    'Hello/index.js': `module.exports = async function (context) {
    return \`Hello \${context.bindings.name}!\`;
};
`,

    'Counter/function.json': `{
    "bindings": [
        { "name": "context", "type": "entityTrigger", "direction": "in" }
    ]
}
`,
    'Counter/index.js': `const df = require("durable-functions");

module.exports = df.entity(function (context) {
    context.df.setState((context.df.getState(() => 0)) + 1);
});
`,

    'Signaler/function.json': `{
    "bindings": [
        { "name": "myTimer", "type": "timerTrigger", "direction": "in", "schedule": "0 */5 * * * *" },
        { "name": "starter", "type": "durableClient", "direction": "in" }
    ]
}
`,
    'Signaler/index.js': `const df = require("durable-functions");

module.exports = async function (context, myTimer) {
    const client = df.getClient(context);

    await client.signalEntity(new df.EntityId("Counter", "visits"), "add");
    await client.raiseEvent("some-id", "Approval", true);
};
`,

    // Not functions: a folder without function.json, and one whose function.json cannot be read
    'shared/helpers.js': `module.exports = {};
`,
    'Broken/function.json': `{ "bindings": [ `
};
