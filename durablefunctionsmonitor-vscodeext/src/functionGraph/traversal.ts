// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { FunctionsMap, ProxiesMap } from 'az-func-as-a-graph.core/dist/FunctionsMap';

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
