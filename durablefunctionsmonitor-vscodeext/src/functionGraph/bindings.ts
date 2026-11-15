// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { getCodeInBrackets } from './codeText';
import type { Dialect } from './dialects';
import type { FunctionBinding } from './traversal';

// What is known about one attribute when it is turned into a binding
type AttributeContext = {
    // The attribute's name, without 'Attribute' at the end
    name: string;
    // The attribute's arguments, brackets included
    code: string;
    // [return: Blob(...)]
    isReturn: boolean;
    // [Blob(...)] out string blob, [Queue(...)] ICollector<string> messages
    isOut: boolean;
};

type BindingFactory = (attribute: AttributeContext) => FunctionBinding[];

// The first thing that looks like a value: "my-queue", nameof(MyQueue), MyConstants.QueueName
const singleParamRegex = /("|nameof\s*\()?([\w.-]+)/;
// The first string literal
const firstStringRegex = /"([^"]+)"/;
// The first two string literals
const twoStringsRegex = /"([^"]+)"(.|\r|\n)+?"([^"]+)"/;

const httpTriggerRouteRegex = /Route\s*=\s*"(.*)"/;
const anonymousLevelRegex = /level.anonymous/i;
const httpMethods = ['get', 'head', 'post', 'put', 'delete', 'connect', 'options', 'trace', 'patch'];

// What follows the arguments of an attribute, when the parameter it is on is an output:
//     [Blob("out/{name}")] out string blob         [Queue("orders")] IAsyncCollector<Order> orders
// Sticky, so that it only ever looks at the one place it is pointed at.
const outputParameterRegex = /\s*\]\s*(out\s|ICollector|IAsyncCollector)/y;

// Attributes that are an input or an output depending on the parameter they are on (the in-process model).
// The ones named ...Input and ...Output (the isolated worker model, and Python) say it themselves.
function directionOf(attribute: AttributeContext, ambiguousName: string): string {

    if (attribute.name === ambiguousName) {
        return attribute.isReturn || attribute.isOut ? 'out' : 'in';
    }

    return attribute.name.toLowerCase().endsWith('output') ? 'out' : 'in';
}

// Makes a binding, and adds a property taken from the attribute's arguments, when it can be found there
function withParam(binding: FunctionBinding, attribute: AttributeContext, regex: RegExp, properties: { [name: string]: number }): FunctionBinding[] {

    const match = regex.exec(attribute.code);
    if (match) {
        for (const name in properties) {
            binding[name] = match[properties[name]];
        }
    }

    return [binding];
}

const blob: BindingFactory = a => withParam({ type: 'blob', direction: directionOf(a, 'Blob') }, a, firstStringRegex, { path: 1 });
const blobTrigger: BindingFactory = a => withParam({ type: 'blobTrigger' }, a, firstStringRegex, { path: 1 });
const table: BindingFactory = a => withParam({ type: 'table', direction: directionOf(a, 'Table') }, a, singleParamRegex, { tableName: 2 });
const cosmosDb: BindingFactory = a => withParam({ type: 'cosmosDB', direction: directionOf(a, 'CosmosDB') }, a, twoStringsRegex, { databaseName: 1, collectionName: 3 });
const cosmosDbTrigger: BindingFactory = a => withParam({ type: 'cosmosDBTrigger' }, a, singleParamRegex, { databaseName: 2 });
const eventGrid: BindingFactory = a => withParam({ type: 'eventGrid', direction: 'out' }, a, twoStringsRegex, { topicEndpointUri: 1, topicKeySetting: 3 });
const eventGridTrigger: BindingFactory = a => withParam({ type: 'eventGridTrigger' }, a, twoStringsRegex, { topicEndpointUri: 1, topicKeySetting: 3 });
const eventHub: BindingFactory = a => withParam({ type: 'eventHub', direction: 'out' }, a, firstStringRegex, { eventHubName: 1 });
const eventHubTrigger: BindingFactory = a => withParam({ type: 'eventHubTrigger' }, a, firstStringRegex, { eventHubName: 1 });
const kafka: BindingFactory = a => withParam({ type: 'kafka', direction: 'out' }, a, singleParamRegex, { brokerList: 2 });
const kafkaTrigger: BindingFactory = a => withParam({ type: 'kafkaTrigger' }, a, singleParamRegex, { brokerList: 2 });
const queue: BindingFactory = a => withParam({ type: 'queue', direction: 'out' }, a, singleParamRegex, { queueName: 2 });
const queueTrigger: BindingFactory = a => withParam({ type: 'queueTrigger' }, a, singleParamRegex, { queueName: 2 });
const serviceBus: BindingFactory = a => withParam({ type: 'serviceBus', direction: 'out' }, a, singleParamRegex, { queueName: 2 });
const serviceBusTrigger: BindingFactory = a => withParam({ type: 'serviceBusTrigger' }, a, singleParamRegex, { queueName: 2 });
const signalRConnectionInfo: BindingFactory = a => withParam({ type: 'signalRConnectionInfo', direction: 'in' }, a, firstStringRegex, { hubName: 1 });
const signalR: BindingFactory = a => withParam({ type: 'signalR', direction: 'out' }, a, firstStringRegex, { hubName: 1 });
const signalRTrigger: BindingFactory = a => withParam({ type: 'signalRTrigger' }, a, firstStringRegex, { hubName: 1 });
const rabbitMq: BindingFactory = a => withParam({ type: 'rabbitMQ', direction: 'out' }, a, firstStringRegex, { queueName: 1 });
const rabbitMqTrigger: BindingFactory = a => withParam({ type: 'rabbitMQTrigger' }, a, firstStringRegex, { queueName: 1 });
const timerTrigger: BindingFactory = a => withParam({ type: 'timerTrigger' }, a, singleParamRegex, { schedule: 2 });

const sendGrid: BindingFactory = () => [{ type: 'sendGrid', direction: 'out' }];
const twilioSms: BindingFactory = () => [{ type: 'twilioSms', direction: 'out' }];
const orchestrationTrigger: BindingFactory = () => [{ type: 'orchestrationTrigger', direction: 'in' }];
const activityTrigger: BindingFactory = () => [{ type: 'activityTrigger', direction: 'in' }];
const entityTrigger: BindingFactory = () => [{ type: 'entityTrigger', direction: 'in' }];
const durableClient: BindingFactory = () => [{ type: 'durableClient', direction: 'in' }];

// An HTTP trigger comes with the response it returns
const httpTrigger: BindingFactory = attribute => {

    const binding: FunctionBinding = { type: 'httpTrigger', methods: [] };

    const routeMatch = httpTriggerRouteRegex.exec(attribute.code);
    if (routeMatch) {
        binding.route = routeMatch[1];
    }

    const lowerCode = attribute.code.toLowerCase();
    for (const httpMethod of httpMethods) {

        if (lowerCode.includes(`"${httpMethod}"`)) {
            binding.methods.push(httpMethod);
        }
    }

    if (anonymousLevelRegex.test(attribute.code)) {
        binding.authLevel = 'anonymous';
    }

    return [binding, { type: 'http', direction: 'out' }];
};

// Every attribute (C#, F#, Java) and decorator (Python) that is known to be a binding. Anything else that looks
// like an attribute is left alone: guessing gives too many bindings that are not there.
const bindingFactories = new Map<string, BindingFactory>([

    ['Blob', blob], ['BlobInput', blob], ['BlobOutput', blob], ['read_blob', blob], ['blob_input', blob], ['blob_output', blob],
    ['BlobTrigger', blobTrigger], ['blob_trigger', blobTrigger],

    ['Table', table], ['TableInput', table], ['TableOutput', table], ['table_input', table], ['table_output', table],

    ['CosmosDB', cosmosDb], ['CosmosDBInput', cosmosDb], ['CosmosDBOutput', cosmosDb],
    ['CosmosDBTrigger', cosmosDbTrigger], ['cosmos_db_trigger', cosmosDbTrigger],

    ['EventGrid', eventGrid], ['EventGridOutput', eventGrid], ['event_grid_output', eventGrid],
    ['EventGridTrigger', eventGridTrigger],

    ['EventHub', eventHub], ['EventHubOutput', eventHub], ['event_hub_output', eventHub],
    ['EventHubTrigger', eventHubTrigger], ['event_hub_message_trigger', eventHubTrigger],

    ['Kafka', kafka], ['KafkaOutput', kafka],
    ['KafkaTrigger', kafkaTrigger],

    ['Queue', queue], ['QueueOutput', queue], ['queue_output', queue],
    ['QueueTrigger', queueTrigger], ['queue_trigger', queueTrigger],

    ['ServiceBus', serviceBus], ['ServiceBusOutput', serviceBus], ['service_bus_queue_output', serviceBus], ['service_bus_topic_output', serviceBus],
    ['ServiceBusTrigger', serviceBusTrigger], ['ServiceBusQueueTrigger', serviceBusTrigger], ['ServiceBusTopicTrigger', serviceBusTrigger],
    ['service_bus_queue_trigger', serviceBusTrigger], ['service_bus_topic_trigger', serviceBusTrigger],

    ['SignalRConnectionInfo', signalRConnectionInfo], ['SignalRConnectionInfoInput', signalRConnectionInfo],
    ['SignalR', signalR], ['SignalROutput', signalR],
    ['SignalRTrigger', signalRTrigger],

    ['RabbitMQ', rabbitMq], ['RabbitMQOutput', rabbitMq],
    ['RabbitMQTrigger', rabbitMqTrigger],

    ['SendGrid', sendGrid], ['SendGridOutput', sendGrid],
    ['TwilioSms', twilioSms],

    ['HttpTrigger', httpTrigger], ['route', httpTrigger],

    ['OrchestrationTrigger', orchestrationTrigger], ['DurableOrchestrationTrigger', orchestrationTrigger], ['orchestration_trigger', orchestrationTrigger],
    ['ActivityTrigger', activityTrigger], ['DurableActivityTrigger', activityTrigger], ['activity_trigger', activityTrigger],
    ['EntityTrigger', entityTrigger], ['DurableEntityTrigger', entityTrigger],

    ['TimerTrigger', timerTrigger], ['schedule', timerTrigger],

    ['OrchestrationClient', durableClient], ['DurableClient', durableClient], ['DurableClientInput', durableClient]
]);

const attributeSuffix = 'Attribute';

// Reads the bindings of a function off the attributes of its declaration
export function extractBindings(declarationCode: string, dialect: Dialect): FunctionBinding[] {

    const result: FunctionBinding[] = [];

    if (!declarationCode) {
        return result;
    }

    const { regex, group, returnGroup } = dialect.bindingAttribute();

    let match: RegExpExecArray | null;
    while ((match = regex.exec(declarationCode))) {

        let name = match[group];
        if (name.endsWith(attributeSuffix)) {
            name = name.substring(0, name.length - attributeSuffix.length);
        }

        const factory = bindingFactories.get(name);
        if (!factory) {
            continue;
        }

        const codeStart = match.index + match[0].length;
        const code = getCodeInBrackets(declarationCode, codeStart, '(', ')').code;

        outputParameterRegex.lastIndex = codeStart + code.length;

        result.push(...factory({
            name,
            code,
            isReturn: returnGroup !== undefined && match[returnGroup] === 'return:',
            isOut: outputParameterRegex.test(declarationCode)
        }));
    }

    return result;
}
