// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Dialect } from './dialects';
import type { FunctionsMap } from './traversal';

// A function, with the source code its calls are looked for in
export type FunctionCode = {
    name: string;
    code: string;
    filePath: string;
    pos: number;
    lineNr: number;
};

// Finds the source code of a function. Undefined when it cannot be found.
export type FunctionCodeLookup = (functionName: string) => Promise<FunctionCode | undefined>;

const durableTriggers = ['orchestrationTrigger', 'activityTrigger', 'entityTrigger'];

function hasTrigger(functions: FunctionsMap, name: string, triggerTypes: string[]): boolean {

    return (functions[name].bindings ?? []).some(b => triggerTypes.includes(b?.type as string));
}

async function loadCodes(names: string[], findCode: FunctionCodeLookup): Promise<FunctionCode[]> {

    const result: FunctionCode[] = [];

    for (const name of names) {

        const code = await findCode(name);
        if (code) {
            result.push(code);
        }
    }

    return result;
}

// Connects orchestrations with what starts them, with their activities and sub-orchestrations, with what raises
// the events they wait for, and entities with what signals them - all by reading the source code of each function
// for the names of the others. Also records where each function was found.
//
// It is text matching, not a compiler: a name built at run time is not seen, and a name mentioned in a comment is.
export async function mapOrchestratorsAndActivities(functions: FunctionsMap, findCode: FunctionCodeLookup, dialect: Dialect): Promise<FunctionsMap> {

    const functionNames = Object.keys(functions);

    const orchestrators = await loadCodes(functionNames.filter(name => hasTrigger(functions, name, ['orchestrationTrigger'])), findCode);

    const activityNames = functionNames.filter(name => hasTrigger(functions, name, ['activityTrigger']));
    const activities = await loadCodes(activityNames, findCode);

    const entities = await loadCodes(functionNames.filter(name => hasTrigger(functions, name, ['entityTrigger'])), findCode);

    // Everything else is what starts orchestrations, raises events and signals entities
    const otherFunctions = await loadCodes(functionNames.filter(name => !hasTrigger(functions, name, durableTriggers)), findCode);

    const addCaller = (functionName: string, callerName: string) => {
        (functions[functionName].isCalledBy ??= []).push(callerName);
    };

    for (const orch of orchestrators) {

        // The functions that start this orchestration
        const startNewRegex = dialect.startNewOrchestration(orch.name);
        for (const func of otherFunctions) {

            if (startNewRegex.test(func.code)) {
                addCaller(orch.name, func.name);
            }
        }

        // The sub-orchestrations this orchestration calls
        for (const subOrch of orchestrators) {

            if (orch.name !== subOrch.name && dialect.callSubOrchestrator(subOrch.name).test(orch.code)) {
                addCaller(subOrch.name, orch.name);
            }
        }

        // The activities this orchestration calls. An activity whose own code was not found is still an activity.
        for (const activityName of activityNames) {

            if (dialect.callActivity(activityName).test(orch.code)) {
                addCaller(activityName, orch.name);
            }
        }

        if (dialect.continueAsNew().test(orch.code)) {
            functions[orch.name].isCalledByItself = true;
        }

        // The functions that raise the events this orchestration waits for
        for (const eventName of getEventNames(orch.code, dialect)) {

            const raiseEventRegex = dialect.raiseEvent(eventName);
            for (const func of otherFunctions) {

                if (raiseEventRegex.test(func.code)) {
                    (functions[orch.name].isSignalledBy ??= []).push({ name: func.name, signalName: eventName });
                }
            }
        }
    }

    for (const entity of entities) {

        // The functions that mention this entity
        const signalEntityRegex = dialect.signalEntity(entity.name);
        for (const func of otherFunctions) {

            if (signalEntityRegex.test(func.code)) {
                addCaller(entity.name, func.name);
            }
        }
    }

    for (const func of [...otherFunctions, ...orchestrators, ...activities, ...entities]) {

        functions[func.name].filePath = func.filePath;
        functions[func.name].pos = func.pos;
        functions[func.name].lineNr = func.lineNr;
    }

    return functions;
}

// The names of the events an orchestration waits for, one per place it waits at
function getEventNames(orchestratorCode: string, dialect: Dialect): string[] {

    const result: string[] = [];

    const { regex, group } = dialect.waitForExternalEvent();

    let match: RegExpExecArray | null;
    while ((match = regex.exec(orchestratorCode))) {
        result.push(match[group]);
    }

    return result;
}
