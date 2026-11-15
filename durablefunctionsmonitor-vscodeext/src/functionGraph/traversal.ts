// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// A binding of a function, in the shape of function.json: 'type' and 'direction', plus whatever else the binding has
// (a queue name, a route, ...). Bindings read from function.json are passed through as they are.
export type FunctionBinding = {
    type?: string;
    direction?: string;
    [property: string]: any;
};

// A function of a Functions project
export type FunctionInfo = {
    bindings: FunctionBinding[];
    // Functions that start this orchestration, call this activity or sub-orchestration, or signal this entity
    isCalledBy?: string[];
    // Functions that raise an event this orchestration waits for
    isSignalledBy?: { name: string, signalName: string }[];
    // True for an orchestration that continues as new
    isCalledByItself?: boolean;
    filePath?: string;
    // Offset of the function in its file, and the (1-based) line that offset is on
    pos?: number;
    lineNr?: number;
};

export type FunctionsMap = { [name: string]: FunctionInfo };

// An entry of proxies.json, with the place it was found at
export type ProxyInfo = {
    matchCondition?: {
        methods?: string[];
        route?: string;
    };
    backendUri?: string;
    requestOverrides?: object;
    responseOverrides?: object;
    filePath?: string;
    pos?: number;
    lineNr?: number;
    // True when the project is a C# one and its .csproj does not mention proxies.json, so the file is not deployed
    warningNotAddedToCsProjFile?: boolean;
};

export type ProxiesMap = { [name: string]: ProxyInfo };

// What parsing the source code of a Functions project gives
export type TraversalResult = {
    functions: FunctionsMap;
    proxies: ProxiesMap;
};

// Finds a function or a proxy of a traversal result by the name the UI uses: proxies come as 'proxy.<name>'
export function findFunctionOrProxy(result: TraversalResult | undefined, name: string): { filePath?: string, pos?: number, bindings?: any[] } | undefined {

    if (!result || !name) {
        return undefined;
    }

    return name.startsWith('proxy.') ? result.proxies[name.substring('proxy.'.length)] : result.functions[name];
}
