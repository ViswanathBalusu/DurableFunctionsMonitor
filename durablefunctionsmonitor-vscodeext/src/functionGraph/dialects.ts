// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { escapeRegExp } from './codeText';

// A pattern, and the number of the group in it that holds the value being looked for
export type PatternAndGroup = { regex: RegExp, group: number };

// How a language spells the Durable Functions calls that connect one function to another.
// Each pattern is matched against the source code of a function, to tell whether it mentions another one.
export type Dialect = {
    // An orchestration being started by name
    startNewOrchestration(orchestratorName: string): RegExp;
    // A sub-orchestration being called by name
    callSubOrchestrator(orchestratorName: string): RegExp;
    // An activity being called by name
    callActivity(activityName: string): RegExp;
    // An orchestration restarting itself
    continueAsNew(): RegExp;
    // An orchestration waiting for an event. Global: one match per event, the group being the event's name.
    waitForExternalEvent(): PatternAndGroup;
    // An event being raised by name
    raiseEvent(eventName: string): RegExp;
    // An entity being mentioned by name
    signalEntity(entityName: string): RegExp;
    // An attribute (a decorator, in Python) that may be a binding. Global, the group being the attribute's name.
    // 'returnGroup', where the language has it, is the group that holds 'return:'.
    bindingAttribute(): PatternAndGroup & { returnGroup?: number };
};

const backtick = '`';

// C#, F#, Java, and the JavaScript, TypeScript and Python code of the function.json programming models
export const defaultDialect: Dialect = {

    startNewOrchestration: name => new RegExp(
        String.raw`(StartNew|StartNewAsync|start_new|scheduleNewOrchestrationInstance|scheduleNewOrchestrationInstanceAsync)(\s*<[\w\.-\[\]\<\>,\s]+>)?\s*\(\s*(["'${backtick}]|nameof\s*\(\s*[\w\.-]*|[\w\s\.]+\.\s*)${escapeRegExp(name)}\s*["'\),]{1}`,
        'i'),

    callSubOrchestrator: name => new RegExp(
        String.raw`(CallSubOrchestrator|CallSubOrchestratorWithRetry|call_sub_orchestrator)(Async)?(\s*<[\w\.-\[\]\<\>,\s]+>)?\s*\(\s*(["'${backtick}]|nameof\s*\(\s*[\w\.-]*|[\w\s\.]+\.\s*)${escapeRegExp(name)}\s*["'\),]{1}`,
        'i'),

    callActivity: name => new RegExp(
        String.raw`(CallActivity|call_activity)[\s\w,\.-<>\[\]\(\)\?]*\([\s\w\.-]*["'${backtick}]?${escapeRegExp(name)}\s*["'${backtick}\),]{1}`,
        'i'),

    continueAsNew: () => /ContinueAsNew\s*\(/i,

    waitForExternalEvent: () => ({
        regex: new RegExp(
            String.raw`(WaitForExternalEvent|wait_for_external_event)(<[\s\w,\.-\[\]\(\)\<\>]+>)?\s*\(\s*(nameof\s*\(\s*|["'${backtick}]|[\w\s\.]+\.\s*)?([\s\w\.-]+)\s*["'${backtick}\),]{1}`,
            'gi'),
        group: 4
    }),

    raiseEvent: name => new RegExp(String.raw`(RaiseEvent|raise_event)(Async)?(.|\r|\n)*${escapeRegExp(name)}`, 'i'),

    signalEntity: name => new RegExp(String.raw`${escapeRegExp(name)}\s*["'>]{1}`),

    bindingAttribute: () => ({ regex: /(\[|@)(<)?\s*(return:)?\s*(\w+)/g, group: 4, returnGroup: 3 })
};

// The Python v2 programming model: decorators instead of function.json
export const pythonDialect: Dialect = {

    ...defaultDialect,

    startNewOrchestration: name => new RegExp(String.raw`\.\s*start_new\s*\(\s*["']${escapeRegExp(name)}["']`),

    bindingAttribute: () => ({ regex: /@[\w\s]+\.\s*(\w+)\s*\(/g, group: 1 })
};

// PowerShell: cmdlets with named parameters
export const powershellDialect: Dialect = {

    ...defaultDialect,

    startNewOrchestration: name => new RegExp(
        String.raw`(Start-DurableOrchestration|Start-NewOrchestration).*-FunctionName\s*["']${escapeRegExp(name)}["']`,
        'i'),

    callActivity: name => new RegExp(
        String.raw`(Invoke-DurableActivity|Invoke-ActivityFunction).*-FunctionName\s*["']${escapeRegExp(name)}["']`,
        'i'),

    waitForExternalEvent: () => ({
        regex: /Start-DurableExternalEventListener.*-EventName\s*["']([\s\w.-]+)["']/gi,
        group: 1
    }),

    raiseEvent: name => new RegExp(String.raw`Send-DurableExternalEvent.*-EventName\s*["']${escapeRegExp(name)}["']`, 'i')
};
