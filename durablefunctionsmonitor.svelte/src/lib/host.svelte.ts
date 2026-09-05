// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The only module allowed to read the globals injected into index.html (contracts §3).
// Every client, router and storage module imports `host` from here instead of touching
// `window`/`globalThis` directly, so the VS Code webview keeps working.

export type HostKind = 'browser' | 'vscode';

export type ThemeName = 'poster' | 'riso' | 'memphis' | 'blueprint' | 'hazard';

export interface ClientConfig {
  theme?: 'light' | 'dark';
  showTimeAs?: 'Local' | 'UTC';
  dfmTheme?: ThemeName;
  [k: string]: unknown;
}

export interface Host {
  kind: HostKind;
  vsCodeApi: unknown;
  routePrefix: string;
  apiRoutePrefix: string;
  clientConfig: ClientConfig;
  viewMode: 0 | 1;
  functionGraphAvailable: boolean;
  orchestrationIdFromVsCode: string;
  stateFromVsCode: Record<string, unknown>;
}

function readGlobal<T>(name: string, fallback: T): T {
  const value = (globalThis as Record<string, unknown>)[name];
  return value === undefined ? fallback : (value as T);
}

function acquireVsCodeApiOnce(): unknown {
  const acquire = (globalThis as Record<string, unknown>).acquireVsCodeApi;
  if (typeof acquire !== 'function') {
    return null;
  }
  try {
    return (acquire as () => unknown)();
  } catch {
    return null;
  }
}

function createHost(): Host {
  const kind: HostKind =
    typeof (globalThis as Record<string, unknown>).acquireVsCodeApi === 'function' ? 'vscode' : 'browser';
  const routePrefix = readGlobal<string>('DfmRoutePrefix', '');
  const dfmApiRoutePrefix = readGlobal<string>('DfmApiRoutePrefix', '');

  return {
    kind,
    vsCodeApi: acquireVsCodeApiOnce(),
    routePrefix,
    apiRoutePrefix: dfmApiRoutePrefix || (routePrefix ? `${routePrefix}/a/p/i` : 'a/p/i'),
    clientConfig: readGlobal<ClientConfig>('DfmClientConfig', {}),
    viewMode: readGlobal<0 | 1>('DfmViewMode', 0),
    functionGraphAvailable: Boolean(readGlobal<boolean>('IsFunctionGraphAvailable', false)),
    orchestrationIdFromVsCode: readGlobal<string>('OrchestrationIdFromVsCode', ''),
    stateFromVsCode: readGlobal<Record<string, unknown>>('StateFromVsCode', {}),
  };
}

export const host: Host = createHost();
